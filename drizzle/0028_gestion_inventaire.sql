-- Gestion commerciale — lot 4 : inventaires (sessions, comptage à plusieurs, à l'aveugle, rapprochement,
-- motifs, ajustements dans le journal). Idempotente et additive : l'ancien code la supporte.

CREATE TABLE IF NOT EXISTS "count_gap_reasons" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);--> statement-breakpoint
INSERT INTO "count_gap_reasons" ("key", "label", "sort") VALUES
	('ERREUR_COMPTAGE', 'Erreur de comptage précédente', 10),
	('CASSE', 'Casse non déclarée', 20),
	('PERIME', 'Périmé détruit non déclaré', 30),
	('ECHANTILLON', 'Échantillons sortis sans mouvement', 40),
	('SAISIE', 'Pièce saisie en retard ou oubliée (BL, réception, retour)', 50),
	('VOL', 'Vol ou perte', 60),
	('INCONNU', 'Cause inconnue', 90)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "stock_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"series_key" text,
	"fiscal_year" integer,
	"title" text NOT NULL,
	"status" text DEFAULT 'BROUILLON' NOT NULL,
	"warehouse_key" text DEFAULT 'PRINCIPAL' NOT NULL,
	"brand_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blind" boolean DEFAULT true NOT NULL,
	"count_date" date NOT NULL,
	"notes" text,
	"started_at" timestamp with time zone,
	"started_by_id" uuid,
	"validated_at" timestamp with time zone,
	"validated_by_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"stats" jsonb,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_counts_status_ck" CHECK ("status" IN ('BROUILLON', 'EN_COURS', 'VALIDE', 'ANNULE')),
	CONSTRAINT "stock_counts_numbered_ck" CHECK ("status" <> 'VALIDE' OR "number" IS NOT NULL)
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_warehouse_key_fk" FOREIGN KEY ("warehouse_key") REFERENCES "public"."warehouses"("key") ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_series_key_fk" FOREIGN KEY ("series_key") REFERENCES "public"."document_series"("key") ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_created_by_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_counts_number_uq" ON "stock_counts" USING btree ("number") WHERE "number" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_counts_status_idx" ON "stock_counts" USING btree ("status", "count_date");--> statement-breakpoint

-- Une ligne par article × lot du périmètre : théorique et CMUP figés au démarrage du comptage.
CREATE TABLE IF NOT EXISTS "stock_count_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"count_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_number" text,
	"expiry_date" date,
	"theoretical_qty" numeric(12, 3) DEFAULT '0' NOT NULL,
	"cmup" numeric(14, 4),
	"counted_qty" numeric(12, 3),
	"gap_qty" numeric(12, 3),
	"gap_value" numeric(14, 2),
	"reason_key" text,
	"comment" text,
	"added_during_count" boolean DEFAULT false NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."stock_counts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_reason_key_fk" FOREIGN KEY ("reason_key") REFERENCES "public"."count_gap_reasons"("key") ON DELETE no action ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_count_lines_uq" ON "stock_count_lines" USING btree ("count_id", "product_id", coalesce("lot_number", ''));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_count_lines_product_idx" ON "stock_count_lines" USING btree ("product_id");--> statement-breakpoint

-- Une saisie par compteur et par passage ; le compté d'une ligne est la somme de ses saisies.
CREATE TABLE IF NOT EXISTS "stock_count_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"count_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_number" text,
	"expiry_date" date,
	"quantity" numeric(12, 3) NOT NULL,
	"counter_id" uuid,
	"counter_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_count_entries_qty_ck" CHECK ("quantity" >= 0)
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_count_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."stock_counts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_counter_id_fk" FOREIGN KEY ("counter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_count_entries_count_idx" ON "stock_count_entries" USING btree ("count_id", "product_id");--> statement-breakpoint

-- Un inventaire validé est figé : ni suppression, ni retour en arrière, ni modification de ses lignes et saisies.
CREATE OR REPLACE FUNCTION "stock_counts_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'BROUILLON' THEN
      RAISE EXCEPTION 'Inventaire % : commencé, il ne se supprime pas (annulez-le).', coalesce(OLD."number", OLD."title");
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" IN ('VALIDE', 'ANNULE') THEN
    RAISE EXCEPTION 'Inventaire % : clos, il n''est plus modifiable.', coalesce(OLD."number", OLD."title");
  END IF;
  IF OLD."status" = 'EN_COURS' AND NEW."status" = 'BROUILLON' THEN
    RAISE EXCEPTION 'Inventaire % : un comptage commencé ne revient pas en préparation.', OLD."title";
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "stock_counts_guard" ON "stock_counts";--> statement-breakpoint
CREATE TRIGGER "stock_counts_guard" BEFORE UPDATE OR DELETE ON "stock_counts" FOR EACH ROW EXECUTE FUNCTION "stock_counts_guard"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "stock_count_children_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT "status" INTO st FROM "stock_counts" WHERE "id" = COALESCE(NEW."count_id", OLD."count_id");
  IF st IS NULL OR st IN ('BROUILLON', 'EN_COURS') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'Les lignes et saisies d''un inventaire clos ne se modifient pas.';
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "stock_count_lines_guard" ON "stock_count_lines";--> statement-breakpoint
CREATE TRIGGER "stock_count_lines_guard" BEFORE INSERT OR UPDATE OR DELETE ON "stock_count_lines" FOR EACH ROW EXECUTE FUNCTION "stock_count_children_guard"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "stock_count_entries_guard" ON "stock_count_entries";--> statement-breakpoint
CREATE TRIGGER "stock_count_entries_guard" BEFORE INSERT OR UPDATE OR DELETE ON "stock_count_entries" FOR EACH ROW EXECUTE FUNCTION "stock_count_children_guard"();--> statement-breakpoint

ALTER TABLE "count_gap_reasons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_counts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_count_entries" ENABLE ROW LEVEL SECURITY;
