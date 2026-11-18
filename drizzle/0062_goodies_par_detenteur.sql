-- Goodies par détenteur (décision d'Hicham, 18/11/2026) : Sara choisit et commande les goodies, COMANET paie le fournisseur,
-- la réception entre au stock central au coût de revient, puis Sara les distribue aux animatrices. Un mouvement de matériel
-- porte désormais son détenteur (`holder_user_id`, NULL = stock central) ; `inventory_items.stock` reste le stock CENTRAL
-- (inventaire physique, imports, BL de sortie inchangés), le stock d'une personne est la somme de ses mouvements.
-- Un TRANSFERT écrit deux mouvements dans la même transaction (− chez qui donne, + chez qui reçoit), reliés par
-- `transfer_id`. Seule écriture : `recordMovement()` / `transferMaterial()` (src/lib/activations/inventory.ts).
-- Charge du matériel à l'achat : à la validation d'une facture fournisseur, une dépense marketing SPENT par ligne de
-- matériel (HT en MAD), idempotente par `marketing_expenses.purchase_line_id`, à partir de la date réglée
-- `settings.activations.materialChargeFrom` (avant : saisie manuelle, rien n'est compté deux fois).

ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "holder_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "transfer_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_holder_user_id_fk" FOREIGN KEY ("holder_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_movements_holder_idx" ON "inventory_movements" USING btree ("holder_user_id", "item_id") WHERE "holder_user_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_movements_transfer_idx" ON "inventory_movements" USING btree ("transfer_id") WHERE "transfer_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "marketing_expenses" ADD COLUMN IF NOT EXISTS "purchase_line_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "marketing_expenses" ADD CONSTRAINT "marketing_expenses_purchase_line_id_fk" FOREIGN KEY ("purchase_line_id") REFERENCES "public"."purchase_document_lines"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_expenses_purchase_line_uq" ON "marketing_expenses" USING btree ("purchase_line_id") WHERE "purchase_line_id" IS NOT NULL;
