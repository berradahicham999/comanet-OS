CREATE TYPE "public"."animation_status" AS ENUM('PLANNED', 'DONE', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."budget_category" AS ENUM('META', 'TIKTOK', 'GOOGLE', 'DIGITAL', 'INFLUENCE', 'UGC', 'CREATION', 'SHOOTING', 'EVENEMENT', 'SPONSORING', 'TRADE', 'PLV', 'ANIMATION', 'GOODIES', 'ECHANTILLONS', 'PRESCRIPTEURS', 'CONGRES', 'AGENCE', 'AUTRES');--> statement-breakpoint
CREATE TYPE "public"."campaign_channel" AS ENUM('META', 'TIKTOK', 'GOOGLE', 'INFLUENCE', 'TRADE', 'EVENEMENT', 'AUTRE');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('DRAFT', 'ACTIVE', 'PAUSED', 'DONE');--> statement-breakpoint
CREATE TYPE "public"."client_type" AS ENUM('PHARMACIE', 'PARAPHARMACIE', 'GROSSISTE', 'AUTRE');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('IDEE', 'BRIEF', 'CREATION', 'VALIDATION', 'PROGRAMME', 'PUBLIE', 'ANALYSE');--> statement-breakpoint
CREATE TYPE "public"."expense_status" AS ENUM('PLANNED', 'COMMITTED', 'SPENT');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('PENDING', 'DONE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."import_type" AS ENUM('SALES', 'CLIENTS', 'PRODUCTS', 'STOCK', 'OBJECTIVES', 'BUDGETS');--> statement-breakpoint
CREATE TYPE "public"."regulatory_status" AS ENUM('A_DEPOSER', 'EN_COURS', 'VALIDE', 'RENOUVELLEMENT', 'EXPIRE');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."task_source" AS ENUM('MANUAL', 'ACTION_CENTER', 'REGLEMENTAIRE', 'STOCK', 'MARKETING', 'TERRAIN', 'COMMERCIAL');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'MARKETING', 'REGLEMENTAIRE', 'TRADE', 'ANIMATRICE');--> statement-breakpoint
CREATE TABLE "animation_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"animation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity_sold" integer DEFAULT 0 NOT NULL,
	"stock_observed" integer
);
--> statement-breakpoint
CREATE TABLE "animations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"client_id" uuid NOT NULL,
	"animatrice_id" uuid,
	"brand_id" uuid,
	"status" "animation_status" DEFAULT 'PLANNED' NOT NULL,
	"cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"duration_hours" numeric(5, 1),
	"customers_advised" integer DEFAULT 0 NOT NULL,
	"samples" integer DEFAULT 0 NOT NULL,
	"comment" text,
	"photo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"color" text DEFAULT '#0f766e' NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"positioning" text,
	"target" text,
	"objectives" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"label" text NOT NULL,
	"category" "budget_category" DEFAULT 'AUTRES' NOT NULL,
	"amount" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"reference_revenue" numeric(14, 2),
	"pct_of_revenue" numeric(6, 2),
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"channel" "campaign_channel" DEFAULT 'META' NOT NULL,
	"objective" text,
	"start_date" date,
	"end_date" date,
	"budget" numeric(14, 2),
	"status" "campaign_status" DEFAULT 'DRAFT' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_aliases" (
	"alias" text PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"source" text DEFAULT 'IMPORT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"name_key" text NOT NULL,
	"name" text NOT NULL,
	"type" "client_type" DEFAULT 'AUTRE' NOT NULL,
	"city" text,
	"channel" text,
	"sales_rep" text,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_name_key_unique" UNIQUE("name_key")
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"brand_id" uuid NOT NULL,
	"product_id" uuid,
	"title" text NOT NULL,
	"format" text,
	"platform" text,
	"objective" text,
	"brief" text,
	"responsible_id" uuid,
	"status" "content_status" DEFAULT 'IDEE' NOT NULL,
	"link" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"uploaded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"data" "bytea" NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "import_type" NOT NULL,
	"file_name" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"inserted_rows" integer DEFAULT 0 NOT NULL,
	"updated_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "import_status" DEFAULT 'PENDING' NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"campaign_id" uuid,
	"category" "budget_category" NOT NULL,
	"label" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" "expense_status" DEFAULT 'PLANNED' NOT NULL,
	"date" date NOT NULL,
	"attributed_revenue" numeric(14, 2),
	"conversions" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "objectives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid,
	"product_id" uuid,
	"year" integer NOT NULL,
	"month" integer,
	"amount" numeric(14, 2) NOT NULL,
	"units" numeric(12, 2)
);
--> statement-breakpoint
CREATE TABLE "product_aliases" (
	"alias" text PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"source" text DEFAULT 'IMPORT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid,
	"sku" text,
	"name_key" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"category" text,
	"price_retail" numeric(12, 2),
	"price_wholesale" numeric(12, 2),
	"cost_price" numeric(12, 2),
	"lead_time_days" integer DEFAULT 60 NOT NULL,
	"moq" integer,
	"safety_stock_days" integer DEFAULT 30 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"benefits" text,
	"claims" text,
	"actives" text,
	"target" text,
	"marketing_angle" text,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_name_key_unique" UNIQUE("name_key")
);
--> statement-breakpoint
CREATE TABLE "regulatory_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"brand_id" uuid,
	"dossier" text NOT NULL,
	"authorization_number" text,
	"filing_date" date,
	"validation_date" date,
	"expiry_date" date,
	"status" "regulatory_status" DEFAULT 'EN_COURS' NOT NULL,
	"missing_documents" text,
	"responsible_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"client_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"invoice_ref" text,
	"lvc_ref" text,
	"site" text,
	"sales_rep" text,
	"unit_price" numeric(12, 4),
	"raw_client" text,
	"raw_product" text,
	"line_hash" text NOT NULL,
	"import_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"on_order" numeric(12, 2) DEFAULT '0' NOT NULL,
	"date" date NOT NULL,
	"source" text DEFAULT 'IMPORT' NOT NULL,
	"import_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'TODO' NOT NULL,
	"priority" "task_priority" DEFAULT 'MEDIUM' NOT NULL,
	"due_date" date,
	"assignee_id" uuid,
	"created_by_id" uuid,
	"brand_id" uuid,
	"source" "task_source" DEFAULT 'MANUAL' NOT NULL,
	"source_key" text,
	"entity_type" text,
	"entity_id" uuid,
	"expected_impact" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'TRADE' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "animation_lines" ADD CONSTRAINT "animation_lines_animation_id_animations_id_fk" FOREIGN KEY ("animation_id") REFERENCES "public"."animations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animation_lines" ADD CONSTRAINT "animation_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animations" ADD CONSTRAINT "animations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animations" ADD CONSTRAINT "animations_animatrice_id_users_id_fk" FOREIGN KEY ("animatrice_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animations" ADD CONSTRAINT "animations_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_aliases" ADD CONSTRAINT "client_aliases_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_responsible_id_users_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_files" ADD CONSTRAINT "import_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_expenses" ADD CONSTRAINT "marketing_expenses_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_expenses" ADD CONSTRAINT "marketing_expenses_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_aliases" ADD CONSTRAINT "product_aliases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulatory_files" ADD CONSTRAINT "regulatory_files_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulatory_files" ADD CONSTRAINT "regulatory_files_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulatory_files" ADD CONSTRAINT "regulatory_files_responsible_id_users_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_snapshots" ADD CONSTRAINT "stock_snapshots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_snapshots" ADD CONSTRAINT "stock_snapshots_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "animation_lines_animation_idx" ON "animation_lines" USING btree ("animation_id");--> statement-breakpoint
CREATE INDEX "animations_date_idx" ON "animations" USING btree ("date");--> statement-breakpoint
CREATE INDEX "animations_client_idx" ON "animations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "animations_animatrice_idx" ON "animations" USING btree ("animatrice_id");--> statement-breakpoint
CREATE INDEX "budget_lines_brand_year_idx" ON "budget_lines" USING btree ("brand_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_brand_year_uq" ON "budgets" USING btree ("brand_id","year");--> statement-breakpoint
CREATE INDEX "clients_city_idx" ON "clients" USING btree ("city");--> statement-breakpoint
CREATE INDEX "clients_rep_idx" ON "clients" USING btree ("sales_rep");--> statement-breakpoint
CREATE INDEX "clients_code_idx" ON "clients" USING btree ("code");--> statement-breakpoint
CREATE INDEX "content_date_idx" ON "content_items" USING btree ("date");--> statement-breakpoint
CREATE INDEX "expenses_brand_date_idx" ON "marketing_expenses" USING btree ("brand_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "objectives_scope_uq" ON "objectives" USING btree (coalesce("brand_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("product_id", '00000000-0000-0000-0000-000000000000'::uuid),"year",coalesce("month", 0));--> statement-breakpoint
CREATE INDEX "products_brand_idx" ON "products" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_sku_uq" ON "products" USING btree ("sku") WHERE sku is not null;--> statement-breakpoint
CREATE INDEX "regulatory_expiry_idx" ON "regulatory_files" USING btree ("expiry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_line_hash_uq" ON "sales" USING btree ("line_hash");--> statement-breakpoint
CREATE INDEX "sales_date_idx" ON "sales" USING btree ("date");--> statement-breakpoint
CREATE INDEX "sales_client_idx" ON "sales" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "sales_product_idx" ON "sales" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sales_site_idx" ON "sales" USING btree ("site");--> statement-breakpoint
CREATE INDEX "stock_product_date_idx" ON "stock_snapshots" USING btree ("product_id","date");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_source_key_idx" ON "tasks" USING btree ("source_key");