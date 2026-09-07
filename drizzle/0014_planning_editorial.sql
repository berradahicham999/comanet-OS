-- Planning éditorial avancé (Phase 3) : référentiels configurables, briefs structurés,
-- workflow de validation, livrables versionnés, commentaires, notifications.
--
-- Principes :
--  - `content_items` reste LA table des contenus (aucun second référentiel). Elle est étendue.
--  - Plateformes, formats, objectifs, statuts et transitions sont des TABLES de référence,
--    modifiables depuis /parametres, jamais des enums figés dans le code.
--  - L'enum `content_status` disparaît : la colonne `status` devient une clé texte vers
--    `content_statuses`. « Analysé » est repris comme « Archivé » : un contenu archivé garde
--    son brief, ses fichiers et tout son historique ; il n'est jamais supprimé.
--  - Les livrables sont stockés en `bytea` dans Postgres, comme les fichiers d'import :
--    aucune nouvelle variable d'environnement, déployable tel quel. Le module
--    `src/lib/content/assets.ts` isole ce choix pour pouvoir passer à un stockage objet
--    plus tard sans toucher aux écrans.

/* ---------------------------- Référentiels ---------------------------- */

CREATE TABLE IF NOT EXISTS "content_platforms" (
  "key" text PRIMARY KEY,
  "label" text NOT NULL,
  "icon" text,
  "sort" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  -- Contraintes techniques affichées dans le brief : { "ratios": ["4:5","9:16"], "maxDurationSec": 90, "notes": "…" }
  "specs" jsonb NOT NULL DEFAULT '{}'::jsonb
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "content_formats" (
  "key" text PRIMARY KEY,
  "label" text NOT NULL,
  "sort" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  -- Livrable attendu par défaut (ex. « Visuel 1080×1350 »), repris dans le brief.
  "default_deliverable" text
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "content_objectives" (
  "key" text PRIMARY KEY,
  "label" text NOT NULL,
  "sort" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "content_statuses" (
  "key" text PRIMARY KEY,
  "label" text NOT NULL,
  "tone" text NOT NULL DEFAULT 'gray',
  "sort" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  -- Sémantique lue par les indicateurs et les règles (pas de nom de statut en dur dans le code).
  "is_published" boolean NOT NULL DEFAULT false,
  "is_archived" boolean NOT NULL DEFAULT false,
  "awaiting_validation" boolean NOT NULL DEFAULT false,
  "in_production" boolean NOT NULL DEFAULT false
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "content_status_transitions" (
  "from_key" text NOT NULL REFERENCES "content_statuses"("key") ON DELETE CASCADE,
  "to_key" text NOT NULL REFERENCES "content_statuses"("key") ON DELETE CASCADE,
  -- Réservée aux validateurs (permission Valider sur Marketing ou validateur déclaré pour la marque).
  "requires_validator" boolean NOT NULL DEFAULT false,
  "requires_comment" boolean NOT NULL DEFAULT false,
  "label" text,
  PRIMARY KEY ("from_key", "to_key")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "brief_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "brand_id" uuid REFERENCES "brands"("id") ON DELETE SET NULL,
  "objective_key" text REFERENCES "content_objectives"("key") ON DELETE SET NULL,
  "platform_key" text REFERENCES "content_platforms"("key") ON DELETE SET NULL,
  "format_key" text REFERENCES "content_formats"("key") ON DELETE SET NULL,
  -- Champs du brief pré-remplis : keyMessage, angle, hook, caption, hashtags, cta, constraints,
  -- mandatoryMentions, forbiddenClaims, deliverables, deadlineOffsetDays.
  "defaults" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brief_templates_brand_idx" ON "brief_templates" ("brand_id");--> statement-breakpoint

-- Validateurs par marque (en plus de la permission Valider sur Marketing et des administrateurs).
CREATE TABLE IF NOT EXISTS "brand_validators" (
  "brand_id" uuid NOT NULL REFERENCES "brands"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  PRIMARY KEY ("brand_id", "user_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_validators_user_idx" ON "brand_validators" ("user_id");--> statement-breakpoint

/* ------------------------- Données de référence ------------------------- */

INSERT INTO "content_platforms" ("key", "label", "icon", "sort", "specs") VALUES
  ('INSTAGRAM', 'Instagram', 'Instagram', 1, '{"ratios":["4:5 (1080×1350)","1:1 (1080×1080)","9:16 (1080×1920)"],"maxDurationSec":90,"notes":"Reels 9:16 ; carrousel jusqu''à 20 visuels ; légende 2 200 caractères max."}'),
  ('FACEBOOK', 'Facebook', 'Facebook', 2, '{"ratios":["4:5","1:1","16:9"],"maxDurationSec":240,"notes":"Reprise Instagram possible ; privilégier le texte court."}'),
  ('TIKTOK', 'TikTok', 'Music2', 3, '{"ratios":["9:16 (1080×1920)"],"maxDurationSec":180,"notes":"Accroche dans les 2 premières secondes ; sous-titres obligatoires."}'),
  ('WHATSAPP', 'WhatsApp / broadcast', 'MessageCircle', 4, '{"ratios":["1:1","4:5"],"notes":"Visuel + message court ; un seul CTA (commander / demander le catalogue)."}'),
  ('SITE', 'Site / Shopify', 'Globe', 5, '{"ratios":["16:9 bannière","1:1 fiche produit"],"notes":"Texte SEO ; visuels packshot fond blanc."}'),
  ('EMAILING', 'Emailing', 'Mail', 6, '{"ratios":["600 px de large"],"notes":"Objet < 50 caractères ; un CTA principal."}'),
  ('PLV', 'PLV / print', 'Printer', 7, '{"ratios":["Selon support (A4, A5, chevalet, présentoir)"],"notes":"CMJN, 300 dpi, fonds perdus 3 mm, mentions légales lisibles."}'),
  ('YOUTUBE', 'YouTube', 'Youtube', 8, '{"ratios":["16:9","9:16 Shorts"],"notes":"Miniature dédiée ; description avec liens."}')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

INSERT INTO "content_formats" ("key", "label", "sort", "default_deliverable") VALUES
  ('POST', 'Post', 1, 'Visuel 1080×1350 + légende'),
  ('REEL', 'Reel', 2, 'Vidéo verticale 15–30 s + légende'),
  ('STORY', 'Story', 3, '3 stories 1080×1920'),
  ('CARROUSEL', 'Carrousel', 4, '5 à 8 visuels 1080×1350 + légende'),
  ('VIDEO', 'Vidéo', 5, 'Vidéo montée + miniature'),
  ('UGC', 'UGC', 6, 'Vidéo témoignage brute + version montée'),
  ('VISUEL_PHARMACIE', 'Visuel pharmacie', 7, 'Visuel HD prêt à imprimer + version écran'),
  ('LIVE', 'Live', 8, 'Déroulé + visuel d''annonce'),
  ('NEWSLETTER', 'Newsletter', 9, 'Maquette email + texte')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

INSERT INTO "content_objectives" ("key", "label", "sort") VALUES
  ('NOTORIETE', 'Notoriété', 1),
  ('EDUCATION', 'Éducation produit', 2),
  ('PROMO', 'Promo / offre pharmacie', 3),
  ('LANCEMENT', 'Lancement', 4),
  ('UGC', 'UGC', 5),
  ('SAISONNIER', 'Saisonnier', 6),
  ('CONVERSION', 'Conversion', 7),
  ('ENGAGEMENT', 'Engagement', 8),
  ('DRIVE_TO_STORE', 'Drive-to-store', 9)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

INSERT INTO "content_statuses" ("key", "label", "tone", "sort", "is_published", "is_archived", "awaiting_validation", "in_production") VALUES
  ('IDEE', 'Idée', 'gray', 1, false, false, false, false),
  ('BRIEF_PRET', 'Brief prêt', 'blue', 2, false, false, false, false),
  ('EN_CREATION', 'En création', 'purple', 3, false, false, false, true),
  ('A_VALIDER', 'À valider', 'yellow', 4, false, false, true, false),
  ('CORRECTIONS', 'Corrections demandées', 'orange', 5, false, false, false, true),
  ('VALIDE', 'Validé', 'green', 6, false, false, false, false),
  ('PROGRAMME', 'Programmé', 'accent', 7, false, false, false, false),
  ('PUBLIE', 'Publié', 'green', 8, true, false, false, false),
  ('ARCHIVE', 'Archivé', 'gray', 9, false, true, false, false)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

INSERT INTO "content_status_transitions" ("from_key", "to_key", "requires_validator", "requires_comment", "label") VALUES
  ('IDEE', 'BRIEF_PRET', false, false, 'Brief prêt'),
  ('BRIEF_PRET', 'EN_CREATION', false, false, 'Lancer la création'),
  ('BRIEF_PRET', 'IDEE', false, false, 'Revenir à l''idée'),
  ('EN_CREATION', 'A_VALIDER', false, false, 'Demander la validation'),
  ('EN_CREATION', 'BRIEF_PRET', false, false, 'Revoir le brief'),
  ('A_VALIDER', 'VALIDE', true, false, 'Valider'),
  ('A_VALIDER', 'CORRECTIONS', true, true, 'Demander des corrections'),
  ('CORRECTIONS', 'A_VALIDER', false, false, 'Renvoyer en validation'),
  ('CORRECTIONS', 'EN_CREATION', false, false, 'Reprendre la création'),
  ('VALIDE', 'PROGRAMME', false, false, 'Programmer'),
  ('VALIDE', 'PUBLIE', false, false, 'Marquer publié'),
  ('VALIDE', 'CORRECTIONS', true, true, 'Rouvrir pour corrections'),
  ('PROGRAMME', 'PUBLIE', false, false, 'Marquer publié'),
  ('PROGRAMME', 'VALIDE', false, false, 'Déprogrammer'),
  ('PUBLIE', 'ARCHIVE', false, false, 'Archiver'),
  ('IDEE', 'ARCHIVE', false, false, 'Archiver'),
  ('BRIEF_PRET', 'ARCHIVE', false, false, 'Archiver'),
  ('ARCHIVE', 'IDEE', false, false, 'Réactiver')
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "brief_templates" ("name", "objective_key", "platform_key", "format_key", "defaults") VALUES
  ('Post produit standard', 'EDUCATION', 'INSTAGRAM', 'POST', '{"keyMessage":"Un bénéfice, une preuve, un geste.","angle":"Le pharmacien recommande","hook":"Vous connaissez ce geste du soir ?","cta":"Disponible en pharmacie et parapharmacie.","constraints":"Packshot net, fond clair, logo marque en bas à droite.","mandatoryMentions":"Complément alimentaire : ne se substitue pas à une alimentation variée et équilibrée (si applicable).","forbiddenClaims":"Aucune allégation thérapeutique (guérit, soigne, traite).","deliverables":"1 visuel 1080×1350 + légende avec hashtags","deadlineOffsetDays":3}'),
  ('Reel UGC', 'UGC', 'INSTAGRAM', 'REEL', '{"keyMessage":"Résultat vécu, ton naturel.","angle":"Témoignage cliente / pharmacienne","hook":"Je l''utilise depuis 3 semaines et…","cta":"Demandez-le à votre pharmacien.","constraints":"9:16, 15–30 s, sous-titres, pas de musique sous licence.","forbiddenClaims":"Pas de promesse de résultat chiffré non prouvé.","deliverables":"Reel 15–30 s + 1 couverture","deadlineOffsetDays":5}'),
  ('Offre pharmacie du mois', 'PROMO', 'WHATSAPP', 'VISUEL_PHARMACIE', '{"keyMessage":"L''offre du mois, claire et datée.","angle":"Bon plan pharmacien","hook":"Offre du mois — jusqu''au …","cta":"Commandez auprès de votre délégué COMANET.","constraints":"Prix et dates lisibles, visuel 1:1 pour WhatsApp + version A5 imprimable.","mandatoryMentions":"Offre réservée aux professionnels, dans la limite des stocks.","deliverables":"1 visuel 1080×1080 + 1 A5 PDF","deadlineOffsetDays":4}')
ON CONFLICT DO NOTHING;--> statement-breakpoint

/* ------------------------ Extension de content_items ------------------------ */

-- Statut : l'enum devient une clé texte vers content_statuses.
ALTER TABLE "content_items" ADD COLUMN IF NOT EXISTS "status_key" text;--> statement-breakpoint
UPDATE "content_items" SET "status_key" = CASE "status"::text
  WHEN 'IDEE' THEN 'IDEE' WHEN 'BRIEF' THEN 'BRIEF_PRET' WHEN 'CREATION' THEN 'EN_CREATION'
  WHEN 'VALIDATION' THEN 'A_VALIDER' WHEN 'PROGRAMME' THEN 'PROGRAMME' WHEN 'PUBLIE' THEN 'PUBLIE'
  WHEN 'ANALYSE' THEN 'ARCHIVE' ELSE 'IDEE' END
WHERE "status_key" IS NULL;--> statement-breakpoint
ALTER TABLE "content_items" DROP COLUMN IF EXISTS "status";--> statement-breakpoint
ALTER TABLE "content_items" RENAME COLUMN "status_key" TO "status";--> statement-breakpoint
ALTER TABLE "content_items" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "content_items" ALTER COLUMN "status" SET DEFAULT 'IDEE';--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_status_fk" FOREIGN KEY ("status") REFERENCES "content_statuses"("key");--> statement-breakpoint
DROP TYPE IF EXISTS "content_status";--> statement-breakpoint

-- Plateforme et format : les textes libres deviennent des clés de référentiel.
-- Toute valeur inconnue est ajoutée au référentiel (rien n'est perdu), puis normalisée.
INSERT INTO "content_platforms" ("key", "label", "sort")
  SELECT DISTINCT upper(regexp_replace(translate(platform, 'éèêàçÉ ', 'eeeacE_'), '[^A-Za-z0-9_]', '', 'g')), platform, 99
  FROM "content_items" WHERE platform IS NOT NULL AND btrim(platform) <> ''
    AND upper(regexp_replace(translate(platform, 'éèêàçÉ ', 'eeeacE_'), '[^A-Za-z0-9_]', '', 'g')) NOT IN (SELECT key FROM content_platforms)
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "content_items" SET platform = upper(regexp_replace(translate(platform, 'éèêàçÉ ', 'eeeacE_'), '[^A-Za-z0-9_]', '', 'g')) WHERE platform IS NOT NULL;--> statement-breakpoint
UPDATE "content_items" SET platform = NULL WHERE platform = '';--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_platform_fk" FOREIGN KEY ("platform") REFERENCES "content_platforms"("key") ON DELETE SET NULL;--> statement-breakpoint

INSERT INTO "content_formats" ("key", "label", "sort")
  SELECT DISTINCT upper(regexp_replace(translate(format, 'éèêàçÉ ', 'eeeacE_'), '[^A-Za-z0-9_]', '', 'g')), format, 99
  FROM "content_items" WHERE format IS NOT NULL AND btrim(format) <> ''
    AND upper(regexp_replace(translate(format, 'éèêàçÉ ', 'eeeacE_'), '[^A-Za-z0-9_]', '', 'g')) NOT IN (SELECT key FROM content_formats)
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "content_items" SET format = upper(regexp_replace(translate(format, 'éèêàçÉ ', 'eeeacE_'), '[^A-Za-z0-9_]', '', 'g')) WHERE format IS NOT NULL;--> statement-breakpoint
UPDATE "content_items" SET format = NULL WHERE format = '';--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_format_fk" FOREIGN KEY ("format") REFERENCES "content_formats"("key") ON DELETE SET NULL;--> statement-breakpoint

-- Objectif : même traitement (l'ancien texte libre « Notoriété », « Conversion »… devient une clé).
INSERT INTO "content_objectives" ("key", "label", "sort")
  SELECT DISTINCT upper(regexp_replace(translate(objective, 'éèêàçÉ -', 'eeeacE__'), '[^A-Za-z0-9_]', '', 'g')), objective, 99
  FROM "content_items" WHERE objective IS NOT NULL AND btrim(objective) <> ''
    AND upper(regexp_replace(translate(objective, 'éèêàçÉ -', 'eeeacE__'), '[^A-Za-z0-9_]', '', 'g')) NOT IN (SELECT key FROM content_objectives)
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "content_items" SET objective = upper(regexp_replace(translate(objective, 'éèêàçÉ -', 'eeeacE__'), '[^A-Za-z0-9_]', '', 'g')) WHERE objective IS NOT NULL;--> statement-breakpoint
UPDATE "content_items" SET objective = NULL WHERE objective = '';--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_objective_fk" FOREIGN KEY ("objective") REFERENCES "content_objectives"("key") ON DELETE SET NULL;--> statement-breakpoint

-- Brief structuré, planning, validation, post-publication.
ALTER TABLE "content_items"
  ADD COLUMN IF NOT EXISTS "publish_time" time,
  ADD COLUMN IF NOT EXISTS "deadline" date,
  ADD COLUMN IF NOT EXISTS "validator_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "template_id" uuid REFERENCES "brief_templates"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "key_message" text,
  ADD COLUMN IF NOT EXISTS "angle" text,
  ADD COLUMN IF NOT EXISTS "hook" text,
  ADD COLUMN IF NOT EXISTS "caption" text,
  ADD COLUMN IF NOT EXISTS "hashtags" text,
  ADD COLUMN IF NOT EXISTS "cta" text,
  ADD COLUMN IF NOT EXISTS "constraints" text,
  ADD COLUMN IF NOT EXISTS "mandatory_mentions" text,
  ADD COLUMN IF NOT EXISTS "forbidden_claims" text,
  ADD COLUMN IF NOT EXISTS "references" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "deliverables" text,
  ADD COLUMN IF NOT EXISTS "reach" integer,
  ADD COLUMN IF NOT EXISTS "engagement" integer,
  ADD COLUMN IF NOT EXISTS "perf_notes" text,
  ADD COLUMN IF NOT EXISTS "published_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "archived_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "content_items_brand_date_idx" ON "content_items" ("brand_id", "date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_items_status_idx" ON "content_items" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_items_platform_idx" ON "content_items" ("platform");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_items_deadline_idx" ON "content_items" ("deadline");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_items_validator_idx" ON "content_items" ("validator_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_items_created_by_idx" ON "content_items" ("created_by_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_items_template_idx" ON "content_items" ("template_id");--> statement-breakpoint

/* --------------------------- Tables satellites --------------------------- */

-- Plusieurs produits par contenu. `product_id` sur content_items reste le produit principal.
CREATE TABLE IF NOT EXISTS "content_products" (
  "content_id" uuid NOT NULL REFERENCES "content_items"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  PRIMARY KEY ("content_id", "product_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_products_product_idx" ON "content_products" ("product_id");--> statement-breakpoint
INSERT INTO "content_products" ("content_id", "product_id")
  SELECT id, product_id FROM "content_items" WHERE product_id IS NOT NULL ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Historique complet des changements de statut : qui, quand, commentaire. Jamais purgé.
CREATE TABLE IF NOT EXISTS "content_status_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "content_id" uuid NOT NULL REFERENCES "content_items"("id") ON DELETE CASCADE,
  "from_status" text,
  "to_status" text NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "comment" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_status_history_content_idx" ON "content_status_history" ("content_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_status_history_user_idx" ON "content_status_history" ("user_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "content_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "content_id" uuid NOT NULL REFERENCES "content_items"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "body" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_comments_content_idx" ON "content_comments" ("content_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_comments_user_idx" ON "content_comments" ("user_id");--> statement-breakpoint

-- Livrables et références, versionnés. `kind` : LIVRABLE | REFERENCE. `data` : contenu du fichier.
CREATE TABLE IF NOT EXISTS "content_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "content_id" uuid NOT NULL REFERENCES "content_items"("id") ON DELETE CASCADE,
  "kind" text NOT NULL DEFAULT 'LIVRABLE',
  "name" text NOT NULL,
  "mime" text NOT NULL DEFAULT 'application/octet-stream',
  "size" integer NOT NULL DEFAULT 0,
  "version" integer NOT NULL DEFAULT 1,
  "data" bytea,
  "uploaded_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_assets_content_idx" ON "content_assets" ("content_id", "kind", "version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_assets_user_idx" ON "content_assets" ("uploaded_by_id");--> statement-breakpoint

/* ------------------------------ Notifications ------------------------------ */

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "href" text,
  "entity_type" text,
  "entity_id" uuid,
  "read_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_unread_idx" ON "notifications" ("user_id", "read_at", "created_at");--> statement-breakpoint

/* ---------------------------------- RLS ---------------------------------- */
-- Même convention que 0004 : l'application passe par le rôle propriétaire ; RLS ferme l'API
-- PostgREST (clé anon) sur ces nouvelles tables.
ALTER TABLE "content_platforms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_formats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_objectives" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_statuses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_status_transitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brief_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brand_validators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_status_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
