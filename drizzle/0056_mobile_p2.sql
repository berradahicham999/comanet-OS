-- App mobile, phase P2 (docs/plan-mobile.md).
-- 1. Web Push : un abonnement par navigateur, rattaché à la session pour disparaître avec elle.
-- 2. Alertes de stock : une référence n'est signalée qu'une fois par semaine.
-- 3. Idempotence de la file hors connexion : compte rendu de visite et brouillon de commande.
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"device_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_session_id_user_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."user_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_uq" ON "push_subscriptions" USING btree ("endpoint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stock_alert_log" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"last_alert_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_alert_log" ADD CONSTRAINT "stock_alert_log_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_alert_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "doctor_visits" ADD COLUMN IF NOT EXISTS "report_client_event_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "doctor_visits_report_event_uq" ON "doctor_visits" USING btree ("report_client_event_id") WHERE report_client_event_id is not null;
--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN IF NOT EXISTS "client_event_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_documents_client_event_uq" ON "sales_documents" USING btree ("client_event_id") WHERE client_event_id is not null;
