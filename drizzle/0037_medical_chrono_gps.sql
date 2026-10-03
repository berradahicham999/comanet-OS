-- Médical v2 : chrono de visite et contrôle de présence par GPS.
-- Les visites saisies avant le chrono (15 en production au 03/10/2026) sont gardées telles quelles,
-- marquées AVANT_CHRONO et HORS_CONTROLE : aucune heure ni position ne leur est inventée.

ALTER TABLE "doctor_visits" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "doctor_visits" ADD COLUMN IF NOT EXISTS "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "doctor_visits" ADD COLUMN IF NOT EXISTS "timing_source" text DEFAULT 'SAISIE_MANUELLE' NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor_visits" ADD COLUMN IF NOT EXISTS "report_status" text;--> statement-breakpoint
ALTER TABLE "doctor_visits" ADD COLUMN IF NOT EXISTS "auto_closed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor_visits" ADD COLUMN IF NOT EXISTS "synced_late" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor_visits" ADD COLUMN IF NOT EXISTS "not_done_reason" text;--> statement-breakpoint
ALTER TABLE "doctor_visits" ADD COLUMN IF NOT EXISTS "verification_status" text DEFAULT 'HORS_CONTROLE' NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor_visits" ADD COLUMN IF NOT EXISTS "verification_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor_visits" ADD COLUMN IF NOT EXISTS "verified_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "doctor_visits" ADD CONSTRAINT "doctor_visits_timing_source_ck" CHECK ("timing_source" IN ('CHRONO', 'SAISIE_MANUELLE', 'AVANT_CHRONO'));
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "doctor_visits" ADD CONSTRAINT "doctor_visits_report_status_ck" CHECK ("report_status" IS NULL OR "report_status" IN ('A_COMPLETER', 'VALIDE'));
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "doctor_visits" ADD CONSTRAINT "doctor_visits_verification_ck" CHECK ("verification_status" IN ('VERIFIEE', 'A_VERIFIER', 'NON_VERIFIEE', 'HORS_CONTROLE'));
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- Reprise de l'existant : toute visite créée avant cette migration est « saisie avant chrono ».
UPDATE "doctor_visits" SET "timing_source" = 'AVANT_CHRONO', "verification_status" = 'HORS_CONTROLE',
  "report_status" = CASE WHEN "status" = 'REALISEE' THEN 'VALIDE' ELSE NULL END
WHERE "started_at" IS NULL AND "timing_source" = 'SAISIE_MANUELLE';--> statement-breakpoint

-- Une seule visite en cours à la fois par déléguée.
CREATE UNIQUE INDEX IF NOT EXISTS "doctor_visits_one_running_uq" ON "doctor_visits" USING btree ("delegate_id")
  WHERE "started_at" IS NOT NULL AND "ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doctor_visits_started_idx" ON "doctor_visits" USING btree ("delegate_id", "started_at");--> statement-breakpoint

-- Position du cabinet : d'où elle vient et si elle est validée.
ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "gps_source" text;--> statement-breakpoint
ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "gps_status" text;--> statement-breakpoint
ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "gps_validated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "gps_validated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "potential_source" text;--> statement-breakpoint
ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "potential_detail" jsonb;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "doctors" ADD CONSTRAINT "doctors_gps_source_ck" CHECK ("gps_source" IS NULL OR "gps_source" IN ('PREMIERE_VISITE', 'MANUELLE', 'ADRESSE'));
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "doctors" ADD CONSTRAINT "doctors_gps_status_ck" CHECK ("gps_status" IS NULL OR "gps_status" IN ('A_CONFIRMER', 'VALIDEE'));
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "doctors" ADD CONSTRAINT "doctors_potential_source_ck" CHECK ("potential_source" IS NULL OR "potential_source" IN ('MANUELLE', 'AUTO'));
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
-- Une position déjà présente est considérée saisie à la main ; un potentiel déjà saisi prime sur le calcul.
UPDATE "doctors" SET "gps_source" = 'MANUELLE', "gps_status" = 'A_CONFIRMER' WHERE "gps_lat" IS NOT NULL AND "gps_source" IS NULL;--> statement-breakpoint
UPDATE "doctors" SET "potential_source" = 'MANUELLE' WHERE "potential" IS NOT NULL AND "potential_source" IS NULL;--> statement-breakpoint

-- Journal des événements de visite : écriture seule. Une erreur se corrige par un événement CORRECTION.
CREATE TABLE IF NOT EXISTS "visit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL REFERENCES "doctor_visits"("id") ON DELETE RESTRICT,
	"delegate_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
	"type" text NOT NULL,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"accuracy_m" integer,
	"gps_error" text,
	"device_time" timestamp with time zone,
	"server_time" timestamp with time zone DEFAULT now() NOT NULL,
	"distance_cabinet_m" integer,
	"synced_late" boolean DEFAULT false NOT NULL,
	"user_agent" text,
	"client_event_id" text NOT NULL,
	"actor_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
	"actor_name" text,
	"reason" text,
	"payload" jsonb,
	CONSTRAINT "visit_events_type_ck" CHECK ("type" IN ('START', 'STOP', 'NON_EFFECTUEE', 'CLOTURE_AUTO', 'CORRECTION')),
	CONSTRAINT "visit_events_gps_error_ck" CHECK ("gps_error" IS NULL OR "gps_error" IN ('REFUSE', 'INDISPONIBLE', 'DELAI', 'NON_SUPPORTE'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "visit_events_client_uq" ON "visit_events" USING btree ("client_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_events_visit_idx" ON "visit_events" USING btree ("visit_id", "server_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_events_delegate_idx" ON "visit_events" USING btree ("delegate_id", "server_time");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "visit_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Le journal des visites est en écriture seule : une erreur se corrige par un événement CORRECTION.';
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "visit_events_no_change" ON "visit_events";--> statement-breakpoint
CREATE TRIGGER "visit_events_no_change" BEFORE UPDATE OR DELETE ON "visit_events" FOR EACH ROW EXECUTE FUNCTION "visit_events_append_only"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "visit_events_no_truncate" ON "visit_events";--> statement-breakpoint
CREATE TRIGGER "visit_events_no_truncate" BEFORE TRUNCATE ON "visit_events" FOR EACH STATEMENT EXECUTE FUNCTION "visit_events_append_only"();--> statement-breakpoint
ALTER TABLE "visit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Prise de connaissance de l'information GPS (une ligne par lecture, jamais écrasée).
CREATE TABLE IF NOT EXISTS "medical_gps_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"notice_version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "medical_gps_consents_user_idx" ON "medical_gps_consents" USING btree ("user_id", "notice_version");--> statement-breakpoint
ALTER TABLE "medical_gps_consents" ENABLE ROW LEVEL SECURITY;
