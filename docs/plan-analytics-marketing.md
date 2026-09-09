# Analytics marketing transverse (Phase 4) — inventaire et plan

Document soumis avant tout code. Date : 9 septembre 2026. Base inspectée : Supabase prod, lecture seule.

---

## 1. Inventaire des données réellement disponibles

### 1.1 Tables de faits existantes

| Source | Table | Grain | Volume prod | Période couverte | Marque | Produit | Ville | Dépense | Résultat |
|---|---|---|---|---|---|---|---|---|---|
| Ventes Sage (sell-in HT) | `sales` | ligne facture : jour × client × produit | 9 474 | 2025-01 → 2026-08 (20 mois, août partiel : 165 lignes) | via `products.brand_id` (0 orphelin) | oui | via `clients.city` (0 client sans ville) | — | montant HT, quantité |
| Terrain (sell-out TTC) | `animations` + `animation_lines` | jour × point de vente × animatrice ; lignes par produit | 1 381 / 9 459 | 2025-01 → 2026-09 (21 mois) | **`brand_id` NULL sur 100 % des animations** (déductible des produits des lignes) | oui | oui (dénormalisée) | **`cost` = 0 partout** | unités et montant TTC (3 lignes sans montant), clients conseillés, échantillons |
| Objectifs sell-out terrain | `animation_objectives` | marque × ville × année/mois | 42 | 2026 | oui | — | oui | — | unités |
| Objectifs de vente | `objectives` | marque (ou produit) × année/mois | 50 | 2026 | oui | facultatif | — | — | CA HT |
| Budgets marketing | `budgets` + `budget_lines` | marque × année ; lignes par catégorie (19 catégories de l'enum, pas 14) | 4 / 37 | 2026 | oui | — | — | **les 4 enveloppes 2026 sont à 0 MAD** ; 37 lignes de plan | — |
| Dépenses marketing | `marketing_expenses` | dépense datée, statut PLANNED / COMMITTED / SPENT | **1** | 2026-07 | oui (NOT NULL) | facultatif | — | oui | CA attribué saisi, conversions |
| Campagnes | `campaigns` + `campaign_products` | campagne × marque, canal enum | 2 / 1 | 2026-07 → 2026-10 | oui | oui | — | budget indicatif | kpi texte |
| Digital Ads (régie) | `ad_metrics` | jour × publicité (ou campagne) × compte | 561 (1 compte Meta) | 2025-03 → 2026-09 ; **dense seulement depuis 2026-08** (≈ 1 à 5 lignes/mois avant) | oui (0 orphelin) | **jamais** (`ad_creatives` vide) | — | spend MAD converti | impressions, portée, clics, **conversations démarrées (373)** ; achats = 0, leads = 0, revenue = 0 |
| Rattachement régie → campagne | `campaign_ad_links` | — | **0** | — | | | | | |
| Influence | `influencers` / `collaborations` | collaboration × marque × date | 1 / 1 | 2026-09 | oui | facultatif | ville influenceur | cachet + valeur produit | portée, vues, engagement, code promo, CA attribué (vide) |
| Planning éditorial | `content_items` + `content_products` | contenu × marque × plateforme × date | 11 / 4 | 2026-09 → 2026-10 | oui | facultatif | — | `budget` facultatif | reach / engagement saisis ; **0 contenu publié** |
| Activations | `activations` + `activation_budget_lines` (+ `_products`, `_clients`, `_brands`) | activation × type × dates ; lignes budget prévu/engagé/dépensé | 1 / 2 | 2026-09 | oui | oui (multi) | oui | prévu / engagé / dépensé, reflété dans `marketing_expenses` | participants, leads, échantillons, commandes, CA mesuré |
| Échantillons médicaux | `sample_movements` | mouvement × produit | 2 | — | via produit | oui | — | valorisé au prix d'achat | — |
| Stock | `stock_snapshots` | produit × date | 78 | **2026-09-05 → 2026-09-07 seulement** | via produit | oui | — | — | — |
| Référentiels | `brands` 8 actives · `products` 98 (74 avec prix d'achat → marge calculable sur 75 %) · `clients` 535 | | | | | | | | |

### 1.2 Trous et anomalies à connaître avant de construire

1. **Le coût des animations est nul partout** : le sell-out terrain (la plus grosse source de résultats) n'a aucune dépense en face. Sans un coût journalier par animatrice saisi en Paramètres, le canal « Animation POS » aura des résultats mais une dépense « non mesurable ».
2. **Les animations n'ont pas de marque** : la marque se déduit des produits des lignes (une animation multi-marques se répartit au prorata du sell-out). C'est la règle d'attribution à documenter.
3. **Ads : aucun achat, aucun lead, aucun CA remonté.** Le seul résultat mesuré est la conversation démarrée. ROAS et CPA seront « — » ; le coût par résultat sera le coût par conversation. Les achats/leads arriveront quand le pixel sera posé.
4. **Ads dense depuis août 2026 seulement** (≈ 500 lignes sur 561). Avant : 1 à 5 lignes par mois. La tendance 12 mois par canal digital n'est pas comparable avant août 2026 — la page devra le dire.
5. **Aucune campagne de régie rattachée à une campagne COMANET, aucune créative renseignée** : impossible d'affecter une dépense Ads à un produit aujourd'hui. Le produit d'une dépense Ads viendra de `campaign_products` via `campaign_ad_links`, ou de `ad_creatives.product_id` ; tant qu'ils sont vides, la dépense Ads est « sans produit » (écran Qualité).
6. **Marque `Gamardemaroc`** : 1 produit, 2 123 MAD de dépense Ads, 0 vente. Probable doublon de Gamarde côté compte publicitaire : à fusionner ou à traiter comme alias (écran Qualité).
7. **Budgets 2026 : 4 enveloppes à 0 MAD** (Auracos, CygneLab, Alphascience, Ainhoa), 4 marques sans enveloppe. « Dépense vs budget » affichera « pas de budget défini », jamais un pourcentage.
8. **Modules quasi vides** : 1 dépense manuelle, 1 collaboration, 1 activation, 11 contenus non publiés. La couche doit fonctionner à vide et se remplir sans modification.
9. **Stock : 3 jours d'historique.** La couverture de stock (`src/lib/stock.ts`) fonctionne sur le dernier instantané ; le croisement produit × stock est possible dès maintenant, l'historique de surstock non.
10. **Ventes : août 2026 partiel, pas de septembre.** Fenêtre « après » d'une activation de septembre = « pas encore comparable ». « Périodes sans import Sage » se détecte par mois sans ligne (aucun trou entre 2025-01 et 2026-08).
11. **Pas de copilote IA ni de Monthly Brand Review dans le code** (grep sur `copilot`, `brand review`, `revue mensuelle` : rien). Le brief les cite comme existants ; ils sont à créer (voir § 6, question 4).
12. Enum `budget_category` : **19 catégories**, pas 14. Le brief dit 14 ; je garde les 19 de l'enum (source unique).

### 1.3 Ce qui existe déjà et sera réutilisé, pas recodé

- `src/lib/budget.ts` (`budgetConsumption`) — budget consommé, seule définition.
- `src/lib/ad-spend.ts` (`adSpend`) — priorité régie → saisie, exclusion des journées partielles.
- `src/lib/ads.ts` (`diagnose`, `kpis`, `brandAverages`) — verdict SCALE / MAINTAIN / OPTIMIZE / STOP / WATCH, seuils dans `settings.ads`.
- `src/lib/sellout.ts` — CA sell-out TTC.
- `src/lib/stock.ts` / `stock-math.ts` — couverture, tension, surstock.
- `src/lib/activations/shared.ts` (`compareSales`, `measurementWindows`, `roiVerdict`) — avant / pendant / après, « pas encore comparable ».
- `src/lib/marketing.ts` (`correlation`, `correlationLabel`, `attribution`, `brandScorecard`) — corrélation de Pearson, CA réellement attribué.
- `src/lib/animations-shared.ts` (`normalizeCity`) — clé ville.
- `src/lib/periods.ts` (`resolvePeriod` : période, précédente, N-1) — les trois comparaisons systématiques existent déjà.
- `src/components/ui.tsx` (`Kpi`, `Delta`, `Card`, `Section`, `Tabs`, `Empty`, `Facts`, `Progress`) et `charts.tsx` (`MonthlyRevenueChart`, `HBarChart`, `SimpleLine`). Une seule addition : une **matrice** (nuage 2 axes en SVG, sans dépendance) pour part de budget × part de CA et les 4 cas produits.
- `src/lib/rules/` — registre des règles, `Recommendation` (why / action / task).
- `src/app/(app)/page.tsx` + `src/lib/cockpit.ts` (`marketingBlock`) — bloc marketing du cockpit.

---

## 2. Modèle de faits proposé

### 2.1 Choix : tables de faits rafraîchies par job, pas de vues matérialisées

- Supabase accepte les vues matérialisées, mais `REFRESH … CONCURRENTLY` exige un index unique, verrouille, et n'est pas incrémental : à chaque import on rejouerait tout. Une **table de faits reconstruite par source** (`delete where source_kind = X` puis `insert … select`) dans une transaction est aussi rapide sur ces volumes (< 50 000 lignes attendues sur 2 ans), se rafraîchit source par source, se teste, et garde une trace (`analytics_refresh_log`).
- `fact_sales` reste une **vue SQL simple** sur `sales` et `animation_lines` : ces tables sont déjà indexées par date / produit / client, et une vue ne peut jamais être en retard sur Sage.
- Déclenchement du rafraîchissement : (a) fin de chaque `import<Type>()` et de chaque synchro Meta, (b) fin de `transitionActivation()` / `transition()` contenu / sauvegarde d'une dépense ou collaboration, (c) cron Vercel quotidien 6h30 (`/api/cron/analytics`, même garde `CRON_SECRET`), (d) bouton « Recalculer » sur l'écran Qualité. Chaque rafraîchissement est idempotent.

### 2.2 Dimensions

Règle du projet : pas de second référentiel. Donc **pas** de `dim_brand`, `dim_product`, `dim_campaign` : les faits pointent vers `brands`, `products`, `campaigns`, `clients`. Seules deux dimensions nouvelles sont justifiées :

| Table | Rôle | Colonnes |
|---|---|---|
| `dim_channel` | Référentiel configurable des canaux (`/parametres/analytics`) | `key` PK, `label`, `family` (DIGITAL_PAID, ORGANIC, INFLUENCE, TERRAIN, EVENT, TRADE, PRESCRIPTION, OTHER), `result_metric` (métrique « résultat propre » du canal, clé du dictionnaire), `color`, `sort`, `active` |
| `channel_mappings` | Comment chaque source se range dans un canal, modifiable | `source_kind` (BUDGET_CATEGORY, AD_PLATFORM, CONTENT_PLATFORM, ACTIVATION_TYPE, COLLABORATION, ANIMATION, SAMPLE), `source_key`, `channel_key` FK, PK (source_kind, source_key) |
| `dim_period` | Calendrier jour (2024-01-01 → 2028-12-31) : mois, trimestre, année, semaine ISO. Sert aux « périodes sans import » et aux jointures de tendance sans `generate_series` dans chaque page | `day` PK, `month`, `quarter`, `year`, `iso_week` |

Canaux semés par défaut : META_ADS, TIKTOK_ADS, GOOGLE_ADS, ORGANIC_INSTAGRAM, ORGANIC_FACEBOOK, ORGANIC_TIKTOK, ORGANIC_YOUTUBE, SITE, EMAILING, WHATSAPP, INFLUENCE, UGC, CONTENT_PRODUCTION (création / shooting), ANIMATION_POS, EVENT, SPONSORING, SALON, PLV, SAMPLING, GOODIES, OPERATION_PHARMACIE, RP, PRESCRIPTION (médecins / échantillons visite / congrès), TRADE, AGENCE, OTHER. La ville reste `text` normalisé par `normalizeCity()` (pas de table : `clients.city` est déjà la source).

### 2.3 `fact_marketing_spend`

Une ligne par **dépense × jour × marque × produit** (après répartition). Reconstruite par `source_kind`.

| Colonne | Contenu |
|---|---|
| `id` uuid | |
| `day` date | jour de la dépense (régie : jour du compte ; activation : date de la ligne sinon date de l'activation ; contenu : date de publication sinon date prévue) |
| `brand_id` FK, `product_id` FK nullable, `city` text nullable, `campaign_id` FK nullable | |
| `channel_key` FK `dim_channel`, `sub_channel` text | ex. `META_ADS` / `OUTCOME_SALES` ; `ANIMATION_POS` / animatrice ; `INFLUENCE` / nom |
| `budget_category` enum | une des 19 |
| `source_kind` text, `source_id` uuid, `source_ref` text | AD_METRIC, EXPENSE, ACTIVATION_LINE, ACTIVATION_MATERIAL, COLLABORATION, CONTENT, ANIMATION, SAMPLE ; `source_id` = ligne d'origine → lien direct « corriger » |
| `planned`, `committed`, `spent` numeric | montants MAD après répartition ; régie : `spent` seul |
| `share` numeric | quote-part appliquée (1 si pas de répartition) ; `share_basis` text : PRORATA_SALES, EQUAL, DECLARED |
| `is_partial` bool | journée régie non close — exclue des totaux |
| `attribution_mode` text | MEASURED / CORRELATION / NONE, hérité du résultat lié |
| `refreshed_at` | |

Règles de répartition (dans `settings.analytics.productSplit`, défaut `PRORATA_SALES`) : une dépense rattachée à N produits se répartit au prorata du sell-in des 90 derniers jours de ces produits ; sans ventes, à parts égales ; une dépense sans produit reste une ligne `product_id null` (elle compte au niveau marque, pas au niveau produit). Une dépense sans marque n'existe pas (contrainte NOT NULL sur toutes les sources) ; les dépenses Ads sont exclues quand la régie fait foi, exactement comme `ad-spend.ts` (la fonction est appelée, pas recopiée).

Animations : `spent` = `animations.cost` si > 0, sinon `settings.analytics.animationDayCost × days` si renseigné, sinon **NULL** avec `source_ref = 'COUT_NON_MESURE'` — jamais 0.

### 2.4 `fact_marketing_result`

Même grain, une ligne par **résultat × type**.

| Colonne | Contenu |
|---|---|
| `day`, `brand_id`, `product_id`, `city`, `campaign_id`, `channel_key`, `sub_channel`, `source_kind`, `source_id`, `share`, `is_partial` | comme ci-dessus |
| `result_key` text | clé du dictionnaire : IMPRESSIONS, REACH, CLICKS, LINK_CLICKS, MESSAGES_STARTED, LEADS, PURCHASES, AD_REVENUE, VIEWS, ENGAGEMENT, CONTENTS_PUBLISHED, ANIMATION_DAYS, CUSTOMERS_ADVISED, SAMPLES, SELLOUT_UNITS, SELLOUT_AMOUNT, PARTICIPANTS, NEW_CLIENTS, ORDERS_ON_SITE, ORDERS_AMOUNT, PRESS_MENTIONS, ATTRIBUTED_REVENUE, PROMO_CONVERSIONS |
| `value` numeric | |
| `measurement` text | MEASURED (régie, saisie, code promo) / DECLARED (saisie manuelle de portée) — jamais estimé |

### 2.5 `fact_sales` (vue)

`select 'SELL_IN' kind, s.date day, p.brand_id, s.product_id, s.client_id, c.city, c.sector, c.channel client_channel, s.quantity, s.amount amount_ht, case when p.cost_price is not null then s.amount - s.quantity * p.cost_price end margin_ht, s.site from sales s …`
`union all select 'SELL_OUT', a.date, p.brand_id, l.product_id, a.client_id, a.city, …, l.quantity_sold, l.amount (TTC via lineSellout), null margin, null`.
Marge : uniquement quand `cost_price` existe (74 produits sur 98), sinon `null` et affichage « — ».

### 2.6 `metrics_definitions`

| Colonne | |
|---|---|
| `key` PK | identifiant stable (voir § 3) |
| `label`, `description` | français |
| `formula` text | lisible (documentaire) ; le calcul vit dans `src/lib/analytics-marketing/metrics.ts`, un test vérifie que chaque clé de la table a sa fonction et réciproquement |
| `unit` | MAD, %, ratio, count, x |
| `direction` | HIGHER_BETTER / LOWER_BETTER / NEUTRAL |
| `warn_threshold`, `alert_threshold` numeric nullable | seuils modifiables |
| `source` text | quelle table / fonction officielle |
| `attribution` text | MEASURED / CORRELATION / NONE — ce qui s'affiche à côté du chiffre |
| `sort`, `active` | |

### 2.7 `analytics_refresh_log`

`id, source_kind, started_at, finished_at, rows, ok, error, triggered_by` — la fraîcheur affichée sur chaque page.

### 2.8 `settings.analytics` (dans `comanet.rules`, écran Paramètres)

```
windowBeforeDays 30 · windowDuringMaxDays 30 · windowAfterDays 30
productSplit 'PRORATA_SALES' | 'EQUAL'
animationDayCost null (MAD/jour ; null = non mesurable)
healthScore { weights: { objective 30, roi 25, intensity 15, coverage 15, dataQuality 15 } }
productCases { pushedMinSpend 500, pushedMinExposures 2, sellingGrowthPct 10 }
channelDiagnosis { minSpend 300, minWeeks 2, costRisePct 20, costDropPct 15, degradingWeeks 3 }
reallocation { minShiftMad 1000, maxShiftPct 30, minConfidence 'MOYENNE' }
alerts { budgetDriftPct 10, brandNoSpendObjectiveDropPct 15 }
```

---

## 3. Dictionnaire de métriques (clé · formule · source · attribution)

**Argent**
- `SPEND_PLANNED` / `SPEND_COMMITTED` / `SPEND_SPENT` — Σ `fact_marketing_spend` (hors partiel) · MAD · NONE.
- `BUDGET_ANNUAL` — `budgets.amount` · via `budgetConsumption()`.
- `BUDGET_CONSUMED_PCT` — consommé ÷ budget · `budgetConsumption()` · null sans budget.
- `SPEND_SHARE` — dépense de l'entité ÷ dépense totale du portefeuille sur la période · %.
- `MARKETING_INTENSITY` — dépense ÷ CA sell-in HT · % · LOWER_BETTER à CA égal (seuil alerte configurable).

**Ventes** (source `fact_sales`)
- `SELL_IN` — Σ amount_ht SELL_IN · MAD. `SELL_IN_UNITS`.
- `SELL_OUT` — Σ SELL_OUT (TTC, `lineSellout`) · MAD. `SELL_OUT_UNITS`.
- `MARGIN` — Σ margin_ht, « — » si un produit du périmètre n'a pas de prix d'achat (complétude affichée).
- `SALES_SHARE` — CA de l'entité ÷ CA portefeuille · %.
- `OBJECTIVE_ATTAINMENT` — sell-in ÷ `objectives.amount` proratisé sur la période · %.
- `SALES_GROWTH_PREV` / `SALES_GROWTH_N1` — Δ vs période précédente / N-1 (`resolvePeriod`).

**Résultats par canal** (source `fact_marketing_result`)
- `IMPRESSIONS`, `REACH`, `CLICKS`, `MESSAGES_STARTED`, `LEADS`, `PURCHASES`, `VIEWS`, `ENGAGEMENT`, `CONTENTS_PUBLISHED`, `ANIMATION_DAYS`, `CUSTOMERS_ADVISED`, `SAMPLES`, `PARTICIPANTS`, `NEW_CLIENTS`, `ORDERS_ON_SITE`, `PRESS_MENTIONS` — Σ value · count · MEASURED ou DECLARED selon la ligne.
- `COST_PER_RESULT` — dépense ÷ résultat propre du canal (`dim_channel.result_metric`) · MAD · LOWER_BETTER. Exemples : META_ADS → MESSAGES_STARTED tant que PURCHASES = 0, ANIMATION_POS → SELLOUT_AMOUNT (coût pour 100 MAD de sell-out), INFLUENCE → REACH, contenu organique → ENGAGEMENT, SAMPLING → SAMPLES.
- `CTR`, `CPM`, `CPC` — existants `kpis()` de `ads.ts`.

**Retour**
- `ATTRIBUTED_REVENUE` — Σ CA réellement mesuré (régie `revenue`, `collaborations.attributed_revenue`, `activations.attributed_revenue`, `marketing_expenses.attributed_revenue`) · MEASURED.
- `ROI_MEASURED` — (CA attribué − dépense) ÷ dépense · ratio · MEASURED, avec `ATTRIBUTION_COVERAGE` = dépense portant un CA mesuré ÷ dépense totale (« basé sur 82 % des dépenses attribuées »).
- `SALES_LIFT_CORRELATED` — sell-in « après » − « avant » sur le périmètre (clients / ville × produits) via `compareSales()` · MAD · CORRELATION · « pas encore comparable » si fenêtre incomplète.
- `ROI_CORRELATED` — lift ÷ dépense · CORRELATION, toujours étiqueté « corrélation observée ».
- `CORRELATION_R` — Pearson dépense mensuelle × sell-in mensuel · `correlation()`.

**Composites**
- `HEALTH_SCORE` (0-100) — pondération lisible : atteinte objectif 30, ROI mesuré ou lift corrélé 25, intensité vs médiane portefeuille 15, couverture de stock des produits poussés 15, complétude des données 15 ; poids dans `settings.analytics.healthScore`. Chaque composante « — » sort du dénominateur, et le score affiche « sur N composantes mesurées ».
- `INVESTMENT_BALANCE` — part budget − part CA · points · aligné si |Δ| ≤ 5 pts, sur-investi si > +5, sous-investi si < −5 (seuil configurable).
- `PRODUCT_CASE` — POUSSE_VEND / POUSSE_VEND_PAS / PAS_POUSSE_VEND / DORMANT. Poussé = dépense allouée ≥ `pushedMinSpend` OU expositions (contenus + activations + animations) ≥ `pushedMinExposures` ; se vend = croissance sell-in ≥ `sellingGrowthPct` vs période précédente OU au-dessus de la médiane de la marque.
- `CHANNEL_VERDICT` — SCALE / MAINTAIN / OPTIMIZE / STOP / WATCH par canal × marque : Ads via `diagnose()` inchangé ; autres canaux : règle générique sur `COST_PER_RESULT` (Δ vs période précédente, vs moyenne du canal sur le portefeuille), volume minimal, et véto stock (`isUnderTension`).
- `DATA_COMPLETENESS` — part des dépenses avec marque + canal + produit, contenus publiés avec performance, activations terminées mesurées, mois avec import Sage.

---

## 4. Plan d'implémentation (8 étapes courtes)

| # | Étape | Fichiers / tables | Test | Ce qu'Hicham vérifie |
|---|---|---|---|---|
| 1 | **Fondation** : migration `0017_analytics_marketing` (dim_channel + semis, channel_mappings + semis depuis les 19 catégories / plateformes / types, dim_period, fact_marketing_spend, fact_marketing_result, vue fact_sales, metrics_definitions + semis, analytics_refresh_log, index), `settings.analytics`, journal | `drizzle/0017…sql`, `_journal.json`, `src/db/schema.ts`, `src/lib/settings.ts` | migration passe sur PGlite | `/installation` → « Appliquer les migrations » |
| 2 | **Rafraîchissement** : `src/lib/analytics-marketing/refresh.ts` (une requête `insert … select` par source, répartition produit, animations → marque par prorata), hooks en fin d'import / synchro / transitions, `/api/cron/analytics`, `vercel.json` | `refresh.ts`, `import/run.ts`, `meta/sync.ts`, workflows (un appel chacun), `api/cron/analytics/route.ts` | tests unitaires : répartition prorata / égale, coût animation null, exclusion partiel | Écran Qualité (étape 3) montre la fraîcheur et les compteurs |
| 3 | **Lecture + Qualité** : `queries.ts` (agrégats par axe, filtres période / marque / canal / produit / ville, comparaisons), `metrics.ts` (registre = dictionnaire), page `/marketing/analytics/qualite` avec responsables et liens de correction | `src/lib/analytics-marketing/{queries,metrics,quality}.ts`, page | test « chaque clé du dictionnaire a une fonction » | Les manques listés au § 1.2 apparaissent avec un lien qui mène à la bonne fiche |
| 4 | **Synthèse + Par marque** : `/marketing/analytics` (6 chiffres, 3 axes), `/marketing/analytics/marques` (tableau, matrice budget × CA, mix canaux, score de santé), composant `MatrixChart` | pages, `charts.tsx` (+1 composant), `nav-config.ts` | tests intensité, part, balance, score | Lisible sur téléphone ; « — » là où la donnée manque ; « corrélation observée » libellé |
| 5 | **Par canal** : `/marketing/analytics/canaux`, coût par résultat, inter-canaux à marque constante, inter-marques à canal constant, verdict pourquoi → quoi faire | page, `diagnosis.ts` | tests verdict générique (dérive coût, volume mini, véto stock) | Meta Ads reprend exactement le verdict de `/marketing/ads` |
| 6 | **Par produit** : `/marketing/analytics/produits`, 4 cas, croisement couverture / surstock via `productStocks()` | page, `product-cases.ts` | tests classification 4 cas | Aucun produit en rupture n'est proposé « à pousser » |
| 7 | **Décision** : `reallocation.ts` (déplacer X MAD de A vers B pour M, raisonnement, attendu, confiance), règles Action Center `analytics-rules.ts` (dérive budget, coût par résultat en dégradation 3 semaines, marque sans dépense et objectif décroché, produit poussé sans effet), bloc cockpit, revue mensuelle par marque `/marketing/analytics/revue/[brand]?mois=` imprimable | `rules/analytics-rules.ts`, `rules/index.ts`, `cockpit.ts`, pages | tests réallocation (bornes, confiance) et règles | Une reco → une tâche en un clic ; cockpit affiche le bloc |
| 8 | **Paramètres + guide** : `/parametres/analytics` (canaux, mappings, dictionnaire, seuils, fenêtres), `docs/guide-analytics-marketing.md` | page, actions, doc | — | Modifier un seuil change le verdict à la page suivante |

Chaque étape : `npx tsc --noEmit`, `npm test`, `npm run build` avant commit, sur la branche `feat/analytics-marketing` créée depuis `main` (la branche `feat/activations` n'est pas encore fusionnée : voir question 5).

Droits : pages sous `requireAccess("marketing")` ; brand review sous `rapports` ; Paramètres analytics sous `administration`. Portée marques via `brandFilter()` comme sur `/marketing`.

---

## 5. Décisions prises par défaut (à contredire si besoin)

1. **Tables rafraîchies plutôt que vues matérialisées** (argument § 2.1).
2. **Pas de `dim_brand` / `dim_product` / `dim_campaign` / `dim_city`** : les référentiels existants sont les dimensions (règle « pas de second référentiel »). Seuls `dim_channel`, `channel_mappings`, `dim_period` sont créés.
3. **19 catégories budgétaires** (celles de l'enum), pas 14.
4. **Formule d'une métrique = code TypeScript** ; la table porte libellé, unité, sens, seuils, description, attribution. Une formule SQL exécutée depuis la base serait un risque et une seconde définition.
5. **Coût animation** : `null` tant que `animationDayCost` n'est pas saisi — la page dira « dépense non mesurable » sur le canal Animation POS.
6. **Résultat propre de Meta Ads** = conversations démarrées tant que les achats sont à 0 (bascule automatique sur PURCHASES dès qu'il y en a).
7. **Copilote** : il n'existe pas. Je livre en étape 8 un **bloc « Question »** minimal : champ texte → interprétation par règles (marque, canal, ville, période détectés dans la phrase) → réponse structurée Donnée / Analyse / Hypothèse / Recommandation depuis le dictionnaire, sans appel à un LLM. Un vrai copilote (API Claude) est une phase à part.
8. **Monthly Brand Review** : une page serveur imprimable (`print` CSS, bouton « Exporter en PDF » via le navigateur), pas de génération de fichier côté serveur.

## 6. Questions ouvertes

1. Coût journalier d'une animatrice : as-tu une valeur (MAD/jour) à mettre en Paramètres, ou une grille par ville ?
2. `Gamardemaroc` : doublon de Gamarde à fusionner, ou marque distincte ?
3. Enveloppes 2026 à 0 MAD : à saisir avant la démo, sinon « pas de budget défini » partout.
4. Copilote sans LLM (décision 7) suffit-il pour cette phase ?
5. Je pars de `main` ; la branche `feat/activations` doit-elle être fusionnée d'abord (le module Activations en dépend pour `activation_budget_lines`) ? Sans fusion, la couche gère l'absence des tables Activations.
