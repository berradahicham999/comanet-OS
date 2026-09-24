-- Gestion commerciale — lot 3 : achats (commandes fournisseurs, réceptions, factures fournisseurs,
-- retours fournisseurs, frais d'approche). Idempotente et additive : l'ancien code la supporte.

-- Séries : les commandes (CF) et réceptions (BR) existent depuis le lot 1.
INSERT INTO "document_series" ("key", "label", "pattern", "sort") VALUES
	('FF', 'Factures fournisseurs (enregistrement)', 'FF{AAAA}{N:5}', 80),
	('RF', 'Retours fournisseurs', 'RF{AAAA}{N:5}', 90)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "purchase_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'BROUILLON' NOT NULL,
	"number" text,
	"series_key" text,
	"fiscal_year" integer,
	"supplier_id" uuid NOT NULL,
	"supplier_snapshot" jsonb,
	"supplier_ref" text,
	"date" date NOT NULL,
	"expected_date" date,
	"due_date" date,
	"currency" text DEFAULT 'MAD' NOT NULL,
	"exchange_rate" numeric(14, 6) DEFAULT '1' NOT NULL,
	"warehouse_key" text DEFAULT 'PRINCIPAL' NOT NULL,
	"origin_document_id" uuid,
	"net_ht_currency" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net_ht_mad" numeric(14, 2) DEFAULT '0' NOT NULL,
	"landed_mad" numeric(14, 2) DEFAULT '0' NOT NULL,
	"vat_mad" numeric(14, 2) DEFAULT '0' NOT NULL,
	"ttc_mad" numeric(14, 2) DEFAULT '0' NOT NULL,
	"vat_breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"pdf_asset_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"validated_by_id" uuid,
	"validated_at" timestamp with time zone,
	"closed_by_id" uuid,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	CONSTRAINT "purchase_documents_type_ck" CHECK ("type" IN ('COMMANDE', 'RECEPTION', 'FACTURE', 'RETOUR')),
	CONSTRAINT "purchase_documents_status_ck" CHECK ("status" IN ('BROUILLON', 'VALIDE', 'PARTIELLE', 'RECUE', 'CLOTUREE', 'FACTUREE_PARTIEL', 'FACTUREE', 'ANNULE')),
	CONSTRAINT "purchase_documents_numbered_ck" CHECK ("status" = 'BROUILLON' OR "number" IS NOT NULL),
	CONSTRAINT "purchase_documents_rate_ck" CHECK ("exchange_rate" > 0)
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "purchase_documents" ADD CONSTRAINT "purchase_documents_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "purchase_documents" ADD CONSTRAINT "purchase_documents_series_key_fk" FOREIGN KEY ("series_key") REFERENCES "public"."document_series"("key") ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "purchase_documents" ADD CONSTRAINT "purchase_documents_warehouse_key_fk" FOREIGN KEY ("warehouse_key") REFERENCES "public"."warehouses"("key") ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "purchase_documents" ADD CONSTRAINT "purchase_documents_origin_document_id_fk" FOREIGN KEY ("origin_document_id") REFERENCES "public"."purchase_documents"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "purchase_documents" ADD CONSTRAINT "purchase_documents_created_by_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "purchase_documents" ADD CONSTRAINT "purchase_documents_validated_by_id_fk" FOREIGN KEY ("validated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_documents_number_uq" ON "purchase_documents" USING btree ("number") WHERE "number" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_documents_supplier_invoice_uq" ON "purchase_documents" USING btree ("supplier_id", "supplier_ref") WHERE "type" = 'FACTURE' AND "status" <> 'BROUILLON' AND "supplier_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_documents_supplier_idx" ON "purchase_documents" USING btree ("supplier_id", "date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_documents_type_status_idx" ON "purchase_documents" USING btree ("type", "status", "date");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "purchase_document_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"product_id" uuid,
	"inventory_item_id" uuid,
	"ref" text,
	"designation" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_price" numeric(14, 4) DEFAULT '0' NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '20' NOT NULL,
	"net_ht_currency" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net_ht_mad" numeric(14, 2) DEFAULT '0' NOT NULL,
	"landed_mad" numeric(14, 2) DEFAULT '0' NOT NULL,
	"vat_mad" numeric(14, 2) DEFAULT '0' NOT NULL,
	"unit_cost_mad" numeric(14, 4),
	"lot_number" text,
	"expiry_date" date,
	"source_line_id" uuid,
	"received_qty" numeric(12, 3) DEFAULT '0' NOT NULL,
	"invoiced_qty" numeric(12, 3) DEFAULT '0' NOT NULL,
	"returned_qty" numeric(12, 3) DEFAULT '0' NOT NULL,
	CONSTRAINT "purchase_document_lines_target_ck" CHECK (("product_id" IS NOT NULL)::int + ("inventory_item_id" IS NOT NULL)::int <= 1),
	CONSTRAINT "purchase_document_lines_discount_ck" CHECK ("discount_pct" >= 0 AND "discount_pct" < 100),
	CONSTRAINT "purchase_document_lines_qty_ck" CHECK ("quantity" > 0)
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "purchase_document_lines" ADD CONSTRAINT "purchase_document_lines_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."purchase_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "purchase_document_lines" ADD CONSTRAINT "purchase_document_lines_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "purchase_document_lines" ADD CONSTRAINT "purchase_document_lines_inventory_item_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "purchase_document_lines" ADD CONSTRAINT "purchase_document_lines_source_line_id_fk" FOREIGN KEY ("source_line_id") REFERENCES "public"."purchase_document_lines"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_document_lines_document_idx" ON "purchase_document_lines" USING btree ("document_id", "position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_document_lines_product_idx" ON "purchase_document_lines" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_document_lines_source_idx" ON "purchase_document_lines" USING btree ("source_line_id");--> statement-breakpoint

-- Frais d'approche d'une réception (transport, douane, transit), répartis sur ses lignes.
CREATE TABLE IF NOT EXISTS "landed_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"label" text NOT NULL,
	"amount_mad" numeric(14, 2) NOT NULL,
	"allocation" text DEFAULT 'VALEUR' NOT NULL,
	"supplier_id" uuid,
	"ref" text,
	CONSTRAINT "landed_costs_allocation_ck" CHECK ("allocation" IN ('VALEUR', 'QUANTITE')),
	CONSTRAINT "landed_costs_amount_ck" CHECK ("amount_mad" >= 0)
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "landed_costs" ADD CONSTRAINT "landed_costs_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."purchase_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "landed_costs" ADD CONSTRAINT "landed_costs_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "landed_costs_document_idx" ON "landed_costs" USING btree ("document_id");--> statement-breakpoint

-- Une pièce d'achat numérotée n'est ni supprimée ni modifiée : seuls statut, clôture et compteurs évoluent.
CREATE OR REPLACE FUNCTION "purchase_documents_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."number" IS NOT NULL THEN
      RAISE EXCEPTION 'Pièce % : une pièce d''achat numérotée ne se supprime pas (clôture ou retour).', OLD."number";
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'BROUILLON' THEN
    IF NEW."status" = 'BROUILLON' THEN
      RAISE EXCEPTION 'Pièce % : une pièce validée ne redevient pas un brouillon.', OLD."number";
    END IF;
    IF (NEW."number", NEW."type", NEW."date", NEW."supplier_id", NEW."supplier_snapshot", NEW."supplier_ref", NEW."currency", NEW."exchange_rate",
        NEW."warehouse_key", NEW."origin_document_id", NEW."net_ht_currency", NEW."net_ht_mad", NEW."landed_mad", NEW."vat_mad", NEW."ttc_mad",
        NEW."vat_breakdown", NEW."series_key", NEW."due_date")
       IS DISTINCT FROM
       (OLD."number", OLD."type", OLD."date", OLD."supplier_id", OLD."supplier_snapshot", OLD."supplier_ref", OLD."currency", OLD."exchange_rate",
        OLD."warehouse_key", OLD."origin_document_id", OLD."net_ht_currency", OLD."net_ht_mad", OLD."landed_mad", OLD."vat_mad", OLD."ttc_mad",
        OLD."vat_breakdown", OLD."series_key", OLD."due_date") THEN
      RAISE EXCEPTION 'Pièce % : validée, elle n''est plus modifiable.', OLD."number";
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "purchase_documents_guard" ON "purchase_documents";--> statement-breakpoint
CREATE TRIGGER "purchase_documents_guard" BEFORE UPDATE OR DELETE ON "purchase_documents" FOR EACH ROW EXECUTE FUNCTION "purchase_documents_guard"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "purchase_document_children_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT "status" INTO st FROM "purchase_documents" WHERE "id" = COALESCE(NEW."document_id", OLD."document_id");
  IF st IS NULL OR st = 'BROUILLON' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'purchase_document_lines' THEN
    IF (NEW."document_id", NEW."product_id", NEW."inventory_item_id", NEW."designation", NEW."quantity", NEW."unit_price", NEW."discount_pct",
        NEW."tax_rate", NEW."net_ht_currency", NEW."net_ht_mad", NEW."landed_mad", NEW."vat_mad", NEW."unit_cost_mad", NEW."lot_number",
        NEW."expiry_date", NEW."source_line_id")
       IS NOT DISTINCT FROM
       (OLD."document_id", OLD."product_id", OLD."inventory_item_id", OLD."designation", OLD."quantity", OLD."unit_price", OLD."discount_pct",
        OLD."tax_rate", OLD."net_ht_currency", OLD."net_ht_mad", OLD."landed_mad", OLD."vat_mad", OLD."unit_cost_mad", OLD."lot_number",
        OLD."expiry_date", OLD."source_line_id") THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'Les lignes et frais d''une pièce d''achat validée ne se modifient pas.';
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "purchase_document_lines_guard" ON "purchase_document_lines";--> statement-breakpoint
CREATE TRIGGER "purchase_document_lines_guard" BEFORE INSERT OR UPDATE OR DELETE ON "purchase_document_lines" FOR EACH ROW EXECUTE FUNCTION "purchase_document_children_guard"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "landed_costs_guard" ON "landed_costs";--> statement-breakpoint
CREATE TRIGGER "landed_costs_guard" BEFORE INSERT OR UPDATE OR DELETE ON "landed_costs" FOR EACH ROW EXECUTE FUNCTION "purchase_document_children_guard"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "purchase_documents_no_truncate"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Les pièces d''achat ne s''effacent pas en masse.';
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "purchase_documents_no_truncate" ON "purchase_documents";--> statement-breakpoint
CREATE TRIGGER "purchase_documents_no_truncate" BEFORE TRUNCATE ON "purchase_documents" FOR EACH STATEMENT EXECUTE FUNCTION "purchase_documents_no_truncate"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "purchase_document_lines_no_truncate" ON "purchase_document_lines";--> statement-breakpoint
CREATE TRIGGER "purchase_document_lines_no_truncate" BEFORE TRUNCATE ON "purchase_document_lines" FOR EACH STATEMENT EXECUTE FUNCTION "purchase_documents_no_truncate"();--> statement-breakpoint

-- Fichiers : facture du fournisseur (PDF reçu) et PDF de la pièce.
ALTER TABLE "content_assets" ADD COLUMN IF NOT EXISTS "purchase_document_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_purchase_document_id_fk" FOREIGN KEY ("purchase_document_id") REFERENCES "public"."purchase_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "content_assets" DROP CONSTRAINT IF EXISTS "content_assets_owner_ck";--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_owner_ck" CHECK ((("content_id" IS NOT NULL)::int + ("activation_id" IS NOT NULL)::int + ("inventory_item_id" IS NOT NULL)::int + ("company_slot" IS NOT NULL)::int + ("sales_document_id" IS NOT NULL)::int + ("purchase_document_id" IS NOT NULL)::int) = 1);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_assets_purchase_document_idx" ON "content_assets" USING btree ("purchase_document_id", "kind", "version");--> statement-breakpoint

ALTER TABLE "purchase_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_document_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "landed_costs" ENABLE ROW LEVEL SECURITY;
