-- Module Activations (Phase 3) : activations marketing hors digital, de l'idée à la mesure du retour.
--
-- Principes :
--  - `activations` reste LA table des activations (aucun second référentiel). Elle est étendue :
--    `type` et `status` deviennent des clés vers des tables de référence, les liaisons
--    multi-marques / produits / clients / contributeurs vivent dans des tables N-N.
--  - Types, statuts, transitions, objectifs, cibles, postes budgétaires, catégories
--    d'inventaire et modèles sont des TABLES de référence, modifiables depuis /parametres.
--  - Le budget d'une activation se rattache aux budgets marketing existants : chaque ligne
--    budgétaire validée est reflétée dans `marketing_expenses` (clé `activation_ref`), le
--    Command Center n'a rien de nouveau à lire.
--  - Les fichiers (devis, factures, photos, comptes rendus) réutilisent `content_assets`
--    (bytea), qui devient polymorphe : contenu OU activation OU article d'inventaire.
--  - L'inventaire matériel (PLV, échantillons, goodies, print) est distinct des échantillons
--    médicaux des délégués (`sample_movements`), qui suivent une logique par délégué.

-- Nouveau type d'import : inventaire matériel initial (articles + stock).
ALTER TYPE "public"."import_type" ADD VALUE IF NOT EXISTS 'INVENTORY';--> statement-breakpoint

/* ---------------------------- Référentiels ---------------------------- */

