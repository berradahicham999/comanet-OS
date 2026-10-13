-- Ventes en bloc depuis les pièces, sorties marketing par BL, P&L réel (docs/plan-sorties-marketing-pnl.md).
-- Idempotente. Aucune donnée client modifiée ici : le passage des fiches « échantillons … » en clients internes se fait
-- depuis la fiche client.

-- Natures de sortie marketing (référentiel modifiable).
CREATE TABLE IF NOT EXISTS "marketing_output_natures" (
  "key" text PRIMARY KEY NOT NULL,
  "label" text NOT NULL,
  "sort" integer DEFAULT 0 NOT NULL,
  "active" boolean DEFAULT true NOT NULL
);--> statement-breakpoint
INSERT INTO "marketing_output_natures" ("key", "label", "sort") VALUES
  ('ANIMATION', 'Animation', 1),
  ('MEDICAL', 'Médical', 2),
  ('DIGITAL', 'Digital (influence, UGC)', 3),
  ('COMMERCIAL', 'Commercial / trade', 4)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

-- Client interne « sorties marketing » et sa nature.
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "is_internal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "output_nature_key" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "clients" ADD CONSTRAINT "clients_output_nature_key_fk" FOREIGN KEY ("output_nature_key") REFERENCES "public"."marketing_output_natures"("key") ON DELETE no action ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "clients" DROP CONSTRAINT IF EXISTS "clients_internal_nature_ck";--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_internal_nature_ck" CHECK (NOT "is_internal" OR "output_nature_key" IS NOT NULL);--> statement-breakpoint

-- BL rattaché à une activation.
ALTER TABLE "sales_documents" ADD COLUMN IF NOT EXISTS "activation_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_activation_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."activations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- Lignes de pièce : produit OU article de matériel, coût figé.
ALTER TABLE "sales_document_lines" ADD COLUMN IF NOT EXISTS "inventory_item_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_document_lines" ADD COLUMN IF NOT EXISTS "unit_cost" numeric(12, 2);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_inventory_item_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "sales_document_lines" DROP CONSTRAINT IF EXISTS "sales_document_lines_product_or_item_ck";--> statement-breakpoint
ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_product_or_item_ck" CHECK ("product_id" IS NULL OR "inventory_item_id" IS NULL);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_document_lines_item_idx" ON "sales_document_lines" USING btree ("inventory_item_id");--> statement-breakpoint

-- Gel des lignes validées : l'article de matériel et le coût figé rejoignent les colonnes protégées.
CREATE OR REPLACE FUNCTION "sales_document_lines_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT "status" INTO st FROM "sales_documents" WHERE "id" = COALESCE(NEW."document_id", OLD."document_id");
  IF st IS NULL OR st = 'BROUILLON' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW."document_id", NEW."product_id", NEW."inventory_item_id", NEW."unit_cost", NEW."lot_id", NEW."warehouse_key", NEW."ref", NEW."designation", NEW."quantity", NEW."free_quantity",
        NEW."unit_price_ht", NEW."public_price_ttc", NEW."discount_pct", NEW."gross_ht", NEW."net_ht", NEW."tax_rate", NEW."vat_amount", NEW."ttc",
        NEW."source_line_id", NEW."lot_allocations", NEW."return_warehouse_key")
       IS NOT DISTINCT FROM
       (OLD."document_id", OLD."product_id", OLD."inventory_item_id", OLD."unit_cost", OLD."lot_id", OLD."warehouse_key", OLD."ref", OLD."designation", OLD."quantity", OLD."free_quantity",
        OLD."unit_price_ht", OLD."public_price_ttc", OLD."discount_pct", OLD."gross_ht", OLD."net_ht", OLD."tax_rate", OLD."vat_amount", OLD."ttc",
        OLD."source_line_id", OLD."lot_allocations", OLD."return_warehouse_key") THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'Les lignes d''une pièce validée ne se modifient pas (corriger par un avoir).';
END $$;--> statement-breakpoint

-- Mouvements de matériel : ligne de BL d'origine et contre-mouvement d'annulation.
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "document_line_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "reversal_of" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_document_line_id_fk" FOREIGN KEY ("document_line_id") REFERENCES "public"."sales_document_lines"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_reversal_of_fk" FOREIGN KEY ("reversal_of") REFERENCES "public"."inventory_movements"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_movements_document_line_idx" ON "inventory_movements" USING btree ("document_line_id");--> statement-breakpoint

-- Charges d'échantillons nées d'un BL : ligne d'origine, client servi, nature.
ALTER TABLE "marketing_expenses" ADD COLUMN IF NOT EXISTS "document_line_id" uuid;--> statement-breakpoint
ALTER TABLE "marketing_expenses" ADD COLUMN IF NOT EXISTS "client_id" uuid;--> statement-breakpoint
ALTER TABLE "marketing_expenses" ADD COLUMN IF NOT EXISTS "output_nature" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "marketing_expenses" ADD CONSTRAINT "marketing_expenses_document_line_id_fk" FOREIGN KEY ("document_line_id") REFERENCES "public"."sales_document_lines"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "marketing_expenses" ADD CONSTRAINT "marketing_expenses_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_expenses_document_line_uq" ON "marketing_expenses" USING btree ("document_line_id") WHERE "document_line_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_expenses_client_idx" ON "marketing_expenses" USING btree ("client_id");--> statement-breakpoint

-- Matériel : la charge naît à l'achat. Une sortie pour activation ne crée plus de dépense (elle reste tracée et valorisée
-- dans `activation_materials`) : les anciens reflets « MATERIAL: » sont retirés.
DELETE FROM "marketing_expenses" WHERE "activation_ref" LIKE 'MATERIAL:%';
