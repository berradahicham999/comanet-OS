-- Médical v2 : ordonnances collectées. AUCUNE donnée patient : ni nom, ni âge, ni téléphone, ni numéro.
-- Seulement date, médecin (rapproché ou libellé brut), spécialité et ville si présentes, pharmacie, produit, quantité.

CREATE TABLE IF NOT EXISTS "prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"doctor_id" uuid REFERENCES "doctors"("id") ON DELETE SET NULL,
	"doctor_raw_name" text NOT NULL,
	"doctor_raw_key" text NOT NULL,
	"doctor_match" text DEFAULT 'NON_RAPPROCHE' NOT NULL,
	"doctor_match_score" numeric(4, 3),
	"specialty_raw" text,
	"city" text,
	"client_id" uuid REFERENCES "clients"("id") ON DELETE SET NULL,
	"pharmacy_raw" text,
	"product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL,
	"product_raw" text NOT NULL,
	"product_raw_key" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"source" text DEFAULT 'IMPORT' NOT NULL,
	"import_id" uuid REFERENCES "imports"("id") ON DELETE SET NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prescriptions_doctor_match_ck" CHECK ("doctor_match" IN ('ALIAS', 'AUTO', 'MANUEL', 'NON_RAPPROCHE', 'IGNORE')),
	CONSTRAINT "prescriptions_quantity_ck" CHECK ("quantity" > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prescriptions_dedupe_uq" ON "prescriptions" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prescriptions_doctor_idx" ON "prescriptions" USING btree ("doctor_id", "date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prescriptions_product_idx" ON "prescriptions" USING btree ("product_id", "date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prescriptions_import_idx" ON "prescriptions" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prescriptions_doctor_raw_idx" ON "prescriptions" USING btree ("doctor_raw_key") WHERE "doctor_id" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prescriptions_product_raw_idx" ON "prescriptions" USING btree ("product_raw_key") WHERE "product_id" IS NULL;--> statement-breakpoint
ALTER TABLE "prescriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Variantes de nom rattachées à un médecin (même modèle que client_aliases / product_aliases).
CREATE TABLE IF NOT EXISTS "doctor_aliases" (
	"alias" text PRIMARY KEY NOT NULL,
	"doctor_id" uuid NOT NULL REFERENCES "doctors"("id") ON DELETE CASCADE,
	"source" text DEFAULT 'IMPORT' NOT NULL,
	"import_id" uuid REFERENCES "imports"("id") ON DELETE SET NULL,
	"created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doctor_aliases_doctor_idx" ON "doctor_aliases" USING btree ("doctor_id");--> statement-breakpoint
ALTER TABLE "doctor_aliases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Libellés écartés de la file de rapprochement (médecin hors fichier, produit concurrent, pharmacie inconnue).
CREATE TABLE IF NOT EXISTS "prescription_ignored_labels" (
	"kind" text NOT NULL,
	"alias" text NOT NULL,
	"label" text NOT NULL,
	"created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prescription_ignored_labels_pk" PRIMARY KEY ("kind", "alias"),
	CONSTRAINT "prescription_ignored_labels_kind_ck" CHECK ("kind" IN ('DOCTOR', 'PRODUCT', 'PHARMACY'))
);--> statement-breakpoint
ALTER TABLE "prescription_ignored_labels" ENABLE ROW LEVEL SECURITY;
