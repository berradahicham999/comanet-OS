-- Inventaires : compteurs désignés (notifiés à la préparation et à l'ouverture du comptage) et matériel marketing
-- (goodies, PLV, print : `inventory_items`) compté dans la même session que les produits. Une ligne ou une saisie
-- porte un produit OU un article de matériel, jamais les deux.
ALTER TABLE "stock_counts" ADD COLUMN IF NOT EXISTS "counter_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_counts" ADD COLUMN IF NOT EXISTS "include_materials" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_count_lines" ALTER COLUMN "product_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD COLUMN IF NOT EXISTS "inventory_item_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_inventory_item_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_article_ck" CHECK (num_nonnulls("product_id", "inventory_item_id") = 1);
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "stock_count_lines_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_count_lines_uq" ON "stock_count_lines" USING btree ("count_id", coalesce("product_id", "inventory_item_id"), coalesce("lot_number", ''));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_count_lines_item_idx" ON "stock_count_lines" USING btree ("inventory_item_id");
--> statement-breakpoint
ALTER TABLE "stock_count_entries" ALTER COLUMN "product_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_count_entries" ADD COLUMN IF NOT EXISTS "inventory_item_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_inventory_item_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_article_ck" CHECK (num_nonnulls("product_id", "inventory_item_id") = 1);
EXCEPTION WHEN duplicate_object THEN null; END $$;
