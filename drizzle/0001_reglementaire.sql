ALTER TYPE "public"."import_type" ADD VALUE IF NOT EXISTS 'REGULATORY';--> statement-breakpoint
-- Réglementaire V2 : suivi par variante (modèle de vente / échantillon / minidose / travel size),
-- étape Certificat d'Enregistrement (CE) après l'Attestation de Dépôt (ATD), et historique des dépôts.
ALTER TABLE "regulatory_files" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "regulatory_files" ADD COLUMN "variant_type" text DEFAULT 'MODELE_VENTE' NOT NULL;--> statement-breakpoint
ALTER TABLE "regulatory_files" ADD COLUMN "size" text;--> statement-breakpoint
ALTER TABLE "regulatory_files" ADD COLUMN "packaging" text;--> statement-breakpoint
ALTER TABLE "regulatory_files" ADD COLUMN "document_type" text DEFAULT 'ATD' NOT NULL;--> statement-breakpoint
ALTER TABLE "regulatory_files" ADD COLUMN "certificate_status" text DEFAULT 'A_DEMANDER' NOT NULL;--> statement-breakpoint
ALTER TABLE "regulatory_files" ADD COLUMN "certificate_number" text;--> statement-breakpoint
ALTER TABLE "regulatory_files" ADD COLUMN "certificate_date" date;--> statement-breakpoint
ALTER TABLE "regulatory_files" ADD COLUMN "physical_product" boolean;--> statement-breakpoint
ALTER TABLE "regulatory_files" ADD COLUMN "blocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "regulatory_files" ADD COLUMN "blocked_reason" text;--> statement-breakpoint
ALTER TABLE "regulatory_files" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "regulatory_files" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "regulatory_files" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "regulatory_files" ADD CONSTRAINT "regulatory_files_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "regulatory_dedupe_uq" ON "regulatory_files" USING btree ("dedupe_key") WHERE dedupe_key is not null;--> statement-breakpoint
CREATE INDEX "regulatory_brand_idx" ON "regulatory_files" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "regulatory_certificate_idx" ON "regulatory_files" USING btree ("certificate_status");--> statement-breakpoint
CREATE TABLE "regulatory_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"reference" text,
	"expiry_date" date,
	"notes" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "regulatory_events" ADD CONSTRAINT "regulatory_events_file_id_regulatory_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."regulatory_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulatory_events" ADD CONSTRAINT "regulatory_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "regulatory_events_file_idx" ON "regulatory_events" USING btree ("file_id","date");
