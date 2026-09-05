-- Marketing Command Center : campagnes enrichies, régie publicitaire, influence, activations.
-- Aucune table existante n'est remplacée : on étend campaigns / marketing_expenses / content_items
-- et on branche les nouvelles entités sur brands, products, clients, users et tasks.
ALTER TYPE "public"."campaign_status" ADD VALUE IF NOT EXISTS 'PLANNED' BEFORE 'ACTIVE';--> statement-breakpoint
ALTER TYPE "public"."campaign_status" ADD VALUE IF NOT EXISTS 'ANALYZED';--> statement-breakpoint
ALTER TYPE "public"."import_type" ADD VALUE IF NOT EXISTS 'ADS';--> statement-breakpoint

-- Campagnes : fiche de pilotage complète
ALTER TABLE "campaigns" ADD COLUMN "type" text DEFAULT 'AWARENESS' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "audience" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "message" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "offer" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "kpi_target" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "kpi_actual" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "responsible_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_responsible_id_users_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_brand_idx" ON "campaigns" USING btree ("brand_id","start_date");--> statement-breakpoint

CREATE TABLE "campaign_products" (
	"campaign_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	CONSTRAINT "campaign_products_pk" PRIMARY KEY("campaign_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "campaign_products" ADD CONSTRAINT "campaign_products_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_products" ADD CONSTRAINT "campaign_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Régie publicitaire : comptes, synchronisation, métriques quotidiennes, créatives
CREATE TABLE "ad_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"name" text NOT NULL,
	"external_id" text,
	"brand_id" uuid,
	"currency" text DEFAULT 'MAD' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"sync_status" text DEFAULT 'MANUAL' NOT NULL,
	"last_error" text,
	"imported_rows" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_accounts_uq" ON "ad_accounts" USING btree ("platform","name");--> statement-breakpoint

CREATE TABLE "ad_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"platform" text NOT NULL,
	"account_id" uuid,
	"brand_id" uuid,
	"campaign_id" uuid,
	"campaign_name" text NOT NULL,
	"adset_name" text,
	"ad_name" text,
	"spend" numeric(14, 2) DEFAULT '0' NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"reach" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"link_clicks" integer DEFAULT 0 NOT NULL,
	"landing_page_views" integer DEFAULT 0 NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"purchases" integer DEFAULT 0 NOT NULL,
	"revenue" numeric(14, 2) DEFAULT '0' NOT NULL,
	"dedupe_key" text NOT NULL,
	"import_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_metrics" ADD CONSTRAINT "ad_metrics_account_id_ad_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_metrics" ADD CONSTRAINT "ad_metrics_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_metrics" ADD CONSTRAINT "ad_metrics_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_metrics" ADD CONSTRAINT "ad_metrics_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_metrics_dedupe_uq" ON "ad_metrics" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "ad_metrics_date_idx" ON "ad_metrics" USING btree ("date");--> statement-breakpoint
CREATE INDEX "ad_metrics_brand_idx" ON "ad_metrics" USING btree ("brand_id","date");--> statement-breakpoint
CREATE INDEX "ad_metrics_campaign_idx" ON "ad_metrics" USING btree ("campaign_name");--> statement-breakpoint

CREATE TABLE "ad_creatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"ad_name" text NOT NULL,
	"format" text,
	"hook" text,
	"product_id" uuid,
	"content_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_content_id_content_items_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_creatives_uq" ON "ad_creatives" USING btree ("platform","ad_name");--> statement-breakpoint

-- Influence
CREATE TABLE "influencers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"instagram" text,
	"tiktok" text,
	"followers" integer,
	"engagement_rate" numeric(6, 2),
	"audience" text,
	"city" text,
	"country" text DEFAULT 'Maroc',
	"category" text,
	"usual_rate" numeric(12, 2),
	"contact" text,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "influencers_name_uq" ON "influencers" USING btree (lower("name"));--> statement-breakpoint

CREATE TABLE "collaborations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"influencer_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"product_id" uuid,
	"campaign_id" uuid,
	"date" date NOT NULL,
	"content_type" text,
	"stories" integer DEFAULT 0 NOT NULL,
	"reels" integer DEFAULT 0 NOT NULL,
	"posts" integer DEFAULT 0 NOT NULL,
	"fee" numeric(12, 2) DEFAULT '0' NOT NULL,
	"product_value" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'PROSPECT' NOT NULL,
	"reach" integer,
	"impressions" integer,
	"views" integer,
	"likes" integer,
	"comments" integer,
	"shares" integer,
	"saves" integer,
	"link_clicks" integer,
	"promo_code" text,
	"conversions" integer,
	"attributed_revenue" numeric(14, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collaborations" ADD CONSTRAINT "collaborations_influencer_id_influencers_id_fk" FOREIGN KEY ("influencer_id") REFERENCES "public"."influencers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaborations" ADD CONSTRAINT "collaborations_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaborations" ADD CONSTRAINT "collaborations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaborations" ADD CONSTRAINT "collaborations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collaborations_date_idx" ON "collaborations" USING btree ("date");--> statement-breakpoint
CREATE INDEX "collaborations_influencer_idx" ON "collaborations" USING btree ("influencer_id");--> statement-breakpoint

-- Activations marketing (événement, sponsoring, PLV, shooting, sampling…)
CREATE TABLE "activations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'EVENEMENT' NOT NULL,
	"brand_id" uuid,
	"product_id" uuid,
	"campaign_id" uuid,
	"client_id" uuid,
	"date" date NOT NULL,
	"end_date" date,
	"place" text,
	"city" text,
	"responsible_id" uuid,
	"objective" text,
	"budget_planned" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"participants" integer,
	"leads" integer,
	"samples" integer,
	"new_clients" integer,
	"attributed_revenue" numeric(14, 2),
	"results" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activations" ADD CONSTRAINT "activations_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activations" ADD CONSTRAINT "activations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activations" ADD CONSTRAINT "activations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activations" ADD CONSTRAINT "activations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activations" ADD CONSTRAINT "activations_responsible_id_users_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activations_date_idx" ON "activations" USING btree ("date");--> statement-breakpoint

-- Dépenses : rattachables à une activation, une collaboration, un produit
ALTER TABLE "marketing_expenses" ADD COLUMN "activation_id" uuid;--> statement-breakpoint
ALTER TABLE "marketing_expenses" ADD COLUMN "collaboration_id" uuid;--> statement-breakpoint
ALTER TABLE "marketing_expenses" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "marketing_expenses" ADD CONSTRAINT "marketing_expenses_activation_id_activations_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."activations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_expenses" ADD CONSTRAINT "marketing_expenses_collaboration_id_collaborations_id_fk" FOREIGN KEY ("collaboration_id") REFERENCES "public"."collaborations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_expenses" ADD CONSTRAINT "marketing_expenses_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Contenus : reliés à une campagne, une activation, une influenceuse, avec un budget
ALTER TABLE "content_items" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "activation_id" uuid;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "influencer_id" uuid;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "budget" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_activation_id_activations_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."activations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_influencer_id_influencers_id_fk" FOREIGN KEY ("influencer_id") REFERENCES "public"."influencers"("id") ON DELETE set null ON UPDATE no action;
