-- App mobile, phase P1a (docs/plan-mobile.md).
-- 1. Sessions par appareil : session de 30 jours, révocation à distance, déconnexion après inactivité.
-- 2. Idempotence de la file hors connexion : un `client_event_id` par saisie d'animation et par relevé de stock
--    (même principe que `visit_events.client_event_id`, migration 0037).
-- 3. Position de la saisie terrain, lue au moment de l'enregistrement, jamais en continu.
CREATE TABLE IF NOT EXISTS "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_label" text,
	"user_agent" text,
	"idle_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_id" uuid,
	"revoked_reason" text
);
--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_revoked_by_id_users_id_fk" FOREIGN KEY ("revoked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_sessions_user_idx" ON "user_sessions" USING btree ("user_id", "revoked_at");
--> statement-breakpoint
ALTER TABLE "user_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "animations" ADD COLUMN IF NOT EXISTS "client_event_id" text;
--> statement-breakpoint
ALTER TABLE "animations" ADD COLUMN IF NOT EXISTS "device_time" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "animations" ADD COLUMN IF NOT EXISTS "gps_lat" numeric(9, 6);
--> statement-breakpoint
ALTER TABLE "animations" ADD COLUMN IF NOT EXISTS "gps_lng" numeric(9, 6);
--> statement-breakpoint
ALTER TABLE "animations" ADD COLUMN IF NOT EXISTS "gps_accuracy_m" integer;
--> statement-breakpoint
ALTER TABLE "animations" ADD COLUMN IF NOT EXISTS "gps_error" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "animations_client_event_uq" ON "animations" USING btree ("client_event_id") WHERE client_event_id is not null;
--> statement-breakpoint
ALTER TABLE "client_stock_readings" ADD COLUMN IF NOT EXISTS "client_event_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_stock_readings_event_uq" ON "client_stock_readings" USING btree ("client_event_id", "product_id") WHERE client_event_id is not null;
