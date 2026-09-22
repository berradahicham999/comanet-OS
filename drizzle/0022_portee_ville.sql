-- Portée par ville et « toutes les marques » (Utilisateurs et droits). Idempotente : rejouable sans erreur.
ALTER TABLE "user_scope" ADD COLUMN IF NOT EXISTS "all_brands" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_city_assignments" (
	"user_id" uuid NOT NULL,
	"city" text NOT NULL,
	CONSTRAINT "user_city_assignments_user_id_city_pk" PRIMARY KEY("user_id","city")
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_city_assignments" ADD CONSTRAINT "user_city_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
