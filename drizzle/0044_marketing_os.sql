-- Marketing Operating System : plan marketing, axes, plan mensuel, actions budgétées, décisions unifiées.
-- Aucune donnée existante n'est transformée : le budget du plan est la ligne `budgets`, son CA objectif
-- la ligne `objectives` annuelle, son allocation par canal les `budget_lines`. Les colonnes ajoutées aux
-- tables existantes (axe du plan, action d'origine d'une dépense) restent NULL sur l'historique.

ALTER TYPE "public"."task_status" ADD VALUE IF NOT EXISTS 'BLOCKED';--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."marketing_plan_status" AS ENUM('DRAFT', 'ACTIVE', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."marketing_action_source" AS ENUM('PLAN', 'DECISION', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."marketing_decision_status" AS ENUM('PROPOSED', 'APPROVED', 'REJECTED', 'EXECUTED', 'MEASURED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "marketing_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL REFERENCES "brands"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"year" integer NOT NULL,
	"status" "marketing_plan_status" DEFAULT 'DRAFT' NOT NULL,
	"notes" text,
	"created_by_id" uuid REFERENCES "users"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_plans_brand_year_idx" ON "marketing_plans" USING btree ("brand_id", "year");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_plans_created_by_idx" ON "marketing_plans" USING btree ("created_by_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "marketing_plan_objectives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL REFERENCES "marketing_plans"("id") ON DELETE cascade,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"target" numeric(14, 2),
	"unit" text DEFAULT 'MAD' NOT NULL,
	"product_id" uuid REFERENCES "products"("id") ON DELETE set null,
	"notes" text,
	"sort" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_plan_objectives_plan_idx" ON "marketing_plan_objectives" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_plan_objectives_product_idx" ON "marketing_plan_objectives" USING btree ("product_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "marketing_axes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL REFERENCES "marketing_plans"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"product_id" uuid REFERENCES "products"("id") ON DELETE set null,
	"product_range" text,
	"objective_id" uuid REFERENCES "marketing_plan_objectives"("id") ON DELETE set null,
	"budget" numeric(14, 2) DEFAULT '0' NOT NULL,
	"period_start" date,
	"period_end" date,
	"notes" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_axes_plan_idx" ON "marketing_axes" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_axes_product_idx" ON "marketing_axes" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_axes_objective_idx" ON "marketing_axes" USING btree ("objective_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "marketing_plan_months" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL REFERENCES "marketing_plans"("id") ON DELETE cascade,
	"month" date NOT NULL,
	"focus_product_id" uuid REFERENCES "products"("id") ON DELETE set null,
	"objective" text,
	"budget" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_plan_months_uq" ON "marketing_plan_months" USING btree ("plan_id", "month");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_plan_months_product_idx" ON "marketing_plan_months" USING btree ("focus_product_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "marketing_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid REFERENCES "marketing_plans"("id") ON DELETE set null,
	"axis_id" uuid REFERENCES "marketing_axes"("id") ON DELETE set null,
	"month" date,
	"brand_id" uuid NOT NULL REFERENCES "brands"("id") ON DELETE cascade,
	"product_id" uuid REFERENCES "products"("id") ON DELETE set null,
	"campaign_id" uuid REFERENCES "campaigns"("id") ON DELETE set null,
	"category" "budget_category",
	"title" text NOT NULL,
	"objective" text,
	"why" text,
	"expected_result" text,
	"budget_planned" numeric(14, 2) DEFAULT '0' NOT NULL,
	"source" "marketing_action_source" DEFAULT 'MANUAL' NOT NULL,
	"decision_key" text,
	"task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE cascade,
	"created_by_id" uuid REFERENCES "users"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_actions_task_uq" ON "marketing_actions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_actions_plan_idx" ON "marketing_actions" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_actions_axis_idx" ON "marketing_actions" USING btree ("axis_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_actions_brand_month_idx" ON "marketing_actions" USING btree ("brand_id", "month");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_actions_product_idx" ON "marketing_actions" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_actions_campaign_idx" ON "marketing_actions" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_actions_decision_idx" ON "marketing_actions" USING btree ("decision_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_actions_created_by_idx" ON "marketing_actions" USING btree ("created_by_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "marketing_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"domain" text NOT NULL,
	"brand_id" uuid REFERENCES "brands"("id") ON DELETE set null,
	"product_id" uuid REFERENCES "products"("id") ON DELETE set null,
	"title" text NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "marketing_decision_status" DEFAULT 'PROPOSED' NOT NULL,
	"reason" text,
	"decided_by_id" uuid REFERENCES "users"("id") ON DELETE set null,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"action_id" uuid REFERENCES "marketing_actions"("id") ON DELETE set null,
	"expected_review_date" date,
	"measured_note" text,
	"measured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_decisions_key_unique" UNIQUE("key")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_decisions_status_idx" ON "marketing_decisions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_decisions_brand_idx" ON "marketing_decisions" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_decisions_product_idx" ON "marketing_decisions" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_decisions_action_idx" ON "marketing_decisions" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_decisions_decided_by_idx" ON "marketing_decisions" USING btree ("decided_by_id");--> statement-breakpoint

-- Rattachements facultatifs des modules existants au plan (NULL sur l'historique, jamais fabriqué).
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "axis_id" uuid REFERENCES "marketing_axes"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_axis_idx" ON "campaigns" USING btree ("axis_id");--> statement-breakpoint
ALTER TABLE "collaborations" ADD COLUMN IF NOT EXISTS "axis_id" uuid REFERENCES "marketing_axes"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collaborations_axis_idx" ON "collaborations" USING btree ("axis_id");--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN IF NOT EXISTS "axis_id" uuid REFERENCES "marketing_axes"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activations_axis_idx" ON "activations" USING btree ("axis_id");--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN IF NOT EXISTS "axis_id" uuid REFERENCES "marketing_axes"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_items_axis_idx" ON "content_items" USING btree ("axis_id");--> statement-breakpoint
ALTER TABLE "marketing_expenses" ADD COLUMN IF NOT EXISTS "action_id" uuid REFERENCES "marketing_actions"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_expenses_action_idx" ON "marketing_expenses" USING btree ("action_id");
