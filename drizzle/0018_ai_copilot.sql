-- Copilote IA : conversations, messages, journal des appels d'outils, cache, plans d'exécution, brouillons de rapports.
--
-- Principes :
--  - Lecture seule sur la donnée métier : le copilote n'écrit que dans les tables `ai_*`, plus une tâche
--    au statut PROPOSED (à accepter d'un clic) et un brouillon de rapport (à valider par la direction).
--  - Aucun second référentiel : `ai_reports.brand_id` pointe vers `brands`, les tâches proposées vivent dans `tasks`.
--  - Les nouvelles valeurs d'enum ne sont pas utilisées dans cette migration (contrainte PostgreSQL en transaction).

ALTER TYPE "task_status" ADD VALUE IF NOT EXISTS 'PROPOSED';--> statement-breakpoint
ALTER TYPE "task_source" ADD VALUE IF NOT EXISTS 'AI';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" text,
  "context_module" text,
  "context_path" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_conversations_user_idx" ON "ai_conversations" ("user_id", "updated_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "tool_calls" jsonb,
  "tokens_in" integer DEFAULT 0 NOT NULL,
  "tokens_out" integer DEFAULT 0 NOT NULL,
  "cache_read_tokens" integer DEFAULT 0 NOT NULL,
  "model" text,
  "latency_ms" integer,
  "surface" text DEFAULT 'chat' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_messages_conversation_idx" ON "ai_messages" ("conversation_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_messages_created_idx" ON "ai_messages" ("created_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_tool_calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "message_id" uuid REFERENCES "ai_messages"("id") ON DELETE SET NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "tool" text NOT NULL,
  "params" jsonb,
  "duration_ms" integer DEFAULT 0 NOT NULL,
  "row_count" integer DEFAULT 0 NOT NULL,
  "error" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_tool_calls_user_idx" ON "ai_tool_calls" ("user_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_tool_calls_tool_idx" ON "ai_tool_calls" ("tool");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_cache" (
  "key" text PRIMARY KEY NOT NULL,
  "surface" text NOT NULL,
  "content" text NOT NULL,
  "model" text,
  "tokens_in" integer DEFAULT 0 NOT NULL,
  "tokens_out" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_cache_expires_idx" ON "ai_cache" ("expires_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_action_plans" (
  "rec_key" text PRIMARY KEY NOT NULL,
  "content_md" text NOT NULL,
  "model" text,
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "type" text NOT NULL,
  "brand_id" uuid REFERENCES "brands"("id") ON DELETE SET NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "title" text NOT NULL,
  "content_md" text NOT NULL,
  "sources" jsonb,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "model" text,
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "validated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "validated_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_reports_type_idx" ON "ai_reports" ("type", "period_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_reports_brand_idx" ON "ai_reports" ("brand_id");
