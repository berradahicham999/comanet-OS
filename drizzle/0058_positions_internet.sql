-- Contrôle Internet des positions (cabinets médicaux, points de vente) : résultat de la recherche Google Maps
-- par nom + ville, une ligne par fiche (`src/lib/places/web-check.ts`). Le verdict se calcule à la lecture.
-- Nouvelle origine de position INTERNET sur `doctors.gps_source` et `clients.gps_source` : contraintes élargies.
CREATE TABLE IF NOT EXISTS "place_web_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"provider" text DEFAULT 'GOOGLE' NOT NULL,
	"query" text NOT NULL,
	"status" text NOT NULL,
	"place_id" text,
	"place_name" text,
	"place_address" text,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"name_score" numeric(4, 3),
	"candidates" jsonb,
	"error" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_by" uuid
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "place_web_checks" ADD CONSTRAINT "place_web_checks_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "place_web_checks_entity_uq" ON "place_web_checks" USING btree ("entity_type","entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "place_web_checks_status_idx" ON "place_web_checks" USING btree ("status");
--> statement-breakpoint
ALTER TABLE "place_web_checks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "doctors" DROP CONSTRAINT IF EXISTS "doctors_gps_source_ck";
--> statement-breakpoint
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_gps_source_ck" CHECK ("gps_source" IS NULL OR "gps_source" IN ('PREMIERE_VISITE', 'MANUELLE', 'ADRESSE', 'HISTORIQUE', 'INTERNET'));
--> statement-breakpoint
ALTER TABLE "clients" DROP CONSTRAINT IF EXISTS "clients_gps_source_ck";
--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_gps_source_ck" CHECK ("gps_source" IS NULL OR "gps_source" IN ('PREMIERE_VISITE', 'MANUELLE', 'INTERNET'));
