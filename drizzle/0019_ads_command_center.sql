-- Ads Command Center : historique Meta 2023→, catalogue des objets publicitaires, mémoire marketing, journal de synchro.
--
-- Principes :
--  - Aucun second référentiel : `ad_entities.brand_id` / `product_id` pointent vers `brands` / `products`.
--  - `ad_metrics` reste le journal jour × publicité (source unique de la dépense) ; on lui ajoute la créative,
--    les vues vidéo et les engagements pour que l'historique puisse être analysé par créative.
--  - Rien n'est supprimé.

ALTER TABLE "ad_accounts" ADD COLUMN IF NOT EXISTS "backfill_cursor" date;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN IF NOT EXISTS "backfill_status" text DEFAULT 'IDLE' NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN IF NOT EXISTS "backfill_error" text;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN IF NOT EXISTS "backfill_updated_at" timestamptz;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN IF NOT EXISTS "backfill_gaps" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint

ALTER TABLE "ad_metrics" ADD COLUMN IF NOT EXISTS "external_creative_id" text;--> statement-breakpoint
ALTER TABLE "ad_metrics" ADD COLUMN IF NOT EXISTS "video_views" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_metrics" ADD COLUMN IF NOT EXISTS "post_engagement" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_metrics_external_ad_idx" ON "ad_metrics" ("platform", "external_ad_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_metrics_creative_idx" ON "ad_metrics" ("external_creative_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ad_entities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "platform" text NOT NULL,
  "level" text NOT NULL,
  "external_id" text NOT NULL,
  "account_id" uuid REFERENCES "ad_accounts"("id") ON DELETE CASCADE,
  "parent_external_id" text,
  "external_campaign_id" text,
  "external_adset_id" text,
  "external_creative_id" text,
  "name" text NOT NULL,
  "status" text,
  "effective_status" text,
  "objective" text,
  "created_time" timestamptz,
  "start_time" timestamptz,
  "stop_time" timestamptz,
  "title" text,
  "body" text,
  "thumbnail_url" text,
  "image_url" text,
  "video_id" text,
  "object_type" text,
  "call_to_action" text,
  "link_url" text,
  "brand_id" uuid REFERENCES "brands"("id") ON DELETE SET NULL,
  "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL,
  "product_source" text,
  "tags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "tags_source" text DEFAULT 'AUTO' NOT NULL,
  "fetched_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ad_entities_uq" ON "ad_entities" ("platform", "level", "external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_entities_account_idx" ON "ad_entities" ("account_id", "level");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_entities_campaign_idx" ON "ad_entities" ("external_campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_entities_product_idx" ON "ad_entities" ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_entities_brand_idx" ON "ad_entities" ("brand_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ad_sync_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid REFERENCES "ad_accounts"("id") ON DELETE CASCADE,
  "mode" text NOT NULL,
  "since" date,
  "until" date,
  "rows" integer DEFAULT 0 NOT NULL,
  "ok" boolean NOT NULL,
  "error" text,
  "started_at" timestamptz NOT NULL,
  "finished_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_sync_log_account_idx" ON "ad_sync_log" ("account_id", "finished_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ad_memory" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL UNIQUE,
  "scope" text NOT NULL,
  "brand_id" uuid REFERENCES "brands"("id") ON DELETE CASCADE,
  "product_id" uuid REFERENCES "products"("id") ON DELETE CASCADE,
  "statement" text NOT NULL,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "confidence" integer DEFAULT 0 NOT NULL,
  "computed_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_memory_brand_idx" ON "ad_memory" ("brand_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_memory_scope_idx" ON "ad_memory" ("scope");