CREATE TABLE IF NOT EXISTS "activation_types" (
  "key" text PRIMARY KEY,
  "label" text NOT NULL,
  "icon" text,
  "sort" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  -- Module qui pilote ce type par défaut : 'marketing' (équipe marketing) ou 'clients' (trade).
  "default_module" text NOT NULL DEFAULT 'marketing',
  "default_budget_category" "budget_category" NOT NULL DEFAULT 'AUTRES',
  -- Checklist de préparation par défaut : ["Lieu réservé", "Invitations envoyées", …]
  "default_checklist" jsonb NOT NULL DEFAULT '[]'::jsonb
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "activation_statuses" (
  "key" text PRIMARY KEY,
  "label" text NOT NULL,
  "tone" text NOT NULL DEFAULT 'gray',
  "sort" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  -- Drapeaux lus par le code (aucun nom de statut en dur) :
  "awaiting_validation" boolean NOT NULL DEFAULT false, -- proposée, attend le DG
  "is_validated" boolean NOT NULL DEFAULT false,        -- budget engagé dans le Command Center
  "is_running" boolean NOT NULL DEFAULT false,          -- en cours
  "is_done" boolean NOT NULL DEFAULT false,             -- terminée (résultats attendus)
  "is_measured" boolean NOT NULL DEFAULT false,         -- résultats et ROI relus
  "is_archived" boolean NOT NULL DEFAULT false,
  "is_cancelled" boolean NOT NULL DEFAULT false
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "activation_status_transitions" (
  "from_key" text NOT NULL REFERENCES "activation_statuses"("key") ON DELETE CASCADE,
  "to_key" text NOT NULL REFERENCES "activation_statuses"("key") ON DELETE CASCADE,
  "requires_validator" boolean NOT NULL DEFAULT false,
  "requires_comment" boolean NOT NULL DEFAULT false,
  "label" text,
  PRIMARY KEY ("from_key", "to_key")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "activation_objectives" (
  "key" text PRIMARY KEY,
  "label" text NOT NULL,
  "sort" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "activation_targets" (
  "key" text PRIMARY KEY,
  "label" text NOT NULL,
  "sort" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true
);--> statement-breakpoint

-- Postes budgétaires d'une activation, chacun rattaché à une catégorie du budget marketing.
CREATE TABLE IF NOT EXISTS "activation_cost_items" (
  "key" text PRIMARY KEY,
  "label" text NOT NULL,
  "budget_category" "budget_category" NOT NULL DEFAULT 'AUTRES',
  "sort" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true
);--> statement-breakpoint

-- Catégories d'articles d'inventaire (PLV, échantillon, goodie, print), avec la catégorie
-- budgétaire alimentée quand une activation consomme du matériel.
CREATE TABLE IF NOT EXISTS "inventory_categories" (
  "key" text PRIMARY KEY,
  "label" text NOT NULL,
  "budget_category" "budget_category" NOT NULL DEFAULT 'PLV',
  "sort" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true
);--> statement-breakpoint

-- Modèles d'activation : créer une activation complète en moins d'une minute.
CREATE TABLE IF NOT EXISTS "activation_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "type_key" text REFERENCES "activation_types"("key") ON DELETE SET NULL,
  "brand_id" uuid REFERENCES "brands"("id") ON DELETE SET NULL,
  -- { objectiveKey, targetKey, description, prepOffsetDays, durationDays,
  --   budgetLines: [{ costItemKey, label, planned }], checklist: ["…"] }
  "defaults" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activation_templates_type_idx" ON "activation_templates" ("type_key");--> statement-breakpoint

/* ------------------------------ Données ------------------------------ */

INSERT INTO "activation_types" ("key", "label", "icon", "sort", "default_module", "default_budget_category", "default_checklist") VALUES
  ('EVENEMENT', 'Événement', 'PartyPopper', 1, 'marketing', 'EVENEMENT', '["Lieu réservé","Invitations envoyées","Programme et intervenants confirmés","PLV livrée sur place","Échantillons et goodies prêts","Brief animatrice / hôtesses","Photos prises","Compte rendu rédigé"]'),
  ('SPONSORING', 'Sponsoring / partenariat', 'Handshake', 2, 'marketing', 'SPONSORING', '["Contrat signé","Contreparties listées","Visuels transmis au partenaire","Présence le jour J","Retombées collectées"]'),
  ('SALON', 'Salon / congrès', 'Landmark', 3, 'marketing', 'CONGRES', '["Stand réservé","Badges commandés","PLV et kakémonos livrés","Échantillons expédiés","Planning de présence","Contacts collectés","Compte rendu rédigé"]'),
  ('PLV', 'PLV en pharmacie', 'LayoutPanelTop', 4, 'clients', 'PLV', '["Accord du pharmacien","Matériel sorti de l''inventaire","Installation faite","Photo de l''installation"]'),
  ('SAMPLING', 'Sampling / échantillons', 'FlaskConical', 5, 'clients', 'ECHANTILLONS', '["Quantités réservées","Échantillons sortis de l''inventaire","Distribution faite","Quantités distribuées saisies"]'),
  ('GOODIES', 'Goodies / cadeaux', 'Gift', 6, 'clients', 'GOODIES', '["Articles sortis de l''inventaire","Remise faite","Photo"]'),
  ('OPERATION_PHARMACIE', 'Opération pharmacie', 'Store', 7, 'clients', 'TRADE', '["Offre validée","Pharmacies ciblées listées","Supports imprimés","Équipe de vente briefée","Résultats de l''opération saisis"]'),
  ('RP', 'RP / presse', 'Newspaper', 8, 'marketing', 'AUTRES', '["Communiqué validé","Liste presse à jour","Envoi fait","Relances faites","Retombées collectées"]'),
  ('COLLABORATION', 'Collaboration expert / hors ligne', 'UserRound', 9, 'marketing', 'PRESCRIPTEURS', '["Accord de l''expert","Cachet et contrat","Contenu ou intervention réalisée","Retombées collectées"]'),
  ('AUTRE', 'Autre', 'Sparkles', 10, 'marketing', 'AUTRES', '[]')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

INSERT INTO "activation_statuses" ("key", "label", "tone", "sort", "awaiting_validation", "is_validated", "is_running", "is_done", "is_measured", "is_archived", "is_cancelled") VALUES
  ('IDEE', 'Idée', 'gray', 1, false, false, false, false, false, false, false),
  ('PROPOSEE', 'Proposée', 'yellow', 2, true, false, false, false, false, false, false),
  ('VALIDEE', 'Validée', 'blue', 3, false, true, false, false, false, false, false),
  ('EN_PREPARATION', 'En préparation', 'purple', 4, false, true, false, false, false, false, false),
  ('EN_COURS', 'En cours', 'accent', 5, false, true, true, false, false, false, false),
  ('TERMINEE', 'Terminée', 'green', 6, false, true, false, true, false, false, false),
  ('MESUREE', 'Mesurée', 'green', 7, false, true, false, true, true, false, false),
  ('ARCHIVEE', 'Archivée', 'gray', 8, false, true, false, true, true, true, false),
  ('ANNULEE', 'Annulée', 'red', 9, false, false, false, false, false, false, true)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

INSERT INTO "activation_status_transitions" ("from_key", "to_key", "requires_validator", "requires_comment", "label") VALUES
  ('IDEE', 'PROPOSEE', false, false, 'Proposer'),
  ('PROPOSEE', 'VALIDEE', true, false, 'Valider'),
  ('PROPOSEE', 'IDEE', true, true, 'Refuser'),
  ('VALIDEE', 'EN_PREPARATION', false, false, 'Lancer la préparation'),
  ('VALIDEE', 'PROPOSEE', true, true, 'Rouvrir la validation'),
  ('EN_PREPARATION', 'EN_COURS', false, false, 'Démarrer'),
  ('EN_PREPARATION', 'VALIDEE', false, false, 'Revenir à validée'),
  ('EN_COURS', 'TERMINEE', false, false, 'Terminer'),
  ('TERMINEE', 'MESUREE', false, false, 'Marquer mesurée'),
  ('TERMINEE', 'EN_COURS', false, false, 'Rouvrir'),
  ('MESUREE', 'ARCHIVEE', false, false, 'Archiver'),
  ('MESUREE', 'TERMINEE', false, false, 'Revoir les résultats'),
  ('TERMINEE', 'ARCHIVEE', false, false, 'Archiver'),
  ('IDEE', 'ANNULEE', false, false, 'Abandonner'),
  ('IDEE', 'ARCHIVEE', false, false, 'Archiver'),
  ('PROPOSEE', 'ANNULEE', false, true, 'Annuler'),
  ('VALIDEE', 'ANNULEE', true, true, 'Annuler'),
  ('EN_PREPARATION', 'ANNULEE', true, true, 'Annuler'),
  ('EN_COURS', 'ANNULEE', true, true, 'Annuler'),
  ('ANNULEE', 'IDEE', false, false, 'Réactiver'),
  ('ARCHIVEE', 'MESUREE', false, false, 'Désarchiver')
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "activation_objectives" ("key", "label", "sort") VALUES
  ('NOTORIETE', 'Notoriété', 1),
  ('RECRUTEMENT', 'Recrutement de pharmacies', 2),
  ('SELL_IN', 'Sell-in', 3),
  ('SELL_OUT', 'Sell-out', 4),
  ('FIDELISATION', 'Fidélisation', 5),
  ('LANCEMENT', 'Lancement', 6)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

INSERT INTO "activation_targets" ("key", "label", "sort") VALUES
  ('PHARMACIENS', 'Pharmaciens', 1),
  ('CONSOMMATEURS', 'Consommateurs', 2),
  ('PRESCRIPTEURS', 'Prescripteurs', 3),
  ('GROSSISTES', 'Grossistes', 4)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

INSERT INTO "activation_cost_items" ("key", "label", "budget_category", "sort") VALUES
  ('LIEU', 'Lieu / salle', 'EVENEMENT', 1),
  ('TRAITEUR', 'Traiteur / restauration', 'EVENEMENT', 2),
  ('MATERIEL', 'Matériel / location', 'EVENEMENT', 3),
  ('IMPRESSION', 'Impression / PLV', 'PLV', 4),
  ('TRANSPORT', 'Transport / logistique', 'AUTRES', 5),
  ('CACHET', 'Cachet intervenant / expert', 'PRESCRIPTEURS', 6),
  ('ECHANTILLONS', 'Échantillons', 'ECHANTILLONS', 7),
  ('GOODIES', 'Goodies / cadeaux', 'GOODIES', 8),
  ('HOTESSES', 'Hôtesses / animatrices', 'ANIMATION', 9),
  ('SPONSORING', 'Droits de sponsoring / stand', 'SPONSORING', 10),
  ('COMMUNICATION', 'Communication / relais', 'DIGITAL', 11),
  ('AGENCE', 'Agence / prestataire', 'AGENCE', 12),
  ('AUTRE', 'Autre', 'AUTRES', 13)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

INSERT INTO "inventory_categories" ("key", "label", "budget_category", "sort") VALUES
  ('PLV', 'PLV', 'PLV', 1),
  ('ECHANTILLON', 'Échantillon', 'ECHANTILLONS', 2),
  ('GOODIE', 'Goodie', 'GOODIES', 3),
  ('PRINT', 'Print', 'PLV', 4)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

INSERT INTO "activation_templates" ("name", "type_key", "defaults") VALUES
  ('Soirée de lancement pharmaciens', 'EVENEMENT', '{"objectiveKey":"LANCEMENT","targetKey":"PHARMACIENS","description":"Présentation de la gamme aux pharmaciens de la ville, avec dermatologue invité.","prepOffsetDays":21,"durationDays":1,"budgetLines":[{"costItemKey":"LIEU","label":"Salle","planned":15000},{"costItemKey":"TRAITEUR","label":"Cocktail","planned":12000},{"costItemKey":"CACHET","label":"Intervenant","planned":5000},{"costItemKey":"ECHANTILLONS","label":"Kits de découverte","planned":6000},{"costItemKey":"IMPRESSION","label":"Invitations et kakémonos","planned":3000}]}'),
  ('Formation pharmaciens en officine', 'EVENEMENT', '{"objectiveKey":"SELL_OUT","targetKey":"PHARMACIENS","description":"Formation de l''équipe officinale sur les protocoles de la marque.","prepOffsetDays":7,"durationDays":1,"budgetLines":[{"costItemKey":"ECHANTILLONS","label":"Échantillons de formation","planned":800},{"costItemKey":"GOODIES","label":"Cadeaux équipe","planned":500}]}'),
  ('Vitrine et présentoir en pharmacie', 'PLV', '{"objectiveKey":"SELL_OUT","targetKey":"CONSOMMATEURS","description":"Mise en avant vitrine + présentoir de comptoir pendant 4 semaines.","prepOffsetDays":5,"durationDays":28,"budgetLines":[{"costItemKey":"IMPRESSION","label":"Vitrophanie","planned":1500}]}'),
  ('Sampling en pharmacie', 'SAMPLING', '{"objectiveKey":"RECRUTEMENT","targetKey":"CONSOMMATEURS","description":"Distribution d''échantillons au comptoir avec fiche conseil.","prepOffsetDays":3,"durationDays":14,"budgetLines":[]}'),
  ('Offre pharmacie du mois', 'OPERATION_PHARMACIE', '{"objectiveKey":"SELL_IN","targetKey":"PHARMACIENS","description":"Offre de sell-in avec challenge vendeurs sur la gamme.","prepOffsetDays":10,"durationDays":30,"budgetLines":[{"costItemKey":"IMPRESSION","label":"Supports de l''offre","planned":2000},{"costItemKey":"GOODIES","label":"Dotation challenge","planned":4000}]}'),
  ('Stand salon / congrès', 'SALON', '{"objectiveKey":"NOTORIETE","targetKey":"PRESCRIPTEURS","description":"Stand sur un congrès professionnel.","prepOffsetDays":45,"durationDays":3,"budgetLines":[{"costItemKey":"SPONSORING","label":"Stand","planned":40000},{"costItemKey":"IMPRESSION","label":"Kakémonos et brochures","planned":6000},{"costItemKey":"TRANSPORT","label":"Déplacements","planned":8000},{"costItemKey":"ECHANTILLONS","label":"Échantillons","planned":5000}]}')
ON CONFLICT DO NOTHING;--> statement-breakpoint

/* ------------------------ Extension de activations ------------------------ */

ALTER TABLE "activations" ADD COLUMN IF NOT EXISTS "type_key" text;--> statement-breakpoint
UPDATE "activations" SET "type_key" = CASE
  WHEN "type" IN (SELECT "key" FROM "activation_types") THEN "type"
  WHEN "type" = 'PARTENARIAT' THEN 'SPONSORING'
  WHEN "type" = 'SHOOTING' THEN 'AUTRE'
  ELSE 'AUTRE' END
WHERE "type_key" IS NULL;--> statement-breakpoint
ALTER TABLE "activations" DROP COLUMN IF EXISTS "type";--> statement-breakpoint
ALTER TABLE "activations" RENAME COLUMN "type_key" TO "type";--> statement-breakpoint
ALTER TABLE "activations" ALTER COLUMN "type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "activations" ALTER COLUMN "type" SET DEFAULT 'AUTRE';--> statement-breakpoint
ALTER TABLE "activations" ADD CONSTRAINT "activations_type_fk" FOREIGN KEY ("type") REFERENCES "activation_types"("key");--> statement-breakpoint

ALTER TABLE "activations" ADD COLUMN IF NOT EXISTS "status_key" text;--> statement-breakpoint
UPDATE "activations" SET "status_key" = CASE "status"
  WHEN 'PLANNED' THEN 'VALIDEE' WHEN 'ACTIVE' THEN 'EN_COURS' WHEN 'DONE' THEN 'TERMINEE' WHEN 'CANCELLED' THEN 'ANNULEE'
  WHEN 'IDEE' THEN 'IDEE' ELSE 'IDEE' END
WHERE "status_key" IS NULL;--> statement-breakpoint
ALTER TABLE "activations" DROP COLUMN IF EXISTS "status";--> statement-breakpoint
ALTER TABLE "activations" RENAME COLUMN "status_key" TO "status";--> statement-breakpoint
ALTER TABLE "activations" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "activations" ALTER COLUMN "status" SET DEFAULT 'IDEE';--> statement-breakpoint
ALTER TABLE "activations" ADD CONSTRAINT "activations_status_fk" FOREIGN KEY ("status") REFERENCES "activation_statuses"("key");--> statement-breakpoint

ALTER TABLE "activations" ADD COLUMN IF NOT EXISTS "objective_key" text REFERENCES "activation_objectives"("key") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN IF NOT EXISTS "target_key" text REFERENCES "activation_targets"("key") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN IF NOT EXISTS "description" text;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN IF NOT EXISTS "prep_date" date;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN IF NOT EXISTS "validator_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN IF NOT EXISTS "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN IF NOT EXISTS "template_id" uuid REFERENCES "activation_templates"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN IF NOT EXISTS "linked_animation_id" uuid REFERENCES "animations"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN IF NOT EXISTS "validated_at" timestamptz;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN IF NOT EXISTS "measured_at" timestamptz;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();--> statement-breakpoint
-- Résultats post-activation (saisie légère, jamais obligatoire).
ALTER TABLE "activations" ADD COLUMN IF NOT EXISTS "pharmacies_reached" integer;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN IF NOT EXISTS "orders_on_site" integer;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN IF NOT EXISTS "orders_amount" numeric(14,2);--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN IF NOT EXISTS "press_mentions" integer;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN IF NOT EXISTS "results_at" timestamptz;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN IF NOT EXISTS "published_link" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activations_status_idx" ON "activations" ("status", "date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activations_type_idx" ON "activations" ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activations_city_idx" ON "activations" ("city");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activations_validator_idx" ON "activations" ("validator_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activations_created_by_idx" ON "activations" ("created_by_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activations_animation_idx" ON "activations" ("linked_animation_id");--> statement-breakpoint

/* ------------------------------ Liaisons ------------------------------ */

CREATE TABLE IF NOT EXISTS "activation_brands" (
  "activation_id" uuid NOT NULL REFERENCES "activations"("id") ON DELETE CASCADE,
  "brand_id" uuid NOT NULL REFERENCES "brands"("id") ON DELETE CASCADE,
  PRIMARY KEY ("activation_id", "brand_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activation_brands_brand_idx" ON "activation_brands" ("brand_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "activation_products" (
  "activation_id" uuid NOT NULL REFERENCES "activations"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  PRIMARY KEY ("activation_id", "product_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activation_products_product_idx" ON "activation_products" ("product_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "activation_clients" (
  "activation_id" uuid NOT NULL REFERENCES "activations"("id") ON DELETE CASCADE,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  PRIMARY KEY ("activation_id", "client_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activation_clients_client_idx" ON "activation_clients" ("client_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "activation_contributors" (
  "activation_id" uuid NOT NULL REFERENCES "activations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  PRIMARY KEY ("activation_id", "user_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activation_contributors_user_idx" ON "activation_contributors" ("user_id");--> statement-breakpoint

/* ------------------------------ Budget ------------------------------ */

-- Une ligne par poste : prévu (proposition), engagé (devis / bon de commande), dépensé (facture).
CREATE TABLE IF NOT EXISTS "activation_budget_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "activation_id" uuid NOT NULL REFERENCES "activations"("id") ON DELETE CASCADE,
  "cost_item_key" text NOT NULL REFERENCES "activation_cost_items"("key"),
  "brand_id" uuid REFERENCES "brands"("id") ON DELETE SET NULL,
  "label" text NOT NULL,
  "planned" numeric(14,2) NOT NULL DEFAULT 0,
  "committed" numeric(14,2) NOT NULL DEFAULT 0,
  "spent" numeric(14,2) NOT NULL DEFAULT 0,
  "supplier" text,
  "quote_ref" text,
  "invoice_ref" text,
  "date" date,
  "notes" text,
  "sort" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activation_budget_lines_activation_idx" ON "activation_budget_lines" ("activation_id", "sort");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activation_budget_lines_brand_idx" ON "activation_budget_lines" ("brand_id");--> statement-breakpoint

-- Reflet dans marketing_expenses : `activation_ref` identifie la ligne d'origine
-- ('LINE:<uuid>' ou 'MATERIAL:<catégorie>') pour une synchronisation idempotente.
ALTER TABLE "marketing_expenses" ADD COLUMN IF NOT EXISTS "activation_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_expenses_activation_ref_uq" ON "marketing_expenses" ("activation_id", "activation_ref") WHERE "activation_ref" IS NOT NULL;--> statement-breakpoint

/* ------------------------------ Checklist ------------------------------ */

CREATE TABLE IF NOT EXISTS "activation_checklist_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "activation_id" uuid NOT NULL REFERENCES "activations"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "done" boolean NOT NULL DEFAULT false,
  "done_at" timestamptz,
  "done_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "due_date" date,
  "assignee_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "sort" integer NOT NULL DEFAULT 0
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activation_checklist_activation_idx" ON "activation_checklist_items" ("activation_id", "sort");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activation_checklist_assignee_idx" ON "activation_checklist_items" ("assignee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activation_checklist_done_by_idx" ON "activation_checklist_items" ("done_by_id");--> statement-breakpoint

/* --------------------- Commentaires et historique --------------------- */

CREATE TABLE IF NOT EXISTS "activation_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "activation_id" uuid NOT NULL REFERENCES "activations"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "body" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activation_comments_activation_idx" ON "activation_comments" ("activation_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activation_comments_user_idx" ON "activation_comments" ("user_id");--> statement-breakpoint

-- Historique des statuts : qui, quand, commentaire. Jamais purgé.
CREATE TABLE IF NOT EXISTS "activation_status_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "activation_id" uuid NOT NULL REFERENCES "activations"("id") ON DELETE CASCADE,
  "from_status" text,
  "to_status" text NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "comment" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activation_status_history_activation_idx" ON "activation_status_history" ("activation_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activation_status_history_user_idx" ON "activation_status_history" ("user_id");--> statement-breakpoint

/* ------------------------------ Inventaire ------------------------------ */

CREATE TABLE IF NOT EXISTS "inventory_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "sku" text,
  "category_key" text NOT NULL REFERENCES "inventory_categories"("key"),
  "brand_id" uuid REFERENCES "brands"("id") ON DELETE SET NULL,
  "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL,
  "unit" text NOT NULL DEFAULT 'pièce',
  "unit_cost" numeric(12,2) NOT NULL DEFAULT 0,
  -- Stock courant, maintenu à chaque mouvement (une seule écriture, dans la même transaction).
  "stock" integer NOT NULL DEFAULT 0,
  "alert_threshold" integer,
  "location" text,
  "notes" text,
  "active" boolean NOT NULL DEFAULT true,
  "import_id" uuid REFERENCES "imports"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_items_name_uq" ON "inventory_items" (lower("name"), coalesce("brand_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_items_brand_idx" ON "inventory_items" ("brand_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_items_product_idx" ON "inventory_items" ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_items_category_idx" ON "inventory_items" ("category_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_items_import_idx" ON "inventory_items" ("import_id");--> statement-breakpoint

-- Mouvements signés : ENTREE (+), SORTIE (−, liée à une activation ou libre), AJUSTEMENT (±).
CREATE TABLE IF NOT EXISTS "inventory_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "item_id" uuid NOT NULL REFERENCES "inventory_items"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "quantity" integer NOT NULL,
  "unit_cost" numeric(12,2),
  "activation_id" uuid REFERENCES "activations"("id") ON DELETE SET NULL,
  "client_id" uuid REFERENCES "clients"("id") ON DELETE SET NULL,
  "reason" text,
  "date" date NOT NULL,
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "import_id" uuid REFERENCES "imports"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_movements_item_idx" ON "inventory_movements" ("item_id", "date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_movements_activation_idx" ON "inventory_movements" ("activation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_movements_client_idx" ON "inventory_movements" ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_movements_user_idx" ON "inventory_movements" ("created_by_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_movements_import_idx" ON "inventory_movements" ("import_id");--> statement-breakpoint

-- Matériel consommé par une activation : article × quantité, valorisé au coût du moment.
CREATE TABLE IF NOT EXISTS "activation_materials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "activation_id" uuid NOT NULL REFERENCES "activations"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "inventory_items"("id") ON DELETE CASCADE,
  "quantity" integer NOT NULL,
  "unit_cost" numeric(12,2) NOT NULL DEFAULT 0,
  "movement_id" uuid REFERENCES "inventory_movements"("id") ON DELETE SET NULL,
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activation_materials_activation_idx" ON "activation_materials" ("activation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activation_materials_item_idx" ON "activation_materials" ("item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activation_materials_movement_idx" ON "activation_materials" ("movement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activation_materials_user_idx" ON "activation_materials" ("created_by_id");--> statement-breakpoint

/* ------------------------------ Fichiers ------------------------------ */

-- content_assets devient polymorphe : un fichier appartient à un contenu, une activation
-- ou un article d'inventaire (exactement un des trois).
ALTER TABLE "content_assets" ALTER COLUMN "content_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "content_assets" ADD COLUMN IF NOT EXISTS "activation_id" uuid REFERENCES "activations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "content_assets" ADD COLUMN IF NOT EXISTS "inventory_item_id" uuid REFERENCES "inventory_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "content_assets" DROP CONSTRAINT IF EXISTS "content_assets_owner_ck";--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_owner_ck" CHECK (
  (("content_id" IS NOT NULL)::int + ("activation_id" IS NOT NULL)::int + ("inventory_item_id" IS NOT NULL)::int) = 1
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_assets_activation_idx" ON "content_assets" ("activation_id", "kind", "version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_assets_inventory_idx" ON "content_assets" ("inventory_item_id", "kind", "version");
