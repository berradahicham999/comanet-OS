-- Historique des rapports d'animation (création, correction, suppression). Idempotente : rejouable sans erreur.
-- Pas de clé étrangère vers animations : l'historique d'un rapport supprimé reste consultable.
CREATE TABLE IF NOT EXISTS "animation_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"animation_id" uuid NOT NULL,
	"actor_id" uuid,
	"actor_name" text NOT NULL,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "animation_revisions" ADD CONSTRAINT "animation_revisions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "animation_revisions_animation_idx" ON "animation_revisions" USING btree ("animation_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "animation_revisions_created_idx" ON "animation_revisions" USING btree ("created_at" DESC NULLS LAST);
