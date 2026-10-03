-- Commandes clients (bon de commande saisi par le commercial, transformé en BL en un clic).
-- Un quatrième type de pièce de vente, COMMANDE, dans les mêmes tables : série BC, statuts
-- Brouillon → Confirmée (VALIDE) → Livrée en partie (LIVRE_PARTIEL) → Livrée (LIVRE), ou Annulée.
-- Le BL préparé depuis une commande reprend ses lignes (source_line_id) et fait avancer la
-- quantité livrée de la commande ; les triggers de la migration 0026 figent tout le reste.

INSERT INTO "document_series" ("key", "label", "pattern", "sort") VALUES
	('BC', 'Commandes clients', 'BC{AAAA}{N:5}', 5)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

ALTER TABLE "sales_documents" DROP CONSTRAINT IF EXISTS "sales_documents_type_ck";--> statement-breakpoint
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_type_ck" CHECK ("type" IN ('COMMANDE', 'BL', 'FACTURE', 'AVOIR'));--> statement-breakpoint
ALTER TABLE "sales_documents" DROP CONSTRAINT IF EXISTS "sales_documents_status_ck";--> statement-breakpoint
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_status_ck" CHECK ("status" IN ('BROUILLON', 'VALIDE', 'LIVRE_PARTIEL', 'LIVRE', 'FACTURE_PARTIEL', 'FACTURE', 'ANNULE'));--> statement-breakpoint

ALTER TABLE "sales_document_lines" ADD COLUMN IF NOT EXISTS "delivered_qty" numeric(12, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_document_lines" DROP CONSTRAINT IF EXISTS "sales_document_lines_delivered_ck";--> statement-breakpoint
ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_delivered_ck" CHECK ("delivered_qty" >= 0);--> statement-breakpoint

-- Carnet de commandes : lignes d'une commande confirmée qui restent à livrer.
CREATE INDEX IF NOT EXISTS "sales_documents_open_orders_idx" ON "sales_documents" USING btree ("status", "date") WHERE "type" = 'COMMANDE';
