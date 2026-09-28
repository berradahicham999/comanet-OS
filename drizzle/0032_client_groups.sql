-- Groupes de clients : un Groupe (enseigne, ex. « COTE PARA ») rassemble plusieurs raisons sociales distinctes.
-- Le client reste le point de vente (clé `name_key`, utilisée par les imports) ; `legal_name` porte sa raison
-- sociale ; `group_id` le rattache à un groupe. Un groupe se supprime sans toucher aux clients (SET NULL).

CREATE TABLE IF NOT EXISTS "client_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_key" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_groups_name_key_unique" UNIQUE("name_key")
);
--> statement-breakpoint

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "group_id" uuid REFERENCES "client_groups"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_group_idx" ON "clients" ("group_id");--> statement-breakpoint
ALTER TABLE "client_groups" ENABLE ROW LEVEL SECURITY;
