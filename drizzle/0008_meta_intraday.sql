-- Reporting Meta en continu : journée en cours, verrou de synchronisation, état de diffusion.
--
-- Trois apports :
--  1. `ad_metrics.is_partial` / `synced_at` : une journée non close est marquée comme telle.
--     Sans ce marqueur, la journée en cours entrerait dans les moyennes et les comparaisons et
--     afficherait un CPA faussement élevé — les conversions arrivent après la dépense.
--     Colonne explicite plutôt que `date = current_date` : la journée d'un compte publicitaire
--     est découpée dans SON fuseau, pas dans celui du serveur ni dans Africa/Casablanca.
--  2. `ad_accounts.sync_started_at` : verrou. Un passage horaire ne doit pas empiler une
--     seconde synchronisation sur un compte déjà en cours (cron + bouton « Actualiser »).
--  3. `ad_campaign_states` : instantané de l'état de diffusion et des budgets, relu à chaque
--     passage. C'est ce qui manque pour agir en cours de journée : savoir qu'une campagne est
--     en pause ou a épuisé son budget. Table à part : `ad_metrics` reste le journal des
--     métriques quotidiennes, pas un état courant.

ALTER TABLE "ad_metrics" ADD COLUMN IF NOT EXISTS "is_partial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_metrics" ADD COLUMN IF NOT EXISTS "synced_at" timestamp with time zone;--> statement-breakpoint

-- Toutes les lectures d'analyse filtrent sur les journées closes : l'index porte le filtre.
CREATE INDEX IF NOT EXISTS "ad_metrics_partial_idx" ON "ad_metrics" USING btree ("date","is_partial");--> statement-breakpoint

ALTER TABLE "ad_accounts" ADD COLUMN IF NOT EXISTS "sync_started_at" timestamp with time zone;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ad_campaign_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"external_campaign_id" text NOT NULL,
	"account_id" uuid,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"effective_status" text,
	"objective" text,
	-- Budgets convertis en MAD avec le taux SAISI, comme les dépenses. Le montant d'origine
	-- et le taux appliqué restent sur la ligne : un budget en dirhams n'est jamais deviné.
	"daily_budget" numeric(14, 2),
	"lifetime_budget" numeric(14, 2),
	"budget_remaining" numeric(14, 2),
	"daily_budget_original" numeric(14, 2),
	"currency" text DEFAULT 'MAD' NOT NULL,
	"fx_rate" numeric(12, 6),
	"start_time" timestamp with time zone,
	"stop_time" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "ad_campaign_states" ADD CONSTRAINT "ad_campaign_states_account_id_ad_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Une campagne de régie n'a qu'un état courant : le passage suivant met à jour, n'empile pas.
CREATE UNIQUE INDEX IF NOT EXISTS "ad_campaign_states_uq" ON "ad_campaign_states" USING btree ("platform","external_campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_campaign_states_account_idx" ON "ad_campaign_states" USING btree ("account_id");--> statement-breakpoint

ALTER TABLE "ad_campaign_states" ENABLE ROW LEVEL SECURITY;
