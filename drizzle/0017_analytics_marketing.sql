-- Analytics marketing transverse (Phase 4) : couche de faits alimentée depuis les modules existants.
--
-- Principes :
--  - Aucun second référentiel : les faits pointent vers `brands`, `products`, `campaigns`, `clients`.
--    Seuls le référentiel des CANAUX (`dim_channel`), la table de correspondance des sources
--    (`channel_mappings`) et un calendrier (`dim_period`) sont nouveaux.
--  - `fact_marketing_spend` et `fact_marketing_result` sont des TABLES reconstruites source par
--    source par `src/lib/analytics-marketing/refresh.ts` (fin d'import, synchro, transition, cron).
--    Une vue matérialisée ne serait ni incrémentale ni traçable ; ici chaque passage est journalisé.
--  - `fact_sales` est une VUE : elle ne peut jamais être en retard sur Sage.
--  - Le dictionnaire de métriques (`metrics_definitions`) porte libellé, unité, sens, seuils et mode
--    d'attribution. Le calcul vit dans le code (`metrics.ts`) ; un test garantit l'alignement des clés.
--  - Une marque fusionnée (`brands.merged_into_id`) est lue sous sa marque cible par toute la couche.

/* ------------------------------ Marques fusionnées ------------------------------ */

ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "merged_into_id" uuid REFERENCES "brands"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brands_merged_into_idx" ON "brands" ("merged_into_id");--> statement-breakpoint

-- Gamardemaroc est un doublon de Gamarde (compte publicitaire nommé autrement) : on rattache
-- ses lignes à Gamarde, on garde la fiche désactivée avec le lien de fusion, on ajoute l'alias
-- pour que les prochains imports tombent directement sur Gamarde. Rien n'est supprimé.
DO $$
DECLARE
  src uuid;
  dst uuid;
BEGIN
  SELECT id INTO src FROM brands WHERE lower(name) = 'gamardemaroc' LIMIT 1;
  SELECT id INTO dst FROM brands WHERE lower(name) = 'gamarde' AND id IS DISTINCT FROM src LIMIT 1;
  IF src IS NOT NULL AND dst IS NOT NULL THEN
    UPDATE products SET brand_id = dst WHERE brand_id = src;
    UPDATE ad_accounts SET brand_id = dst WHERE brand_id = src;
    UPDATE ad_metrics SET brand_id = dst WHERE brand_id = src;
    UPDATE campaigns SET brand_id = dst WHERE brand_id = src;
    UPDATE marketing_expenses SET brand_id = dst WHERE brand_id = src;
    UPDATE collaborations SET brand_id = dst WHERE brand_id = src;
    UPDATE content_items SET brand_id = dst WHERE brand_id = src;
    UPDATE activations SET brand_id = dst WHERE brand_id = src;
    UPDATE animations SET brand_id = dst WHERE brand_id = src;
    UPDATE brands SET merged_into_id = dst, active = false WHERE id = src;
    UPDATE brands SET aliases = (
      SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements_text(aliases || '["GAMARDEMAROC","GAMARDE MAROC"]'::jsonb) AS x
    ) WHERE id = dst;
  END IF;
END $$;--> statement-breakpoint

/* ------------------------------ Dimensions ------------------------------ */

CREATE TABLE IF NOT EXISTS "dim_channel" (
  "key" text PRIMARY KEY,
  "label" text NOT NULL,
  -- DIGITAL_PAID | ORGANIC | INFLUENCE | TERRAIN | EVENT | TRADE | PRESCRIPTION | PRODUCTION | OTHER
  "family" text NOT NULL DEFAULT 'OTHER',
  -- Résultat « propre » du canal (clé de metrics_definitions) : sert au coût par résultat.
  "result_metric" text,
  -- Résultat de repli quand le principal est à zéro sur la période (ex. Meta : achats → conversations).
  "fallback_result_metric" text,
  "color" text NOT NULL DEFAULT '#64748b',
  "sort" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true
);--> statement-breakpoint

INSERT INTO "dim_channel" ("key", "label", "family", "result_metric", "fallback_result_metric", "color", "sort") VALUES
  ('META_ADS', 'Meta Ads', 'DIGITAL_PAID', 'PURCHASES', 'MESSAGES_STARTED', '#1d4ed8', 1),
  ('TIKTOK_ADS', 'TikTok Ads', 'DIGITAL_PAID', 'PURCHASES', 'LINK_CLICKS', '#0f172a', 2),
  ('GOOGLE_ADS', 'Google Ads', 'DIGITAL_PAID', 'PURCHASES', 'LINK_CLICKS', '#ca8a04', 3),
  ('DIGITAL_OTHER', 'Communication digitale', 'DIGITAL_PAID', 'REACH', NULL, '#3b82f6', 4),
  ('ORGANIC_INSTAGRAM', 'Instagram (organique)', 'ORGANIC', 'ENGAGEMENT', 'REACH', '#db2777', 10),
  ('ORGANIC_FACEBOOK', 'Facebook (organique)', 'ORGANIC', 'ENGAGEMENT', 'REACH', '#2563eb', 11),
  ('ORGANIC_TIKTOK', 'TikTok (organique)', 'ORGANIC', 'ENGAGEMENT', 'REACH', '#111827', 12),
  ('ORGANIC_YOUTUBE', 'YouTube', 'ORGANIC', 'VIEWS', 'REACH', '#dc2626', 13),
  ('SITE', 'Site web', 'ORGANIC', 'REACH', NULL, '#0891b2', 14),
  ('EMAILING', 'Emailing', 'ORGANIC', 'REACH', NULL, '#7c3aed', 15),
  ('WHATSAPP', 'WhatsApp', 'ORGANIC', 'REACH', NULL, '#16a34a', 16),
  ('INFLUENCE', 'Influence', 'INFLUENCE', 'REACH', 'VIEWS', '#e11d48', 20),
  ('UGC', 'UGC', 'INFLUENCE', 'VIEWS', 'REACH', '#f43f5e', 21),
  ('CONTENT_PRODUCTION', 'Création / shooting', 'PRODUCTION', 'CONTENTS_PUBLISHED', NULL, '#a16207', 25),
  ('ANIMATION_POS', 'Animation en point de vente', 'TERRAIN', 'SELLOUT_AMOUNT', 'CUSTOMERS_ADVISED', '#0f766e', 30),
  ('OPERATION_PHARMACIE', 'Opération pharmacie', 'TRADE', 'ORDERS_AMOUNT', 'PHARMACIES_REACHED', '#14b8a6', 31),
  ('TRADE', 'Trade marketing', 'TRADE', 'ORDERS_AMOUNT', NULL, '#0d9488', 32),
  ('PLV', 'PLV / merchandising', 'TRADE', 'PHARMACIES_REACHED', NULL, '#0369a1', 33),
  ('SAMPLING', 'Sampling', 'TRADE', 'SAMPLES', NULL, '#059669', 34),
  ('GOODIES', 'Goodies', 'TRADE', 'SAMPLES', NULL, '#65a30d', 35),
  ('EVENT', 'Événement', 'EVENT', 'PARTICIPANTS', 'LEADS', '#9333ea', 40),
  ('SPONSORING', 'Sponsoring / partenariat', 'EVENT', 'REACH', 'PARTICIPANTS', '#7e22ce', 41),
  ('SALON', 'Salon / congrès', 'EVENT', 'LEADS', 'PARTICIPANTS', '#6d28d9', 42),
  ('RP', 'Relations presse', 'EVENT', 'PRESS_MENTIONS', NULL, '#4338ca', 43),
  ('PRESCRIPTION', 'Prescripteurs / médical', 'PRESCRIPTION', 'SAMPLES', NULL, '#15803d', 50),
  ('AGENCE', 'Agence', 'OTHER', NULL, NULL, '#78716c', 90),
  ('OTHER', 'Autres', 'OTHER', NULL, NULL, '#94a3b8', 99)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

-- Correspondance source → canal, modifiable dans /parametres/analytics.
-- source_kind : BUDGET_CATEGORY (19 catégories) | AD_PLATFORM | CONTENT_PLATFORM | ACTIVATION_TYPE | COLLABORATION | ANIMATION | SAMPLE
CREATE TABLE IF NOT EXISTS "channel_mappings" (
  "source_kind" text NOT NULL,
  "source_key" text NOT NULL,
  "channel_key" text NOT NULL REFERENCES "dim_channel"("key") ON DELETE RESTRICT,
  PRIMARY KEY ("source_kind", "source_key")
);--> statement-breakpoint

INSERT INTO "channel_mappings" ("source_kind", "source_key", "channel_key") VALUES
  ('BUDGET_CATEGORY', 'META', 'META_ADS'),
  ('BUDGET_CATEGORY', 'TIKTOK', 'TIKTOK_ADS'),
  ('BUDGET_CATEGORY', 'GOOGLE', 'GOOGLE_ADS'),
  ('BUDGET_CATEGORY', 'DIGITAL', 'DIGITAL_OTHER'),
  ('BUDGET_CATEGORY', 'INFLUENCE', 'INFLUENCE'),
  ('BUDGET_CATEGORY', 'UGC', 'UGC'),
  ('BUDGET_CATEGORY', 'CREATION', 'CONTENT_PRODUCTION'),
  ('BUDGET_CATEGORY', 'SHOOTING', 'CONTENT_PRODUCTION'),
  ('BUDGET_CATEGORY', 'EVENEMENT', 'EVENT'),
  ('BUDGET_CATEGORY', 'SPONSORING', 'SPONSORING'),
  ('BUDGET_CATEGORY', 'TRADE', 'TRADE'),
  ('BUDGET_CATEGORY', 'PLV', 'PLV'),
  ('BUDGET_CATEGORY', 'ANIMATION', 'ANIMATION_POS'),
  ('BUDGET_CATEGORY', 'GOODIES', 'GOODIES'),
  ('BUDGET_CATEGORY', 'ECHANTILLONS', 'SAMPLING'),
  ('BUDGET_CATEGORY', 'PRESCRIPTEURS', 'PRESCRIPTION'),
  ('BUDGET_CATEGORY', 'CONGRES', 'SALON'),
  ('BUDGET_CATEGORY', 'AGENCE', 'AGENCE'),
  ('BUDGET_CATEGORY', 'AUTRES', 'OTHER'),
  ('AD_PLATFORM', 'META', 'META_ADS'),
  ('AD_PLATFORM', 'TIKTOK', 'TIKTOK_ADS'),
  ('AD_PLATFORM', 'GOOGLE', 'GOOGLE_ADS'),
  ('AD_PLATFORM', 'AUTRE', 'DIGITAL_OTHER'),
  ('CONTENT_PLATFORM', 'INSTAGRAM', 'ORGANIC_INSTAGRAM'),
  ('CONTENT_PLATFORM', 'FACEBOOK', 'ORGANIC_FACEBOOK'),
  ('CONTENT_PLATFORM', 'TIKTOK', 'ORGANIC_TIKTOK'),
  ('CONTENT_PLATFORM', 'YOUTUBE', 'ORGANIC_YOUTUBE'),
  ('CONTENT_PLATFORM', 'WHATSAPP', 'WHATSAPP'),
  ('CONTENT_PLATFORM', 'SITE', 'SITE'),
  ('CONTENT_PLATFORM', 'EMAILING', 'EMAILING'),
  ('CONTENT_PLATFORM', 'PLV', 'PLV'),
  ('ACTIVATION_TYPE', 'EVENEMENT', 'EVENT'),
  ('ACTIVATION_TYPE', 'SPONSORING', 'SPONSORING'),
  ('ACTIVATION_TYPE', 'SALON', 'SALON'),
  ('ACTIVATION_TYPE', 'PLV', 'PLV'),
  ('ACTIVATION_TYPE', 'SAMPLING', 'SAMPLING'),
  ('ACTIVATION_TYPE', 'GOODIES', 'GOODIES'),
  ('ACTIVATION_TYPE', 'OPERATION_PHARMACIE', 'OPERATION_PHARMACIE'),
  ('ACTIVATION_TYPE', 'RP', 'RP'),
  ('ACTIVATION_TYPE', 'COLLABORATION', 'INFLUENCE'),
  ('ACTIVATION_TYPE', 'AUTRE', 'OTHER'),
  ('COLLABORATION', '*', 'INFLUENCE'),
  ('ANIMATION', '*', 'ANIMATION_POS'),
  ('SAMPLE', '*', 'PRESCRIPTION')
ON CONFLICT ("source_kind", "source_key") DO NOTHING;--> statement-breakpoint

-- Calendrier : un jour par ligne. Évite `generate_series` dans chaque page et sert à repérer
-- les mois sans import Sage.
CREATE TABLE IF NOT EXISTS "dim_period" (
  "day" date PRIMARY KEY,
  "month" text NOT NULL,      -- 'YYYY-MM'
  "quarter" text NOT NULL,    -- 'YYYY-Qn'
  "year" integer NOT NULL,
  "iso_week" text NOT NULL,   -- 'IYYY-Wnn'
  "month_start" date NOT NULL,
  "is_month_end" boolean NOT NULL
);--> statement-breakpoint

INSERT INTO "dim_period" ("day", "month", "quarter", "year", "iso_week", "month_start", "is_month_end")
SELECT d::date,
       to_char(d, 'YYYY-MM'),
       to_char(d, 'YYYY') || '-Q' || to_char(d, 'Q'),
       extract(year from d)::int,
       to_char(d, 'IYYY-"W"IW'),
       date_trunc('month', d)::date,
       (d::date = (date_trunc('month', d) + interval '1 month - 1 day')::date)
FROM generate_series('2024-01-01'::date, '2028-12-31'::date, interval '1 day') AS d
ON CONFLICT ("day") DO NOTHING;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dim_period_month_idx" ON "dim_period" ("month");--> statement-breakpoint

/* ------------------------------ Faits ------------------------------ */

-- Une ligne = une dépense × jour × marque × produit (après répartition). Reconstruite par source_kind.
-- source_kind : AD_METRIC | EXPENSE | ACTIVATION_LINE | COLLABORATION | CONTENT | ANIMATION | SAMPLE
CREATE TABLE IF NOT EXISTS "fact_marketing_spend" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "day" date NOT NULL,
  "brand_id" uuid NOT NULL REFERENCES "brands"("id") ON DELETE CASCADE,
  "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL,
  "city" text,
  "campaign_id" uuid REFERENCES "campaigns"("id") ON DELETE SET NULL,
  "channel_key" text NOT NULL REFERENCES "dim_channel"("key") ON DELETE RESTRICT,
  "sub_channel" text,
  "budget_category" "budget_category" NOT NULL DEFAULT 'AUTRES',
  "source_kind" text NOT NULL,
  "source_id" uuid NOT NULL,
  -- Détail lisible de l'origine (nom de campagne régie, libellé de ligne, nom d'influenceur…).
  "source_label" text,
  -- Pourquoi un montant manque : COUT_NON_MESURE (animation sans coût ni tarif journalier).
  "source_ref" text,
  -- Montants MAD APRÈS répartition. NULL = non mesurable (jamais 0 par défaut).
  "planned" numeric(14, 2),
  "committed" numeric(14, 2),
  "spent" numeric(14, 2),
  -- Quote-part appliquée à la ligne d'origine et base de calcul : PRORATA_SALES | EQUAL | DECLARED | NONE.
  "share" numeric(8, 6) NOT NULL DEFAULT 1,
  "share_basis" text NOT NULL DEFAULT 'NONE',
  -- Journée de régie non close : exclue de tout total.
  "is_partial" boolean NOT NULL DEFAULT false,
  -- CA lié à cette dépense : MEASURED (régie, code promo, saisie) | NONE.
  "attribution_mode" text NOT NULL DEFAULT 'NONE',
  "attributed_revenue" numeric(14, 2),
  "refreshed_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fms_day_idx" ON "fact_marketing_spend" ("day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fms_brand_day_idx" ON "fact_marketing_spend" ("brand_id", "day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fms_channel_day_idx" ON "fact_marketing_spend" ("channel_key", "day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fms_product_day_idx" ON "fact_marketing_spend" ("product_id", "day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fms_campaign_idx" ON "fact_marketing_spend" ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fms_source_idx" ON "fact_marketing_spend" ("source_kind", "source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fms_city_idx" ON "fact_marketing_spend" ("city");--> statement-breakpoint

-- Une ligne = un résultat mesuré × type, même grain.
CREATE TABLE IF NOT EXISTS "fact_marketing_result" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "day" date NOT NULL,
  "brand_id" uuid NOT NULL REFERENCES "brands"("id") ON DELETE CASCADE,
  "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL,
  "city" text,
  "campaign_id" uuid REFERENCES "campaigns"("id") ON DELETE SET NULL,
  "channel_key" text NOT NULL REFERENCES "dim_channel"("key") ON DELETE RESTRICT,
  "sub_channel" text,
  "source_kind" text NOT NULL,
  "source_id" uuid NOT NULL,
  "source_label" text,
  -- Clé de metrics_definitions (IMPRESSIONS, REACH, MESSAGES_STARTED, SELLOUT_AMOUNT…).
  "result_key" text NOT NULL,
  "value" numeric(16, 2) NOT NULL,
  "share" numeric(8, 6) NOT NULL DEFAULT 1,
  -- MEASURED (régie, sell-out saisi, code promo) | DECLARED (portée / engagement saisis à la main).
  "measurement" text NOT NULL DEFAULT 'MEASURED',
  "is_partial" boolean NOT NULL DEFAULT false,
  "refreshed_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fmr_day_idx" ON "fact_marketing_result" ("day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fmr_brand_day_idx" ON "fact_marketing_result" ("brand_id", "day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fmr_channel_key_idx" ON "fact_marketing_result" ("channel_key", "result_key", "day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fmr_product_day_idx" ON "fact_marketing_result" ("product_id", "day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fmr_source_idx" ON "fact_marketing_result" ("source_kind", "source_id");--> statement-breakpoint

-- Ventes unifiées : sell-in Sage (HT) et sell-out terrain (TTC, formule officielle de src/lib/sellout.ts).
-- Marge HT uniquement quand le prix d'achat est connu ; sinon NULL, jamais estimée.
-- La marque est lue sous sa marque cible si elle a été fusionnée.
CREATE OR REPLACE VIEW "fact_sales" AS
SELECT 'SELL_IN'::text AS kind,
       s.date AS day,
       coalesce(b.merged_into_id, p.brand_id) AS brand_id,
       s.product_id,
       s.client_id,
       c.city,
       c.sector,
       c.channel AS client_channel,
       s.quantity::numeric AS quantity,
       s.amount::numeric AS amount,
       CASE WHEN p.cost_price IS NOT NULL THEN (s.amount - s.quantity * p.cost_price)::numeric END AS margin,
       s.site,
       s.id AS source_id
FROM sales s
JOIN products p ON p.id = s.product_id
LEFT JOIN brands b ON b.id = p.brand_id
JOIN clients c ON c.id = s.client_id
UNION ALL
SELECT 'SELL_OUT'::text,
       a.date,
       coalesce(b.merged_into_id, p.brand_id),
       al.product_id,
       a.client_id,
       a.city,
       c.sector,
       c.channel,
       al.quantity_sold::numeric,
       coalesce(al.amount, al.quantity_sold * al.unit_price, al.quantity_sold * p.price_retail)::numeric,
       NULL::numeric,
       NULL::text,
       al.id
FROM animation_lines al
JOIN animations a ON a.id = al.animation_id
JOIN products p ON p.id = al.product_id
LEFT JOIN brands b ON b.id = p.brand_id
JOIN clients c ON c.id = a.client_id;--> statement-breakpoint

/* ------------------------------ Dictionnaire de métriques ------------------------------ */

CREATE TABLE IF NOT EXISTS "metrics_definitions" (
  "key" text PRIMARY KEY,
  "label" text NOT NULL,
  "description" text,
  -- Formule lisible, documentaire. Le calcul vit dans src/lib/analytics-marketing/metrics.ts.
  "formula" text NOT NULL,
  -- MAD | PCT | RATIO | COUNT | MULTIPLE | SCORE | POINTS
  "unit" text NOT NULL,
  -- HIGHER_BETTER | LOWER_BETTER | NEUTRAL
  "direction" text NOT NULL DEFAULT 'NEUTRAL',
  -- Ce qui s'affiche à côté du chiffre : MEASURED | CORRELATION | NONE
  "attribution" text NOT NULL DEFAULT 'NONE',
  -- Table ou fonction officielle.
  "source" text NOT NULL,
  -- MONEY | SALES | RESULT | RETURN | COMPOSITE
  "family" text NOT NULL DEFAULT 'RESULT',
  "warn_threshold" numeric(14, 4),
  "alert_threshold" numeric(14, 4),
  "sort" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

INSERT INTO "metrics_definitions" ("key", "label", "description", "formula", "unit", "direction", "attribution", "source", "family", "sort") VALUES
  -- Argent
  ('SPEND_PLANNED', 'Dépense prévue', 'Montants au statut prévu (projet, pas engagement).', 'Σ fact_marketing_spend.planned', 'MAD', 'NEUTRAL', 'NONE', 'fact_marketing_spend', 'MONEY', 1),
  ('SPEND_COMMITTED', 'Dépense engagée', 'Devis / bons de commande signés + dépensé.', 'Σ fact_marketing_spend.committed', 'MAD', 'NEUTRAL', 'NONE', 'fact_marketing_spend', 'MONEY', 2),
  ('SPEND_SPENT', 'Dépense réalisée', 'Factures et dépense de régie (journées closes).', 'Σ fact_marketing_spend.spent (is_partial = false)', 'MAD', 'NEUTRAL', 'NONE', 'fact_marketing_spend', 'MONEY', 3),
  ('BUDGET_ANNUAL', 'Budget annuel', 'Enveloppe marketing de la marque pour l''année.', 'budgets.amount', 'MAD', 'NEUTRAL', 'NONE', 'src/lib/budget.ts budgetConsumption()', 'MONEY', 4),
  ('BUDGET_CONSUMED_PCT', 'Budget consommé', 'Part de l''enveloppe déjà engagée. Sans enveloppe : non calculé.', 'consommé ÷ budget annuel', 'PCT', 'NEUTRAL', 'NONE', 'src/lib/budget.ts budgetConsumption()', 'MONEY', 5),
  ('SPEND_SHARE', 'Part des dépenses', 'Poids de l''entité dans la dépense marketing du portefeuille.', 'dépense entité ÷ dépense totale', 'PCT', 'NEUTRAL', 'NONE', 'fact_marketing_spend', 'MONEY', 6),
  ('MARKETING_INTENSITY', 'Intensité marketing', 'Dirhams de marketing pour 100 dirhams de sell-in.', 'dépense ÷ CA sell-in HT', 'PCT', 'LOWER_BETTER', 'NONE', 'fact_marketing_spend ÷ fact_sales', 'MONEY', 7),
  -- Ventes
  ('SELL_IN', 'CA sell-in', 'Ventes COMANET → clients, HT, source Sage.', 'Σ fact_sales.amount (kind = SELL_IN)', 'MAD', 'HIGHER_BETTER', 'NONE', 'fact_sales', 'SALES', 10),
  ('SELL_IN_UNITS', 'Unités sell-in', NULL, 'Σ fact_sales.quantity (SELL_IN)', 'COUNT', 'HIGHER_BETTER', 'NONE', 'fact_sales', 'SALES', 11),
  ('SELL_OUT', 'Sell-out terrain', 'Ventes en point de vente constatées par les animatrices, TTC.', 'Σ fact_sales.amount (kind = SELL_OUT) — formule src/lib/sellout.ts', 'MAD', 'HIGHER_BETTER', 'NONE', 'fact_sales', 'SALES', 12),
  ('SELL_OUT_UNITS', 'Unités sell-out', NULL, 'Σ fact_sales.quantity (SELL_OUT)', 'COUNT', 'HIGHER_BETTER', 'NONE', 'fact_sales', 'SALES', 13),
  ('MARGIN', 'Marge brute sell-in', 'CA HT − quantité × prix d''achat. Non calculée si un produit n''a pas de prix d''achat.', 'Σ fact_sales.margin', 'MAD', 'HIGHER_BETTER', 'NONE', 'fact_sales', 'SALES', 14),
  ('SALES_SHARE', 'Part du CA', 'Poids de l''entité dans le sell-in du portefeuille.', 'CA entité ÷ CA total', 'PCT', 'NEUTRAL', 'NONE', 'fact_sales', 'SALES', 15),
  ('OBJECTIVE_ATTAINMENT', 'Atteinte de l''objectif', 'Sell-in réalisé rapporté à l''objectif de la période.', 'sell-in ÷ objectif proratisé', 'PCT', 'HIGHER_BETTER', 'NONE', 'objectives', 'SALES', 16),
  ('SALES_GROWTH_PREV', 'Croissance vs période précédente', NULL, '(CA − CA période précédente) ÷ CA période précédente', 'PCT', 'HIGHER_BETTER', 'NONE', 'fact_sales', 'SALES', 17),
  ('SALES_GROWTH_N1', 'Croissance vs N-1', NULL, '(CA − CA même période N-1) ÷ CA N-1', 'PCT', 'HIGHER_BETTER', 'NONE', 'fact_sales', 'SALES', 18),
  -- Résultats
  ('IMPRESSIONS', 'Impressions', NULL, 'Σ value (IMPRESSIONS)', 'COUNT', 'HIGHER_BETTER', 'NONE', 'fact_marketing_result', 'RESULT', 20),
  ('REACH', 'Portée', 'Personnes touchées.', 'Σ value (REACH)', 'COUNT', 'HIGHER_BETTER', 'NONE', 'fact_marketing_result', 'RESULT', 21),
  ('CLICKS', 'Clics', NULL, 'Σ value (CLICKS)', 'COUNT', 'HIGHER_BETTER', 'NONE', 'fact_marketing_result', 'RESULT', 22),
  ('LINK_CLICKS', 'Clics sortants', NULL, 'Σ value (LINK_CLICKS)', 'COUNT', 'HIGHER_BETTER', 'NONE', 'fact_marketing_result', 'RESULT', 23),
  ('MESSAGES_STARTED', 'Conversations démarrées', 'Messenger / WhatsApp : le résultat des campagnes « Messages ».', 'Σ value (MESSAGES_STARTED)', 'COUNT', 'HIGHER_BETTER', 'NONE', 'fact_marketing_result', 'RESULT', 24),
  ('LEADS', 'Leads', NULL, 'Σ value (LEADS)', 'COUNT', 'HIGHER_BETTER', 'NONE', 'fact_marketing_result', 'RESULT', 25),
  ('PURCHASES', 'Achats', 'Conversions d''achat remontées par la régie.', 'Σ value (PURCHASES)', 'COUNT', 'HIGHER_BETTER', 'MEASURED', 'fact_marketing_result', 'RESULT', 26),
  ('VIEWS', 'Vues', NULL, 'Σ value (VIEWS)', 'COUNT', 'HIGHER_BETTER', 'NONE', 'fact_marketing_result', 'RESULT', 27),
  ('ENGAGEMENT', 'Engagement', 'Likes + commentaires + partages + enregistrements.', 'Σ value (ENGAGEMENT)', 'COUNT', 'HIGHER_BETTER', 'NONE', 'fact_marketing_result', 'RESULT', 28),
  ('CONTENTS_PUBLISHED', 'Contenus publiés', NULL, 'Σ value (CONTENTS_PUBLISHED)', 'COUNT', 'HIGHER_BETTER', 'NONE', 'fact_marketing_result', 'RESULT', 29),
  ('ANIMATION_DAYS', 'Jours d''animation', NULL, 'Σ value (ANIMATION_DAYS)', 'COUNT', 'NEUTRAL', 'NONE', 'fact_marketing_result', 'RESULT', 30),
  ('CUSTOMERS_ADVISED', 'Clients conseillés', NULL, 'Σ value (CUSTOMERS_ADVISED)', 'COUNT', 'HIGHER_BETTER', 'NONE', 'fact_marketing_result', 'RESULT', 31),
  ('SAMPLES', 'Échantillons remis', NULL, 'Σ value (SAMPLES)', 'COUNT', 'NEUTRAL', 'NONE', 'fact_marketing_result', 'RESULT', 32),
  ('SELLOUT_AMOUNT', 'Sell-out pendant l''action', 'Ventes en rayon constatées pendant l''animation (TTC).', 'Σ value (SELLOUT_AMOUNT)', 'MAD', 'HIGHER_BETTER', 'MEASURED', 'fact_marketing_result', 'RESULT', 33),
  ('SELLOUT_UNITS', 'Unités vendues pendant l''action', NULL, 'Σ value (SELLOUT_UNITS)', 'COUNT', 'HIGHER_BETTER', 'MEASURED', 'fact_marketing_result', 'RESULT', 34),
  ('PARTICIPANTS', 'Participants', NULL, 'Σ value (PARTICIPANTS)', 'COUNT', 'HIGHER_BETTER', 'NONE', 'fact_marketing_result', 'RESULT', 35),
  ('NEW_CLIENTS', 'Nouveaux clients', NULL, 'Σ value (NEW_CLIENTS)', 'COUNT', 'HIGHER_BETTER', 'MEASURED', 'fact_marketing_result', 'RESULT', 36),
  ('PHARMACIES_REACHED', 'Pharmacies touchées', NULL, 'Σ value (PHARMACIES_REACHED)', 'COUNT', 'HIGHER_BETTER', 'NONE', 'fact_marketing_result', 'RESULT', 37),
  ('ORDERS_ON_SITE', 'Commandes sur place', NULL, 'Σ value (ORDERS_ON_SITE)', 'COUNT', 'HIGHER_BETTER', 'MEASURED', 'fact_marketing_result', 'RESULT', 38),
  ('ORDERS_AMOUNT', 'Montant des commandes sur place', NULL, 'Σ value (ORDERS_AMOUNT)', 'MAD', 'HIGHER_BETTER', 'MEASURED', 'fact_marketing_result', 'RESULT', 39),
  ('PRESS_MENTIONS', 'Retombées presse', NULL, 'Σ value (PRESS_MENTIONS)', 'COUNT', 'HIGHER_BETTER', 'NONE', 'fact_marketing_result', 'RESULT', 40),
  ('PROMO_CONVERSIONS', 'Conversions code promo', NULL, 'Σ value (PROMO_CONVERSIONS)', 'COUNT', 'HIGHER_BETTER', 'MEASURED', 'fact_marketing_result', 'RESULT', 41),
  ('COST_PER_RESULT', 'Coût par résultat', 'Dépense divisée par le résultat propre du canal (dim_channel.result_metric).', 'dépense ÷ résultat propre', 'MAD', 'LOWER_BETTER', 'NONE', 'fact_marketing_spend ÷ fact_marketing_result', 'RESULT', 42),
  ('CTR', 'Taux de clic', NULL, 'clics ÷ impressions', 'PCT', 'HIGHER_BETTER', 'NONE', 'src/lib/ads.ts kpis()', 'RESULT', 43),
  ('CPM', 'Coût pour mille', NULL, 'dépense ÷ impressions × 1000', 'MAD', 'LOWER_BETTER', 'NONE', 'src/lib/ads.ts kpis()', 'RESULT', 44),
  ('CPC', 'Coût par clic', NULL, 'dépense ÷ clics', 'MAD', 'LOWER_BETTER', 'NONE', 'src/lib/ads.ts kpis()', 'RESULT', 45),
  -- Retour
  ('ATTRIBUTED_REVENUE', 'CA attribué (mesuré)', 'CA réellement remonté par la régie, un code promo ou une saisie. Jamais estimé.', 'Σ fact_marketing_spend.attributed_revenue', 'MAD', 'HIGHER_BETTER', 'MEASURED', 'fact_marketing_spend', 'RETURN', 50),
  ('ATTRIBUTION_COVERAGE', 'Complétude de l''attribution', 'Part des dépenses qui portent un CA mesuré.', 'dépense avec CA mesuré ÷ dépense totale', 'PCT', 'HIGHER_BETTER', 'NONE', 'fact_marketing_spend', 'RETURN', 51),
  ('ROI_MEASURED', 'ROI mesuré', 'Sur les dépenses attribuées uniquement — la complétude s''affiche à côté.', '(CA attribué − dépense attribuée) ÷ dépense attribuée', 'MULTIPLE', 'HIGHER_BETTER', 'MEASURED', 'fact_marketing_spend', 'RETURN', 52),
  ('SALES_LIFT_CORRELATED', 'Écart de ventes observé', 'Sell-in après − avant sur le périmètre de l''action. Corrélation, pas causalité.', 'compareSales(avant, pendant, après)', 'MAD', 'HIGHER_BETTER', 'CORRELATION', 'src/lib/activations/shared.ts compareSales()', 'RETURN', 53),
  ('ROI_CORRELATED', 'Retour observé', 'Écart de ventes observé rapporté à la dépense. Corrélation observée.', 'écart de ventes ÷ dépense', 'MULTIPLE', 'HIGHER_BETTER', 'CORRELATION', 'fact_sales ÷ fact_marketing_spend', 'RETURN', 54),
  ('CORRELATION_R', 'Corrélation dépense / ventes', 'Coefficient de Pearson entre dépense mensuelle et sell-in mensuel.', 'pearson(dépense, sell-in)', 'RATIO', 'NEUTRAL', 'CORRELATION', 'src/lib/marketing.ts correlation()', 'RETURN', 55),
  -- Composites
  ('HEALTH_SCORE', 'Score de santé marketing', 'Pondération lisible dans Paramètres ; les composantes non mesurables sortent du dénominateur.', 'Σ poids × composante ÷ Σ poids des composantes mesurées', 'SCORE', 'HIGHER_BETTER', 'NONE', 'src/lib/analytics-marketing/metrics.ts healthScore()', 'COMPOSITE', 60),
  ('INVESTMENT_BALANCE', 'Équilibre d''investissement', 'Part du budget − part du CA. > seuil : sur-investi ; < −seuil : sous-investi.', 'part des dépenses − part du CA', 'POINTS', 'NEUTRAL', 'NONE', 'fact_marketing_spend, fact_sales', 'COMPOSITE', 61),
  ('DATA_COMPLETENESS', 'Complétude des données', 'Part des dépenses avec marque, canal et produit, contenus publiés mesurés, activations mesurées, mois avec import Sage.', 'moyenne des taux de complétude', 'PCT', 'HIGHER_BETTER', 'NONE', 'src/lib/analytics-marketing/quality.ts', 'COMPOSITE', 62)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

/* ------------------------------ Journal de rafraîchissement ------------------------------ */

CREATE TABLE IF NOT EXISTS "analytics_refresh_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_kind" text NOT NULL,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz,
  "spend_rows" integer NOT NULL DEFAULT 0,
  "result_rows" integer NOT NULL DEFAULT 0,
  "ok" boolean NOT NULL DEFAULT false,
  "error" text,
  -- IMPORT | SYNC | WORKFLOW | CRON | MANUAL
  "triggered_by" text NOT NULL DEFAULT 'MANUAL'
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_refresh_log_source_idx" ON "analytics_refresh_log" ("source_kind", "started_at");
