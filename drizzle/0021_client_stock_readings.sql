-- Relevés de stock chez le client (point de vente = client). Idempotente : rejouable sans erreur.
DO $$ BEGIN
  CREATE TYPE "public"."client_stock_channel" AS ENUM('ANIMATION', 'TOURNEE_COMMERCIALE', 'IMPORT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_stock_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"read_at" date NOT NULL,
	"user_id" uuid,
	"channel" "client_stock_channel" NOT NULL,
	"animation_id" uuid,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "client_stock_readings" ADD CONSTRAINT "client_stock_readings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "client_stock_readings" ADD CONSTRAINT "client_stock_readings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "client_stock_readings" ADD CONSTRAINT "client_stock_readings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "client_stock_readings" ADD CONSTRAINT "client_stock_readings_animation_id_animations_id_fk" FOREIGN KEY ("animation_id") REFERENCES "public"."animations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_stock_readings_client_product_date_idx" ON "client_stock_readings" USING btree ("client_id","product_id","read_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_stock_readings_animation_idx" ON "client_stock_readings" USING btree ("animation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_stock_readings_user_idx" ON "client_stock_readings" USING btree ("user_id");
