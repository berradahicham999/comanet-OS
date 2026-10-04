-- CRM commercial (docs/plan-crm-commercial.md) : portefeuille, fréquence de visite, objectifs par client,
-- visites commerciales chronométrées avec contrôle de présence.
-- Rien n'est inventé sur l'existant : aucune fréquence, aucun commercial attitré, aucun objectif client n'est
-- déduit. Le commercial attitré se propose ensuite à la main depuis les affectations des droits
-- (page Clients → Portefeuilles), jamais automatiquement.

-- 1. Fiche client : fréquence de visite et position du point de vente.
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "visit_frequency_monthly" integer;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "gps_lat" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "gps_lng" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "gps_source" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "gps_status" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "gps_validated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "gps_validated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "clients" ADD CONSTRAINT "clients_visit_frequency_ck" CHECK ("visit_frequency_monthly" IS NULL OR ("visit_frequency_monthly" >= 0 AND "visit_frequency_monthly" <= 31));
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "clients" ADD CONSTRAINT "clients_gps_source_ck" CHECK ("gps_source" IS NULL OR "gps_source" IN ('PREMIERE_VISITE', 'MANUELLE'));
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "clients" ADD CONSTRAINT "clients_gps_status_ck" CHECK ("gps_status" IS NULL OR "gps_status" IN ('A_CONFIRMER', 'VALIDEE'));
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- 2. Objectifs : une colonne client. Un objectif client est un CA HT (sell-in) mensuel ou annuel, avec une
--    marque facultative et jamais de produit. Les objectifs marque / produit existants gardent client_id NULL.
ALTER TABLE "objectives" ADD COLUMN IF NOT EXISTS "client_id" uuid REFERENCES "clients"("id") ON DELETE CASCADE;--> statement-breakpoint
DROP INDEX IF EXISTS "objectives_scope_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "objectives_scope_uq" ON "objectives" USING btree (
  coalesce("brand_id", '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce("product_id", '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce("client_id", '00000000-0000-0000-0000-000000000000'::uuid),
  "year", coalesce("month", 0));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "objectives_client_idx" ON "objectives" USING btree ("client_id") WHERE "client_id" IS NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "objectives" ADD CONSTRAINT "objectives_client_no_product_ck" CHECK ("client_id" IS NULL OR "product_id" IS NULL);
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- 3. Visites commerciales. Les heures et le contrôle de présence ne s'écrivent que par src/lib/crm/visits.ts.
CREATE TABLE IF NOT EXISTS "client_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE RESTRICT,
	"user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"date" date NOT NULL,
	"status" text DEFAULT 'PLANIFIEE' NOT NULL,
	"kind" text DEFAULT 'VISITE' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_minutes" integer,
	"timing_source" text DEFAULT 'SAISIE_MANUELLE' NOT NULL,
	"objective" text,
	"result" text,
	"comment" text,
	"next_action" text,
	"next_visit_date" date,
	"not_done_reason" text,
	"report_status" text,
	"auto_closed" boolean DEFAULT false NOT NULL,
	"synced_late" boolean DEFAULT false NOT NULL,
	"verification_status" text DEFAULT 'HORS_CONTROLE' NOT NULL,
	"verification_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verified_at" timestamp with time zone,
	"created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"dedupe_key" text,
	"import_id" uuid REFERENCES "imports"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "client_visits_status_ck" CHECK ("status" IN ('PLANIFIEE', 'EN_COURS', 'EFFECTUEE', 'NON_EFFECTUEE', 'ANNULEE')),
	CONSTRAINT "client_visits_kind_ck" CHECK ("kind" IN ('VISITE', 'APPEL', 'MESSAGE')),
	CONSTRAINT "client_visits_timing_ck" CHECK ("timing_source" IN ('CHRONO', 'SAISIE_MANUELLE', 'HISTORIQUE')),
	CONSTRAINT "client_visits_report_ck" CHECK ("report_status" IS NULL OR "report_status" IN ('A_COMPLETER', 'VALIDE')),
	CONSTRAINT "client_visits_verification_ck" CHECK ("verification_status" IN ('VERIFIEE', 'A_VERIFIER', 'NON_VERIFIEE', 'HORS_CONTROLE'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_visits_client_date_idx" ON "client_visits" USING btree ("client_id", "date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_visits_user_date_idx" ON "client_visits" USING btree ("user_id", "date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_visits_status_idx" ON "client_visits" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_visits_dedupe_uq" ON "client_visits" USING btree ("dedupe_key") WHERE "dedupe_key" IS NOT NULL;--> statement-breakpoint
-- Une seule visite en cours à la fois par commerciale.
CREATE UNIQUE INDEX IF NOT EXISTS "client_visits_one_running_uq" ON "client_visits" USING btree ("user_id")
  WHERE "started_at" IS NOT NULL AND "ended_at" IS NULL;--> statement-breakpoint
ALTER TABLE "client_visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- 4. Le journal des visites (écriture seule, migration 0037) sert aussi aux visites commerciales :
--    chaque événement porte soit une visite médicale, soit une visite commerciale. Les triggers restent.
ALTER TABLE "visit_events" ALTER COLUMN "visit_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "visit_events" ADD COLUMN IF NOT EXISTS "client_visit_id" uuid REFERENCES "client_visits"("id") ON DELETE RESTRICT;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "visit_events" ADD CONSTRAINT "visit_events_one_visit_ck" CHECK (num_nonnulls("visit_id", "client_visit_id") = 1);
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_events_client_visit_idx" ON "visit_events" USING btree ("client_visit_id", "server_time") WHERE "client_visit_id" IS NOT NULL;
