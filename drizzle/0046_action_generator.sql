-- Générateur d'actions marketing : une action générée garde son modèle (non-répétition), sa fiche complète figée
-- (concept, budget détaillé, rétroplanning, KPI, hypothèses), l'activation qui l'exécute et son jour J.
-- Aucune ligne existante modifiée : les nouvelles colonnes restent NULL sur les actions déjà créées.

ALTER TYPE "public"."marketing_action_source" ADD VALUE IF NOT EXISTS 'GENERATOR';--> statement-breakpoint
ALTER TABLE "marketing_actions" ADD COLUMN IF NOT EXISTS "template_key" text;--> statement-breakpoint
ALTER TABLE "marketing_actions" ADD COLUMN IF NOT EXISTS "spec" jsonb;--> statement-breakpoint
ALTER TABLE "marketing_actions" ADD COLUMN IF NOT EXISTS "activation_id" uuid REFERENCES "activations"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "marketing_actions" ADD COLUMN IF NOT EXISTS "event_date" date;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_actions_template_idx" ON "marketing_actions" USING btree ("brand_id", "template_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_actions_activation_idx" ON "marketing_actions" USING btree ("activation_id");
