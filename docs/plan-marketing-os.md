# Marketing Operating System — audit et plan (04/10/2026)

> **État au 04/10/2026** : phases 1 à 9 livrées sur la branche `feat/marketing-os` (migration 0044, bibliothèques
> `src/lib/marketing-plan/` et `src/lib/decisions/`, pages Command Center / Plan / Priorités & actions / Analytics « Plan
> vs réel », trois outils de l'Agent, règles `plan-rules.ts`, tests). Parcours vérifié sur une base locale jetable :
> création d'un plan, allocation « non mesurable » sans historique, axe, mois, génération de 8 actions, approbation
> d'une décision, changement de statut, tâches, Action Center, Analytics, Budget & dépenses. Guide : `docs/guide-marketing-os.md`.

Objectif : faire évoluer le module Marketing de COMANET OS en système de pilotage complet
(objectifs → plan → budget → allocation → actions → exécution → dépenses → résultats → analyse → réallocation),
sans créer de second référentiel, sans second système de dépenses, sans casser l'existant.

---

## A. Architecture actuelle (ce qui existe réellement)

### Données (toutes dans `src/db/schema.ts`)

| Notion | Table(s) | État |
|---|---|---|
| Enveloppe marketing annuelle par marque | `budgets` (brand × year, `amount`, `reference_revenue`, `pct_of_revenue`) | **= le « budget marketing » du plan** |
| Répartition prévisionnelle par canal | `budget_lines` (brand × year × `category` enum `budget_category` 19 valeurs) | **= l'« allocation par canal »** |
| Dépenses | `marketing_expenses` (brand, campaign?, activation?, collaboration?, product?, category, `status` PLANNED / COMMITTED / SPENT, `attributed_revenue`) | **seul système de dépenses** |
| Objectifs de vente (CA HT, unités) | `objectives` (brand?, product?, year, month?) | = « CA objectif » |
| Campagnes | `campaigns` (+ `campaign_products`, `campaign_ad_links`) | conteneur d'exécution |
| Digital Ads | `ad_accounts`, `ad_metrics` (`campaign_id` → campagne COMANET, `brand_id`), `ad_entities`, `ad_memory` | lecture seule Meta |
| Influence | `influencers`, `collaborations` (brand, product?, campaign?, fee, promo_code, attributed_revenue) | pas reflétée dans `marketing_expenses` |
| Contenu | `content_items` (brand, product?, campaign?, activation?, influencer?, budget) | planning éditorial |
| Activations / trade | `activations` (brand, product, campaign?, client?), `activation_budget_lines` → reflet idempotent dans `marketing_expenses` (`activation_ref`) | seule source d'engagement « automatique » |
| Matériel / goodies | `inventory_items`, `inventory_movements`, `activation_materials` | |
| Tâches | `tasks` (status TODO / IN_PROGRESS / DONE / CANCELLED / PROPOSED, priority, due_date, assignee, brand, `source`, `source_key`, `entity_type/id`, `expected_impact`) | exécution « qui / quand » |
| Recommandations écartées | `recommendation_dismissals` (clé de recommandation) | |
| Analytics transverse | `dim_channel`, `channel_mappings`, `fact_marketing_spend`, `fact_marketing_result`, `metrics_definitions` | reconstruits depuis les modules |
| Copilote | `ai_*` (`ai_action_plans` par clé de recommandation) | |

### Fonctions métier officielles réutilisées (CLAUDE.md)

- Budget consommé : `budgetConsumption()`, `budgetConsumptionByBrand()`, `budgetByCategory()` (`src/lib/budget.ts`).
- Dépense Ads : `adSpend()` ; verdict : `diagnose()` ; résultat officiel : `resultKindOf()`.
- Objectifs et écart : `objectiveFor()`, `annualObjective()` (`analytics.ts`) → `computeTargets()` (`marketing-intel/targets.ts`).
- Stock : `productStocks()`, `stockRiskOf()`, `stockStatusOf()` ; marge : `marginPct()`.
- Performance produit : `buildProductPerformance()`, `salesProfileOf()` (STAR / GROWTH / CASH_COW / UNDERPERFORMER / STABLE).
- Moteur de décision produit : `decide()` (`marketing-intel/decisions.ts`) — PUSH / MAINTAIN / OPTIMIZE / REDUCE / STOP / RESTOCK / DO_NOT_PROMOTE / CREATE_CONTENT / CREATE_PROMOTION / ACTIVATE_INFLUENCER / BOOST_DIGITAL / FOCUS_SELL_OUT, avec `Fact[]` étiquetés CONFIRMED / CALCULATED / INFERRED / MISSING.
- Ads Intelligence : `buildCommandCenter()` (actions SCALE / INCREASE_BUDGET / …, `BrandAllocation`, `PushRecommendation`), `ADS_AGENT_API`.
- Analytics marketing : `channelVerdicts()` (SCALE / MAINTAIN / OPTIMIZE / STOP par couple marque × canal), `proposeReallocations()` (déplacer X MAD du canal A vers B), `classifyProduct()` (poussé × vend).
- Action Center : `RULES` + `allRecommendations()` → `Recommendation { key, rule, category, priority, title, facts, why, action, impact, task }` → `createTaskFromRecommendation()` (une tâche ouverte par clé).

### Quatre moteurs de recommandation coexistent

| Moteur | Entrée | Sortie | Où |
|---|---|---|---|
| Règles Action Center | base | `Recommendation` (rules/types.ts) | `/actions`, cockpit, copilote |
| Ads Intelligence | `ad_metrics` | `Recommendation` (ads-intel/types.ts), `PushRecommendation` | `/marketing/ads` |
| Marketing Intelligence | ventes × stock × marge × Ads | `Decision` (marketing-intel/types.ts) | `/marketing/agent`, copilote |
| Analytics marketing | faits canal × marque | `ChannelVerdict`, `Reallocation` | `/marketing/analytics`, règles `analytics-*` |

Ils ne sont pas contradictoires (chacun appelle les définitions officielles) mais ils n'ont **ni structure commune, ni statut** (approuvée, refusée, exécutée, mesurée) : seul le passage en tâche (`tasks.source_key`) ou l'écartement (`recommendation_dismissals`) laisse une trace, et seulement pour les règles.

### Ce qui manque

1. Aucune notion de **plan marketing** (période, CA objectif, budget, taux marketing, objectifs qualitatifs, axes).
2. Aucune **allocation proposée** : `budget_lines` est saisi à la main ou importé.
3. Aucune **action marketing budgétée** : une tâche n'a ni budget, ni produit, ni canal ; une dépense PLANNED n'a ni responsable, ni échéance, ni statut d'exécution.
4. Aucun **plan mensuel** (produit prioritaire, objectif, budget, actions du mois).
5. Aucune **couche de décision unifiée** ni de statut humain sur une recommandation.
6. La vue d'ensemble `/marketing` est un tableau de bord analytique (corrélation, scorecard), pas un cockpit « quoi pousser maintenant ».
7. Les collaborations influence n'entrent pas dans le budget consommé (pas de reflet dans `marketing_expenses`).

---

## B. Architecture cible

### Navigation

```
MARKETING
├── Command Center          /marketing            (réécrit : quoi pousser, budget, objectif, alertes, décisions)
├── Plan Marketing          /marketing/plan        (nouveau)
├── Priorités & Actions     /marketing/priorites   (nouveau)
├── Campagnes               /marketing/campagnes   (conservé, + axe du plan)
├── Influence               /marketing/influence   (conservé, + axe)
├── Digital Ads             /marketing/ads         (conservé)
├── Contenu                 /marketing/planning    (conservé, renommé, + axe)
├── Activations             /marketing/activations (conservé, + axe)
├── Matériel & Goodies      /marketing/materiel    (conservé, renommé)
├── Budget & Dépenses       /marketing/budgets     (conservé, + chaîne planifié → alloué → engagé → dépensé → reste, + action)
├── Analytics               /marketing/analytics   (+ onglet « Plan vs réel »)
└── Agent Marketing         /marketing/agent       (+ outils plan, actions, décisions)
```

### Chaîne de données (aucune duplication)

```
marketing_plans ─┬─ CA objectif  = objectives (brand, year, month NULL)        [existant]
                 ├─ budget       = budgets (brand, year)                        [existant]
                 ├─ allocation   = budget_lines (brand, year, category)         [existant]
                 ├─ marketing_plan_objectives  (CA, sell-out, volume, …)        [nouveau]
                 ├─ marketing_axes             (axe stratégique budgété)        [nouveau]
                 ├─ marketing_plan_months      (focus produit, objectif, budget) [nouveau]
                 └─ marketing_actions  ─ 1:1 ─ tasks (qui / quand / statut)     [nouveau + existant]
                          │
                          ├─ marketing_expenses.action_id  (dépense ← action)   [colonne ajoutée]
                          ├─ campaigns.axis_id, collaborations.axis_id,
                          │  content_items.axis_id, activations.axis_id         [colonnes ajoutées]
                          └─ marketing_decisions (statut humain d'une décision) [nouveau]
```

- **Budget planifié** = `budgets.amount` ; **alloué** = Σ `budget_lines` ; **engagé** = `budgetConsumption().committed + adSpend` ; **dépensé** = `.spent` ; **reste** = planifié − engagé. Rien de nouveau n'est calculé : la page Budget & Dépenses affiche la chaîne avec les fonctions existantes.
- **Allocation proposée** (`src/lib/marketing-plan/allocation.ts`, pur) : part historique réelle par catégorie (dépenses + régie N-1, CONFIRMED) ajustée par le verdict canal (`channelVerdicts()` → SCALE +, STOP −, seuils `settings.marketingPlan`), normalisée au budget. Sans historique : « NON MESURABLE », aucune proposition.
- **Couche de décision unifiée** (`src/lib/decisions/`) : `UnifiedDecision { id, domain, entity, title, why[], evidence[] (étiquetés), impact, confidence, recommendation, action, source, period, expectedReviewDate, status }` ; adaptateurs **purs** depuis les quatre moteurs (aucun moteur modifié) ; statut humain persisté dans `marketing_decisions` (PROPOSED → APPROVED / REJECTED → EXECUTED → MEASURED / EXPIRED). Approuver = créer une action marketing (+ tâche) ; refuser = écarter ; exécuter = la tâche est faite ; mesurer = résultat saisi. Les règles continuent d'alimenter l'Action Center telles quelles.
- **Action marketing** = ligne `marketing_actions` (plan, axe, mois, marque, produit, catégorie-canal, objectif, justification, résultat attendu, budget prévu, décision d'origine) **+ une tâche** (`tasks.entity_type = 'marketing_action'`) qui porte responsable, échéance, priorité et statut. Statut d'une action = statut de la tâche (BLOCKED ajouté à `task_status`).

---

## C. Migration (sans perte)

Migration `0044_marketing_os.sql` :
- `ALTER TYPE task_status ADD VALUE 'BLOCKED'`.
- Nouvelles tables : `marketing_plans`, `marketing_plan_objectives`, `marketing_axes`, `marketing_plan_months`, `marketing_actions`, `marketing_decisions`.
- Colonnes ajoutées (NULL, `on delete set null`) : `campaigns.axis_id`, `collaborations.axis_id`, `content_items.axis_id`, `activations.axis_id`, `marketing_expenses.action_id`.
- Aucune ligne existante modifiée : les anciennes dépenses gardent `campaign_id` (ou NULL), aucune relation n'est fabriquée. Les budgets, `budget_lines`, objectifs, campagnes, contenus, activations, collaborations, données Ads et recommandations restent tels quels.
- Un plan peut être créé **après coup** sur une année existante : il se rattache aux `budgets` / `objectives` / `budget_lines` déjà saisis.

---

## D. Plan de développement (ordre)

| # | Phase | Fichiers |
|---|---|---|
| 1 | Audit | ce document |
| 2 | Modèle | `src/db/schema.ts`, `drizzle/0044_marketing_os.sql`, `drizzle/meta/_journal.json`, `settings.ts` (`marketingPlan`) |
| 3 | Plan | `src/lib/marketing-plan/{shared,allocation,plan,actions}.ts`, `src/app/(app)/marketing/plan/{page,actions,[id]/page}.tsx` |
| 4 | Command Center | `src/lib/marketing-plan/command-center.ts`, `src/app/(app)/marketing/page.tsx` (réécrit ; l'analyse 13 mois reste dans Analytics) |
| 5 | Priorités & Actions | `src/app/(app)/marketing/priorites/{page,actions}.tsx`, `src/components/marketing-action-card.tsx`, règles `plan-rules.ts` (actions en retard, objectif de plan en retard) |
| 6 | Décisions unifiées | `src/lib/decisions/{types,adapters,store,build}.ts`, actions approuver / refuser, `CATEGORY_MODULES` inchangé |
| 7 | Analytics | `src/app/(app)/marketing/analytics/plan/page.tsx`, `ANALYTICS_TABS` |
| 8 | Agent | `src/lib/ai/tools/marketing-plan.ts` (`get_marketing_plan`, `get_marketing_actions`, `get_unified_decisions`), registre, `prompts/marketing-agent.md` |
| 9 | Tests | `tests/marketing-plan.test.ts`, `tests/decisions.test.ts`, `tests/definitions-uniques.test.ts` |

Liens dans les modules (campagne, collaboration, contenu, activation → axe) : un champ « Axe du plan » sur les formulaires existants.

---

## E. Risques

| Risque | Mitigation |
|---|---|
| `BLOCKED` sur `task_status` : filtres « ouvertes » en SQL (`in ('TODO','IN_PROGRESS')`) | recensés (rules, automations, content/activations tasks, listTasks) ; BLOCKED traité comme ouvert là où la sémantique l'exige (en retard, kanban), ignoré ailleurs (les règles qui ferment une tâche ne ferment pas une tâche bloquée : à vérifier au cas par cas) |
| Double comptage budget | aucune nouvelle somme : seules `budgetConsumption()` et `budgetByCategory()` sont appelées |
| Allocation « inventée » | pure, testée, « NON MESURABLE » sans historique, jamais appliquée d'office |
| Réécriture de `/marketing` | contenu analytique déplacé, pas supprimé ; même garde d'accès |
| Volume de requêtes du Command Center (marketing-intel par marque) | une marque à la fois (onglet), lectures parallèles, pas d'appel dans les règles |
| Recommandations ↔ statut humain | clé stable par moteur ; un statut sans recommandation vivante expire (EXPIRED) |

---

## F. Estimation

| Phase | Complexité |
|---|---|
| 2 Modèle | MEDIUM |
| 3 Plan + allocation | HIGH |
| 4 Command Center | MEDIUM |
| 5 Priorités & Actions | MEDIUM |
| 6 Décisions unifiées | HIGH |
| 7 Analytics plan vs réel | LOW |
| 8 Agent | LOW |
| 9 Tests | MEDIUM |
| Risque global | HIGH (surface large), CRITICAL nulle part : aucune donnée existante n'est transformée |
