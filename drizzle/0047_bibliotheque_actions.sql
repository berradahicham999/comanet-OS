-- Bibliothèque d'actions éditable et « ce qui marche par marque ».
-- `action_templates` ne contient que les changements de l'équipe (les modèles livrés restent dans le code).
-- `brand_marketing_playbooks` est pré-rempli avec les convictions de la direction du 04/10/2026, modifiables dans
-- Marketing → Bibliothèque d'actions ; ce sont des hypothèses, que les résultats mesurés devront confirmer.

CREATE TABLE IF NOT EXISTS "action_templates" (
	"key" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"source" text DEFAULT 'EQUIPE' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"origin_action_id" uuid REFERENCES "marketing_actions"("id") ON DELETE set null,
	"origin_activation_id" uuid REFERENCES "activations"("id") ON DELETE set null,
	"created_by_id" uuid REFERENCES "users"("id") ON DELETE set null,
	"updated_by_id" uuid REFERENCES "users"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_templates_origin_action_idx" ON "action_templates" USING btree ("origin_action_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_templates_origin_activation_idx" ON "action_templates" USING btree ("origin_activation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_templates_created_by_idx" ON "action_templates" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_templates_updated_by_idx" ON "action_templates" USING btree ("updated_by_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "brand_marketing_playbooks" (
	"brand_id" uuid PRIMARY KEY NOT NULL REFERENCES "brands"("id") ON DELETE cascade,
	"levers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"favorites" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"avoid" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"updated_by_id" uuid REFERENCES "users"("id") ON DELETE set null,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_marketing_playbooks_updated_by_idx" ON "brand_marketing_playbooks" USING btree ("updated_by_id");--> statement-breakpoint

INSERT INTO "brand_marketing_playbooks" ("brand_id", "levers", "favorites", "note")
SELECT b."id", v.levers::jsonb, v.favorites::jsonb, v.note
FROM "brands" b
JOIN (VALUES
  ('auracos', '{"INFLUENCE":1,"DIGITAL":0.6,"TRADE":0.5}', '["IN_MACRO","IN_AMBASSADOR","IN_LIVE_SHOPPING"]', 'Grosse influenceuse : le levier qui marche le mieux'),
  ('gamarde', '{"TRADE":0.9,"CONTENU":0.9,"MEDICAL":0.6,"DIGITAL":0.5}', '["TR_COUNTER_TRAINING","TR_ADVICE_MONTH","CT_PHARMACIST_ADVICE","CT_MEDICAL_VIDEO"]', 'Le conseil sell-out au comptoir marche bien ; vidéo médicale à tester, la bonne formule n''est pas encore trouvée'),
  ('cygnelab', '{"TRADE":1,"DIGITAL":0.9,"CONTENU":0.5}', '["TR_ANIMATRICE_MONTH","TR_POS_DAYS","DG_DRIVE_TO_STORE","DG_CONVERSION"]', 'Point de vente et digital'),
  ('alphascience', '{"MEDICAL":1,"TRADE":0.6}', '["MD_SAMPLING","MD_STAFF","MD_KOL","EVT_PRESCRIBERS","MD_WEBINAR"]', 'Médecins d''abord, un peu de point de vente')
) AS v(name, levers, favorites, note) ON lower(replace(b."name", ' ', '')) = v.name
WHERE b."merged_into_id" IS NULL
ON CONFLICT ("brand_id") DO NOTHING;
