-- Un point de vente, plusieurs raisons sociales (ex. PARA LA GLOIRE / LA GLOIRE à Fès).
-- La fusion de deux fiches (`mergeClients()`) rattache tout l'historique à la fiche gardée ; l'identité légale
-- de la fiche absorbée devient une raison sociale supplémentaire de la fiche gardée. Une pièce de vente
-- choisit l'entité facturée (`legal_entity_id`, NULL = identité principale de la fiche).

CREATE TABLE IF NOT EXISTS "client_legal_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
	"legal_name" text NOT NULL,
	"account_code" text,
	"ice" text,
	"if_number" text,
	"rc" text,
	"patente" text,
	"billing_address" text,
	"postal_code" text,
	"city" text,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_legal_entities_client_idx" ON "client_legal_entities" ("client_id");--> statement-breakpoint
ALTER TABLE "client_legal_entities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "sales_documents" ADD COLUMN IF NOT EXISTS "legal_entity_id" uuid REFERENCES "client_legal_entities"("id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_documents_legal_entity_idx" ON "sales_documents" ("legal_entity_id");
