-- Avoir libre (sans facture d'origine) avec des articles : chaque motif dit ce que devient la marchandise.
-- `return_warehouse_key` = dépôt interne où rentre le produit rendu (NULL = aucun mouvement de stock) ;
-- `with_return` reste la lecture courte (P&L, inventaires) et suit toujours le dépôt (contrainte).
ALTER TABLE "credit_reasons" ADD COLUMN IF NOT EXISTS "return_warehouse_key" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "credit_reasons" ADD CONSTRAINT "credit_reasons_return_warehouse_key_warehouses_key_fk" FOREIGN KEY ("return_warehouse_key") REFERENCES "public"."warehouses"("key") ON DELETE no action ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- Les quatre catégories : retour en bon état → entrepôt vendable ; périmé ou abîmé → dépôt non vendable ;
-- produit crédité sans retour → aucun mouvement ; financier (prix, remise, objectifs) → aucun mouvement.
UPDATE "credit_reasons" SET "return_warehouse_key" = 'NON_VENDABLE' WHERE "key" = 'PERIME' AND "with_return" AND "return_warehouse_key" IS NULL
  AND EXISTS (SELECT 1 FROM "warehouses" WHERE "key" = 'NON_VENDABLE');--> statement-breakpoint
UPDATE "credit_reasons" SET "return_warehouse_key" = 'PRINCIPAL' WHERE "with_return" AND "return_warehouse_key" IS NULL;--> statement-breakpoint
UPDATE "credit_reasons" SET "label" = 'Retour en bon état (remis en stock)' WHERE "key" = 'RETOUR' AND "label" = 'Retour de marchandise';--> statement-breakpoint
UPDATE "credit_reasons" SET "label" = 'Retour périmé ou abîmé (dépôt non vendable)' WHERE "key" = 'PERIME' AND "label" = 'Produit périmé ou abîmé';--> statement-breakpoint
INSERT INTO "credit_reasons" ("key", "label", "with_return", "sort") VALUES
	('SANS_RETOUR', 'Produit crédité sans retour (casse, perte, détruit chez le client)', false, 25)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "credit_reasons" ADD CONSTRAINT "credit_reasons_with_return_check" CHECK ("with_return" = ("return_warehouse_key" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN null; END $$;
