-- Connexion des campagnes COMANET à la régie Meta.
--
-- Trois apports :
--  1. `campaign_ad_links` : le rattachement campagne COMANET ↔ campagne de régie, porté par
--     l'identifiant Meta (stable au renommage) plutôt que par le nom.
--  2. `ad_metrics` : identifiants externes, devise d'origine et provenance de la ligne.
--     Les comptes publicitaires COMANET sont en EUR et en USD : `spend`/`revenue` restent
--     en MAD, `*_original` + `fx_rate` gardent la trace de la conversion.
--  3. `ad_accounts` : de quoi piloter une synchronisation automatique (business, fuseau, activation).

CREATE TABLE IF NOT EXISTS "campaign_ad_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"external_campaign_id" text,
	"external_campaign_name" text NOT NULL,
	"match_key" text NOT NULL,
	"account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "campaign_ad_links" ADD CONSTRAINT "campaign_ad_links_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_ad_links" ADD CONSTRAINT "campaign_ad_links_account_id_ad_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "campaign_ad_links_uq" ON "campaign_ad_links" USING btree ("platform","match_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_ad_links_campaign_idx" ON "campaign_ad_links" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_ad_links_account_idx" ON "campaign_ad_links" USING btree ("account_id");--> statement-breakpoint

ALTER TABLE "campaign_ad_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "ad_metrics" ADD COLUMN IF NOT EXISTS "external_campaign_id" text;--> statement-breakpoint
ALTER TABLE "ad_metrics" ADD COLUMN IF NOT EXISTS "external_adset_id" text;--> statement-breakpoint
ALTER TABLE "ad_metrics" ADD COLUMN IF NOT EXISTS "external_ad_id" text;--> statement-breakpoint
ALTER TABLE "ad_metrics" ADD COLUMN IF NOT EXISTS "currency" text DEFAULT 'MAD' NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_metrics" ADD COLUMN IF NOT EXISTS "spend_original" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "ad_metrics" ADD COLUMN IF NOT EXISTS "revenue_original" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "ad_metrics" ADD COLUMN IF NOT EXISTS "fx_rate" numeric(12, 6);--> statement-breakpoint
ALTER TABLE "ad_metrics" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'IMPORT' NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_metrics" ADD COLUMN IF NOT EXISTS "attribution_window" text;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ad_metrics_external_campaign_idx" ON "ad_metrics" USING btree ("platform","external_campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_metrics_source_idx" ON "ad_metrics" USING btree ("account_id","date","source");--> statement-breakpoint

ALTER TABLE "ad_accounts" ADD COLUMN IF NOT EXISTS "business_id" text;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN IF NOT EXISTS "business_name" text;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN IF NOT EXISTS "timezone" text;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN IF NOT EXISTS "sync_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- Un compte se renomme dans Ads Manager ; son identifiant, non. Sans cet index, une
-- redécouverte après renommage insérerait un doublon au lieu de mettre à jour.
CREATE UNIQUE INDEX IF NOT EXISTS "ad_accounts_external_uq" ON "ad_accounts" USING btree ("platform","external_id");
