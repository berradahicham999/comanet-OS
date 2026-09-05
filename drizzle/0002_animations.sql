-- Sell-out animations : jours d'animation, ville, valorisation TTC des lignes, objectifs par ville × marque.
ALTER TYPE "public"."import_type" ADD VALUE IF NOT EXISTS 'ANIMATIONS';--> statement-breakpoint
ALTER TYPE "public"."import_type" ADD VALUE IF NOT EXISTS 'ANIM_OBJECTIVES';--> statement-breakpoint
ALTER TABLE "animations" ADD COLUMN "days" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "animations" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "animations" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "animations" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "animations" ADD CONSTRAINT "animations_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "animations_dedupe_uq" ON "animations" USING btree ("dedupe_key") WHERE dedupe_key is not null;--> statement-breakpoint
CREATE INDEX "animations_city_idx" ON "animations" USING btree ("city");--> statement-breakpoint
ALTER TABLE "animation_lines" ADD COLUMN "unit_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "animation_lines" ADD COLUMN "amount" numeric(14, 2);--> statement-breakpoint
CREATE INDEX "animation_lines_product_idx" ON "animation_lines" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "city" text;--> statement-breakpoint
CREATE TABLE "animation_objectives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"city" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer,
	"units" numeric(12, 2) NOT NULL,
	"amount" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "animation_objectives" ADD CONSTRAINT "animation_objectives_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "animation_objectives_uq" ON "animation_objectives" USING btree ("brand_id","city","year",coalesce("month", 0));
