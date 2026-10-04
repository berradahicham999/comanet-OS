-- Studio créatif (Intelligence contenu) : concepts générés (empreinte, score, statut humain, lien vers le planning
-- éditorial, instantané de performance) et packages de contenu (script, découpage, variations, brief, revue).
-- Les opportunités créatives sont recalculées à chaque lecture et ne sont jamais stockées.

CREATE TABLE IF NOT EXISTS "creative_concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL REFERENCES "brands"("id") ON DELETE cascade,
	"product_id" uuid REFERENCES "products"("id") ON DELETE set null,
	"opportunity_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"territory" text NOT NULL,
	"mechanic" text NOT NULL,
	"tension_key" text NOT NULL,
	"hook_type" text NOT NULL,
	"format" text NOT NULL,
	"funnel_stage" text NOT NULL,
	"objective" text NOT NULL,
	"title" text NOT NULL,
	"concept" jsonb NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'PROPOSED' NOT NULL,
	"reject_reason" text,
	"content_item_id" uuid REFERENCES "content_items"("id") ON DELETE set null,
	"generated_by" text DEFAULT 'RULES' NOT NULL,
	"model" text,
	"created_by_id" uuid REFERENCES "users"("id") ON DELETE set null,
	"decided_by_id" uuid REFERENCES "users"("id") ON DELETE set null,
	"decided_at" timestamp with time zone,
	"performance" jsonb,
	"performance_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creative_concepts_brand_status_idx" ON "creative_concepts" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creative_concepts_opportunity_idx" ON "creative_concepts" USING btree ("opportunity_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creative_concepts_fingerprint_idx" ON "creative_concepts" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creative_concepts_product_idx" ON "creative_concepts" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creative_concepts_content_idx" ON "creative_concepts" USING btree ("content_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creative_concepts_created_by_idx" ON "creative_concepts" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creative_concepts_decided_by_idx" ON "creative_concepts" USING btree ("decided_by_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "creative_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concept_id" uuid NOT NULL REFERENCES "creative_concepts"("id") ON DELETE cascade,
	"version" integer DEFAULT 1 NOT NULL,
	"package" jsonb NOT NULL,
	"variations" jsonb,
	"brief_md" text DEFAULT '' NOT NULL,
	"review" jsonb,
	"model" text,
	"created_by_id" uuid REFERENCES "users"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creative_packages_concept_idx" ON "creative_packages" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creative_packages_created_by_idx" ON "creative_packages" USING btree ("created_by_id");
