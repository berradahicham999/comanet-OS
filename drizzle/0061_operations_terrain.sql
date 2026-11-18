-- Opérations terrain (décision d'Hicham, 18/11/2026) : une animatrice crée elle-même son opération ; sous le seuil
-- `settings.activations.autoApproveMax` (500 MAD par défaut) elle part directement au statut « Planifiée », au-dessus
-- elle attend la direction. Le seuil est contrôlé par `transitionActivation()`, jamais par le référentiel seul.
-- Offre proposée au client (texte libre), goodies prévus (pris dans le stock au compte rendu), poste « Offre / UG »
-- chiffré dans le budget de l'opération sans être reflété en dépense marketing (les UG d'un BL sont déjà dans le coût
-- des ventes du P&L).

ALTER TABLE "activations" ADD COLUMN IF NOT EXISTS "offer_label" text;
--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN IF NOT EXISTS "planned_materials" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "activation_cost_items" ADD COLUMN IF NOT EXISTS "reflects_expense" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
INSERT INTO "activation_cost_items" ("key", "label", "budget_category", "sort", "reflects_expense") VALUES
  ('OFFRE_UG', 'Offre / UG', 'TRADE', 14, false)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "activation_types" ("key", "label", "icon", "sort", "default_module", "default_budget_category", "default_checklist") VALUES
  ('GROSSISTE', 'Action grossiste', 'Truck', 0, 'clients', 'TRADE', '["Offre convenue avec le grossiste","Goodies préparés","Visite faite","Commandes notées","Photos prises"]'),
  ('EVENEMENT_PARA', 'Événement en parapharmacie', 'PartyPopper', 0, 'clients', 'EVENEMENT', '["Date convenue avec la parapharmacie","Goodies et matériel prêts","Événement fait","Photos prises"]')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "activation_statuses" ("key", "label", "tone", "sort", "awaiting_validation", "is_validated", "is_running", "is_done", "is_measured", "is_archived", "is_cancelled") VALUES
  ('PLANIFIEE', 'Planifiée', 'blue', 3, false, true, false, false, false, false, false)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "activation_status_transitions" ("from_key", "to_key", "requires_validator", "requires_comment", "label") VALUES
  ('IDEE', 'PLANIFIEE', false, false, 'Planifier'),
  ('PLANIFIEE', 'PROPOSEE', false, false, 'Demander une validation'),
  ('PLANIFIEE', 'EN_COURS', false, false, 'Démarrer'),
  ('PLANIFIEE', 'TERMINEE', false, false, 'Clôturer'),
  ('PLANIFIEE', 'ANNULEE', false, false, 'Annuler'),
  ('VALIDEE', 'TERMINEE', false, false, 'Clôturer'),
  ('EN_PREPARATION', 'TERMINEE', false, false, 'Clôturer')
ON CONFLICT DO NOTHING;
