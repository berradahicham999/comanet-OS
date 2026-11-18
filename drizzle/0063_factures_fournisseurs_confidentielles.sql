-- Achats confidentiels (décision d'Hicham, 18/11/2026) : seul le module Achats ouvre les pièces d'achat (le droit Stock
-- ne suffit plus pour voir réceptions et retours), et les factures fournisseurs demandent en plus l'interrupteur
-- « Voir les factures fournisseurs ». Il est activé pour les administrateurs ; les autres comptes s'activent depuis
-- Paramètres → Utilisateurs & droits.

ALTER TABLE "user_flags" ADD COLUMN IF NOT EXISTS "see_supplier_invoices" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "user_flags" f SET "see_supplier_invoices" = true
WHERE EXISTS (SELECT 1 FROM "user_permissions" p WHERE p."user_id" = f."user_id" AND p."module" = 'administration' AND p."can_validate");
--> statement-breakpoint
UPDATE "role_templates" SET "flags" = "flags" || '{"seeSupplierInvoices":true}'::jsonb WHERE "name" = 'Administrateur';
