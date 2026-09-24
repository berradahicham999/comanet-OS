-- Gestion commerciale — lot 2 : pièces de vente (BL, factures, avoirs), projection dans les ventes,
-- interrupteur « Lever un blocage commercial ». Idempotente et additive : l'ancien code la supporte.

-- ---------------------------------------------------------------------------
-- Référentiels
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "credit_reasons" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"with_return" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);--> statement-breakpoint
INSERT INTO "credit_reasons" ("key", "label", "with_return", "sort") VALUES
	('RETOUR', 'Retour de marchandise', true, 10),
	('PERIME', 'Produit périmé ou abîmé', true, 20),
	('ERREUR_PRIX', 'Erreur de prix ou de remise', false, 30),
	('REMISE', 'Remise accordée après coup', false, 40),
	('AUTRE', 'Autre motif', false, 90)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

-- Séries des pièces de simulation (période parallèle, tests) : jamais mêlées aux séries légales.
INSERT INTO "document_series" ("key", "label", "pattern", "sort") VALUES
	('SIMBL', 'Simulation — bons de livraison', 'SIMBL{AAAA}{N:5}', 110),
	('SIMFA', 'Simulation — factures', 'SIMFA{AAAA}{N:5}', 120),
	('SIMAV', 'Simulation — avoirs', 'SIMAV{AAAA}{N:5}', 130)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Pièces de vente
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "sales_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'BROUILLON' NOT NULL,
	"number" text,
	"series_key" text,
	"fiscal_year" integer,
	"is_simulation" boolean DEFAULT true NOT NULL,
	"date" date NOT NULL,
	"client_id" uuid NOT NULL,
	"client_snapshot" jsonb,
	"company_snapshot" jsonb,
	"delivery_address" text,
	"site" text DEFAULT 'COMANET' NOT NULL,
	"sales_rep_id" uuid,
	"sales_rep_name" text,
	"payment_mode_key" text,
	"payment_days" integer,
	"due_date" date,
	"global_discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"gross_ht" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net_ht" numeric(14, 2) DEFAULT '0' NOT NULL,
	"vat_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"ttc" numeric(14, 2) DEFAULT '0' NOT NULL,
	"vat_breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"amount_in_words" text,
	"reason_key" text,
	"origin_document_id" uuid,
	"notes" text,
	"approvals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approval_requested_at" timestamp with time zone,
	"approval_requested_by_id" uuid,
	"source" text DEFAULT 'COMANET_OS' NOT NULL,
	"pdf_asset_id" uuid,
	"content_hash" text,
	"einvoice_uid" text,
	"einvoice_status" text,
	"einvoice_payload" jsonb,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"validated_by_id" uuid,
	"validated_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_by_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "sales_documents_type_ck" CHECK ("type" IN ('BL', 'FACTURE', 'AVOIR')),
	CONSTRAINT "sales_documents_status_ck" CHECK ("status" IN ('BROUILLON', 'VALIDE', 'LIVRE', 'FACTURE_PARTIEL', 'FACTURE', 'ANNULE')),
	CONSTRAINT "sales_documents_numbered_ck" CHECK ("status" = 'BROUILLON' OR "number" IS NOT NULL),
	CONSTRAINT "sales_documents_discount_ck" CHECK ("global_discount_pct" >= 0 AND "global_discount_pct" < 100)
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_series_key_document_series_key_fk" FOREIGN KEY ("series_key") REFERENCES "public"."document_series"("key") ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_sales_rep_id_users_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_payment_mode_key_payment_modes_key_fk" FOREIGN KEY ("payment_mode_key") REFERENCES "public"."payment_modes"("key") ON DELETE no action ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_reason_key_credit_reasons_key_fk" FOREIGN KEY ("reason_key") REFERENCES "public"."credit_reasons"("key") ON DELETE no action ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_origin_document_id_fk" FOREIGN KEY ("origin_document_id") REFERENCES "public"."sales_documents"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_validated_by_id_users_id_fk" FOREIGN KEY ("validated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_documents_number_uq" ON "sales_documents" USING btree ("number") WHERE "number" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_documents_client_idx" ON "sales_documents" USING btree ("client_id", "date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_documents_type_status_idx" ON "sales_documents" USING btree ("type", "status", "date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_documents_origin_idx" ON "sales_documents" USING btree ("origin_document_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sales_document_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"product_id" uuid,
	"lot_id" uuid,
	"warehouse_key" text DEFAULT 'PRINCIPAL' NOT NULL,
	"ref" text,
	"designation" text NOT NULL,
	"unit" text,
	"quantity" numeric(12, 3) NOT NULL,
	"free_quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"unit_price_ht" numeric(12, 2) DEFAULT '0' NOT NULL,
	"public_price_ttc" numeric(12, 2),
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"gross_ht" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net_ht" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '20' NOT NULL,
	"vat_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"ttc" numeric(14, 2) DEFAULT '0' NOT NULL,
	"source_line_id" uuid,
	"source_number" text,
	"source_date" date,
	"invoiced_qty" numeric(12, 3) DEFAULT '0' NOT NULL,
	"credited_qty" numeric(12, 3) DEFAULT '0' NOT NULL,
	"return_warehouse_key" text,
	"lot_allocations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "sales_document_lines_discount_ck" CHECK ("discount_pct" >= 0 AND "discount_pct" < 100),
	CONSTRAINT "sales_document_lines_free_ck" CHECK ("free_quantity" >= 0)
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."sales_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_warehouse_key_fk" FOREIGN KEY ("warehouse_key") REFERENCES "public"."warehouses"("key") ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_return_warehouse_key_fk" FOREIGN KEY ("return_warehouse_key") REFERENCES "public"."warehouses"("key") ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_source_line_id_fk" FOREIGN KEY ("source_line_id") REFERENCES "public"."sales_document_lines"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_document_lines_document_idx" ON "sales_document_lines" USING btree ("document_id", "position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_document_lines_product_idx" ON "sales_document_lines" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_document_lines_source_idx" ON "sales_document_lines" USING btree ("source_line_id");--> statement-breakpoint

-- Une pièce numérotée n'est ni supprimée ni modifiée dans ce qu'elle facture : seuls le statut
-- et les horodatages de cycle de vie évoluent. Une erreur se corrige par un avoir.
CREATE OR REPLACE FUNCTION "sales_documents_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."number" IS NOT NULL THEN
      RAISE EXCEPTION 'Pièce % : une pièce numérotée ne se supprime pas (annulation ou avoir).', OLD."number";
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'BROUILLON' THEN
    IF NEW."status" = 'BROUILLON' THEN
      RAISE EXCEPTION 'Pièce % : une pièce validée ne redevient pas un brouillon.', OLD."number";
    END IF;
    IF (NEW."number", NEW."type", NEW."date", NEW."client_id", NEW."client_snapshot", NEW."company_snapshot", NEW."gross_ht", NEW."net_ht",
        NEW."vat_total", NEW."ttc", NEW."vat_breakdown", NEW."global_discount_pct", NEW."series_key", NEW."is_simulation", NEW."origin_document_id",
        NEW."due_date", NEW."payment_days", NEW."payment_mode_key", NEW."site", NEW."delivery_address", NEW."amount_in_words", NEW."content_hash")
       IS DISTINCT FROM
       (OLD."number", OLD."type", OLD."date", OLD."client_id", OLD."client_snapshot", OLD."company_snapshot", OLD."gross_ht", OLD."net_ht",
        OLD."vat_total", OLD."ttc", OLD."vat_breakdown", OLD."global_discount_pct", OLD."series_key", OLD."is_simulation", OLD."origin_document_id",
        OLD."due_date", OLD."payment_days", OLD."payment_mode_key", OLD."site", OLD."delivery_address", OLD."amount_in_words", OLD."content_hash") THEN
      RAISE EXCEPTION 'Pièce % : validée, elle n''est plus modifiable (corriger par un avoir).', OLD."number";
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "sales_documents_guard" ON "sales_documents";--> statement-breakpoint
CREATE TRIGGER "sales_documents_guard" BEFORE UPDATE OR DELETE ON "sales_documents" FOR EACH ROW EXECUTE FUNCTION "sales_documents_guard"();--> statement-breakpoint

-- Les lignes d'une pièce validée sont figées ; seuls les compteurs facturé / crédité avancent.
CREATE OR REPLACE FUNCTION "sales_document_lines_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT "status" INTO st FROM "sales_documents" WHERE "id" = COALESCE(NEW."document_id", OLD."document_id");
  IF st IS NULL OR st = 'BROUILLON' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW."document_id", NEW."product_id", NEW."lot_id", NEW."warehouse_key", NEW."ref", NEW."designation", NEW."quantity", NEW."free_quantity",
        NEW."unit_price_ht", NEW."public_price_ttc", NEW."discount_pct", NEW."gross_ht", NEW."net_ht", NEW."tax_rate", NEW."vat_amount", NEW."ttc",
        NEW."source_line_id", NEW."lot_allocations", NEW."return_warehouse_key")
       IS NOT DISTINCT FROM
       (OLD."document_id", OLD."product_id", OLD."lot_id", OLD."warehouse_key", OLD."ref", OLD."designation", OLD."quantity", OLD."free_quantity",
        OLD."unit_price_ht", OLD."public_price_ttc", OLD."discount_pct", OLD."gross_ht", OLD."net_ht", OLD."tax_rate", OLD."vat_amount", OLD."ttc",
        OLD."source_line_id", OLD."lot_allocations", OLD."return_warehouse_key") THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'Les lignes d''une pièce validée ne se modifient pas (corriger par un avoir).';
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "sales_document_lines_guard" ON "sales_document_lines";--> statement-breakpoint
CREATE TRIGGER "sales_document_lines_guard" BEFORE INSERT OR UPDATE OR DELETE ON "sales_document_lines" FOR EACH ROW EXECUTE FUNCTION "sales_document_lines_guard"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "sales_documents_no_truncate"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Les pièces de vente ne s''effacent pas en masse.';
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "sales_documents_no_truncate" ON "sales_documents";--> statement-breakpoint
CREATE TRIGGER "sales_documents_no_truncate" BEFORE TRUNCATE ON "sales_documents" FOR EACH STATEMENT EXECUTE FUNCTION "sales_documents_no_truncate"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "sales_document_lines_no_truncate" ON "sales_document_lines";--> statement-breakpoint
CREATE TRIGGER "sales_document_lines_no_truncate" BEFORE TRUNCATE ON "sales_document_lines" FOR EACH STATEMENT EXECUTE FUNCTION "sales_documents_no_truncate"();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Ventes : deux sources, jamais de doublon (voir src/lib/gestion/projection.ts)
-- ---------------------------------------------------------------------------
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'SAGE' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "document_line_id" uuid;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "free_quantity" numeric(12, 3);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales" ADD CONSTRAINT "sales_document_line_id_fk" FOREIGN KEY ("document_line_id") REFERENCES "public"."sales_document_lines"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_document_line_uq" ON "sales" USING btree ("document_line_id") WHERE "document_line_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_source_idx" ON "sales" USING btree ("source");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Fichiers : PDF figé de chaque pièce validée
-- ---------------------------------------------------------------------------
ALTER TABLE "content_assets" ADD COLUMN IF NOT EXISTS "sales_document_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_sales_document_id_fk" FOREIGN KEY ("sales_document_id") REFERENCES "public"."sales_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "content_assets" DROP CONSTRAINT IF EXISTS "content_assets_owner_ck";--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_owner_ck" CHECK ((("content_id" IS NOT NULL)::int + ("activation_id" IS NOT NULL)::int + ("inventory_item_id" IS NOT NULL)::int + ("company_slot" IS NOT NULL)::int + ("sales_document_id" IS NOT NULL)::int) = 1);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_assets_sales_document_idx" ON "content_assets" USING btree ("sales_document_id", "kind", "version");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Droits : lever un blocage commercial (remise hors plafond, client bloqué, encours, vente à perte)
-- ---------------------------------------------------------------------------
ALTER TABLE "user_flags" ADD COLUMN IF NOT EXISTS "override_commercial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "user_flags" f SET "override_commercial" = true
WHERE EXISTS (SELECT 1 FROM "user_permissions" p WHERE p."user_id" = f."user_id" AND p."module" = 'administration' AND p."can_validate");--> statement-breakpoint
UPDATE "role_templates" SET "flags" = "flags" || '{"overrideCommercial":true}'::jsonb WHERE "name" = 'Administrateur';--> statement-breakpoint

ALTER TABLE "credit_reasons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_document_lines" ENABLE ROW LEVEL SECURITY;
