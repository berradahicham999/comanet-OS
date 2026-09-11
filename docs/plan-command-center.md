# COMANET Command Center — audit du dépôt et plan

Audit réalisé le 11 septembre 2026 sur `main` (commit `26f9c17`, PR #14 fusionnée) et sur la base de production
(Supabase `cfesexhagpbtiwsyhrzt`). Aucune fonctionnalité n'a été codée : ce document dit ce qui existe, ce qui
manque, et dans quel ordre construire. Règle de lecture : **tout ce qui est marqué « existe » est réutilisé tel
quel ou étendu, jamais refait.**

Cible rappelée par Hicham : ouvrir COMANET OS le matin et voir **COMANET TODAY** — (1) ce qui a changé,
(2) ce qui est préoccupant, (3) ce qui va probablement arriver, (4) les opportunités, (5) les 5 décisions à
prendre — chaque décision portant WHY → EVIDENCE → IMPACT → CONFIDENCE → APPROVE. Les dashboards actuels
restent accessibles ; le Command Center devient la couche au-dessus.

---

## 1. Architecture actuelle

| Couche | Réalité dans le code | Taille |
|---|---|---|
| Framework | Next.js 16 App Router, React 19, server components + server actions, Tailwind 4, Drizzle, Postgres (Supabase Frankfurt), Vercel `fra1` | 68 commits, 05 → 11/09/2026 |
| Modèle de données | `src/db/schema.ts`, source unique ; **106 tables** en prod ; 21 migrations SQL journalisées | 2 957 lignes |
| Logique métier | `src/lib/`, une bibliothèque par domaine ; règle « une notion = une fonction » gardée par `tests/definitions-uniques.test.ts` | 21 106 lignes |
| Moteurs de décision | **trois moteurs parallèles** (détaillés au §3) : `src/lib/rules/` (3 022 l.), `src/lib/ads-intel/` (3 820 l.), `src/lib/analytics-marketing/` (3 676 l.) | |
| Événements | `src/lib/events/` (746 l.) : outbox léger `events` + `event_consequences`, dispatcher synchrone, journal admin `/parametres/evenements` | |
| IA | `src/lib/ai/` (3 303 l.) : copilote à outils typés, brief, expliquer, détailler, rapports | |
| Imports | `src/lib/import/` (4 564 l.), 12 types, un seul moteur | |
| Meta | `src/lib/meta/` (3 944 l.) : client Graph, sync fenêtre glissante, backfill reprenable, catalogue, doctor | |
| Batch | 4 crons Vercel : Meta intraday (toutes les heures), Meta full (06:00), backfill (03:00), analytics facts (06:30). **Aucun cron n'évalue les règles ni ne fige un état quotidien.** | |
| Interface | 87 pages ; `src/components/ui.tsx` design system ; Cockpit `/` (eyebrow déjà « COMANET TODAY »), Action Center `/actions`, Ads Command Center `/marketing/ads` (page unique + drawers = le modèle d'écran le plus proche de la cible) | |
| Droits | matrice `user_permissions` 14 modules × 4 actions, portée, interrupteurs ; `requireAccess()` / `requireAnyModule()` ; Action Center filtré par `CATEGORY_MODULES` | 12 utilisateurs actifs |
| Tests | 331 tests `node:test`, aucun ne requiert la base ; garde-fous : définitions uniques, lecture seule IA, dispatch d'événements | |

Deux caractéristiques structurantes pour la suite :

- **Tout est calculé à la lecture.** `getRecommendations()` est un `react cache()` par requête : les 24 règles
  tournent à chaque ouverture du Cockpit ou de l'Action Center et **rien n'est persisté**. Il n'existe donc
  aucune histoire des recommandations : on ne sait pas depuis quand une alerte est ouverte, ni ce qui est apparu
  ou disparu depuis hier.
- **Deux horloges** (`src/lib/ref-date.ts`) : `today` = dernière date de vente importée (analyses Sage),
  `now` = date réelle (terrain, réglementaire, tâches, budgets, régie). Toute la cible doit garder cette
  distinction ; « ce qui a changé » se mesure sur les deux.

---

## 2. Fonctionnalités déjà existantes (à réutiliser, pas à refaire)

### 2.1 Face à chacun des cinq blocs de COMANET TODAY

| Bloc cible | Ce qui existe déjà | Ce qui manque pour le bloc |
|---|---|---|
| **1. Ce qui a changé** | Cockpit : CA mois vs M-1 / N-1, par marque vs M-1, 13 mois vs N-1 ; snapshot Ads avec deltas vs période précédente ; brief du matin (LLM, administrateurs, cache quotidien `ai_cache`) qui commence par « ce qui a bougé » | Aucun état figé à comparer : pas de photo quotidienne des KPI ni des décisions → impossible de dire « nouveau depuis hier » de façon déterministe. La table `events` (faits horodatés, dédoublonnés, rejouables) est le bon support mais ne journalise que deux types d'animation |
| **2. Ce qui est préoccupant** | Action Center : 24 règles, priorités CRITICAL → LOW, tri priorité × enjeu, `existingTask` ; blocs Réglementaire / Stock du Cockpit ; problèmes et anomalies Ads (`problems`, `anomalies`) | Existe. À unifier avec les décisions Ads (deux objets `Recommendation` différents, voir §3) |
| **3. Ce qui va probablement arriver** | Signaux datés déjà calculés : `stockoutDate` / `daysToStockout` (`stock-math.ts`), `nextTheoretical` / `daysUntilNext` client (`clients.ts`), `monthProjection()` rythme de fin de mois (`analytics.ts`), `projected` dépense Ads du mois (`ads-intel/command-center.ts`), `sampleForecast()` médical, échéances réglementaires, retards de contenus/activations (`lateness()`) | Ces signaux sont dispersés dans 6 modules et jamais présentés ensemble ; aucun moteur de prévision (ventes par marque, saisonnalité, rupture avec commande en cours) ; aucune probabilité |
| **4. Les opportunités** | Ads : winners, `push` (PUSH_MORE), `content` (quoi publier), `allocation` SCALE ; analytics : `reallocationsFrom()` avec résultat attendu et confiance ; clients `highPotential` et recommandation `DEVELOPPEMENT` (volontairement hors Action Center, voir `commercial-rules.ts:19`) ; surstock (`stock-overstock`) | Aucun score d'opportunité commun ; les opportunités commerciales sont cachées dans les fiches clients ; rien ne les met côte à côte |
| **5. Les 5 décisions** | **Ads uniquement** : `topActions()` retient 3 à 5 recommandations WHY / DATA / ACTION / CONFIANCE, « ne rien faire » compris (`ads-intel/recommend.ts:141`) ; Cockpit : top 4 recommandations sans tâche | Pas de sélection transverse (stock + clients + réglementaire + marketing + terrain) ; pas de confiance sur les règles ; pas d'objet « décision » avec approuver / refuser / reporter |

### 2.2 Face au contrat WHY → EVIDENCE → IMPACT → CONFIDENCE → APPROVE

| Élément | Règles (`rules/types.ts`) | Ads (`ads-intel/types.ts`) | Analytics (`reallocation.ts`) | Verdict |
|---|---|---|---|---|
| WHY | `why: string` (diagnostic chiffré) | `why: string[]` + `headline` + `cause` (créative / offre / audience / fatigue / suivi / volume) | `reasoning` | Existe partout, formes différentes |
| EVIDENCE | `facts: {label,value}[]` | `data: {label,value,delta,good}[]` | faits dans la règle pont | Existe, mais **sans clé de métrique, période, source ni mode d'attribution** — alors que `metrics_definitions` (51 définitions, colonne `attribution` MEASURED / CORRELATION / NONE) existe déjà pour ça |
| IMPACT | `impact?: string` (libre, souvent absent) + `score` (enjeu MAD, sert au tri) | aucun montant (contribution « non mesurable » sans valeur par résultat) | `expected: {key, value, costPerResult}` extrapolé | Partiel ; jamais typé (MAD / unités / jours / risque) |
| CONFIDENCE | **absente** | `confidence` 0–100 + `confidenceWhy[]` (`confidenceOf()` : volume, durée, stabilité, références, qualité) | HAUTE / MOYENNE / FAIBLE + `confidenceWhy` | Existe sur 2 moteurs sur 3 ; deux échelles |
| APPROVE | « Créer une tâche » → `tasks` avec `source_key` = clé de la règle, une tâche ouverte par clé ; brief → tâche ; copilote → tâche `PROPOSED` à accepter | même mécanisme via la règle `ads-performance` | via la règle `analytics-reallocation` | Approuver = créer la tâche, **c'est le bon mécanisme, à garder**. Manquent : refuser avec motif, reporter, et la trace de la décision elle-même |

### 2.3 Autres briques réutilisables telles quelles

- `src/lib/ads-intel/metrics.ts` : `trendOf()`, `stabilityOf()`, `zScores()` (fenêtre 28 j), `confidenceOf()` — **purs, testés, généralisables** à toute série journalière (ventes, sell-out, stock).
- `src/lib/activations/roi.ts` : `compareSales()` avant / pendant / après avec « pas encore comparable » — le
  patron exact d'un « attendu vs réalisé » à l'horizon d'une décision.
- `src/lib/ads-intel/memory.ts` + table `ad_memory` : phrases apprises avec preuves et confiance, recalculées,
  persistées — un embryon de mémoire, limité aux Ads (0 ligne en prod : catalogage jamais lancé).
- `src/lib/analytics-marketing/quality.ts` : complétude des données avec responsable et lien de correction —
  la brique « état des données » que chaque décision doit citer.
- `src/lib/events/` : outbox transactionnel, idempotent (`dedupe_key`, `revision`), rejouable, journal admin,
  tests en mémoire. **Handlers vides** (`HANDLERS[ANIMATION_COMPLETED] = []`), 1 événement en prod.
- `notifications` + `src/lib/content/notify.ts` : notifications in-app typées, déjà utilisées par 16 types
  (contenus, activations, rapports).
- Ads Command Center (`src/components/ads/command-center.tsx`, `buildCommandCenter()`) : le modèle d'écran
  « une page, tout le détail en drawers, l'interface ne calcule rien ».
- `settings` (`comanet.rules`) + pages Paramètres : tout seuil y vit ; `settings.adsIntel`, `settings.ads`,
  `settings.analytics`, `settings.ai` sont typés et ont des défauts.

---

## 3. Le Rule Engine actuel

`src/lib/rules/index.ts` — registre `RULES`, contrat `Rule = { id, label, description, run(ctx) }`, contexte
préchargé une fois (`settings`, `today`, `now`, `stocks` = `productStocks()`, `clients` = `clientIntel()`).
Chaque règle renvoie des `Recommendation` ; une règle en erreur est isolée (`console.error`, `[]`).

**24 règles, 11 fichiers :**

| Domaine | Règles | Ce qu'elles lisent |
|---|---|---|
| Stock | `stock-coverage`, `stock-overstock` | `productStocks()` (couverture, rupture estimée, commande conseillée, MOQ) |
| Réglementaire | `regulatory-expiry` | `regulatory_files`, seuils `regulatoryAlertDays` |
| Commercial | `client-intel` (RELANCE / RÉACTIVATION / ANALYSE / ANIMATION, max 12 par enjeu), `brand-drop`, `data-quality` | `clientIntel()`, `compareMonth()` |
| Marketing | `budget-overrun`, `ads-performance`, `influence-tracking`, `campaign-stock` | `budgetConsumption()`, `diagnose()`, campagnes actives × `isUnderTension()` |
| Analytics (pont) | `analytics-reallocation`, `analytics-budget-drift`, `analytics-cost-degrading`, `analytics-brand-no-spend`, `analytics-pushed-no-effect` | `channelVerdicts()`, `reallocationsFrom()`, `isDegrading()`, `classifyProduct()` |
| Terrain | `terrain-sellout`, `animation-performance` | `animation_lines`, `animatriceScores()` |
| Exécution | `tasks-overdue`, `content-late`, `activation-late`, `inventory-low` | `tasks`, `lateness()`, `activationLateness()`, `inventoryStatus()` |
| Médical | `medical-doctor-follow-up`, `medical-delegate-objective-behind`, `medical-sample-shortage` | visites, objectifs délégués, `sampleForecast()` |

**Forces** : clés stables (`rule:entity`) → dédoublonnage et liaison aux tâches ; priorité × enjeu ; seuils
dans `settings` ; croisement de domaines déjà pratiqué (`campaign-stock`, véto stock dans `recommend()` et
`reallocation.ts`) ; filtrage par module pour l'affichage et pour l'outil IA `get_action_center`.

**Limites vis-à-vis de la cible** :

1. **Trois contrats de recommandation** portent le même nom `Recommendation` (`rules/types.ts` et
   `ads-intel/types.ts`) avec des formes incompatibles ; `analytics-marketing` a un troisième objet
   (`Reallocation`, `PairVerdict`). Le pont `analytics-rules.ts` montre la bonne méthode : **adapter**, pas
   recoder.
2. **Doublon de signal possible** : une campagne jugée par `diagnose()` apparaît dans la règle
   `ads-performance` **et** dans `topActions()` du Ads Command Center. Une sélection transverse doit
   dédoublonner par entité.
3. **Pas de confiance** sur les règles ; **pas d'impact typé** ; **pas d'horizon de vérification**.
4. **Pas de persistance** : aucune règle ne sait qu'elle s'est déjà déclenchée hier ; pas de « vu depuis »,
   pas de mise en sommeil, pas de refus motivé. Seules traces : `tasks.source_key` (93 tâches, dont 12 depuis
   l'Action Center) et `event_consequences` (0 ligne).
5. **Coût d'évaluation** : 24 règles + 2 requêtes lourdes (`productStocks`, `clientIntel`) à chaque page ;
   acceptable aujourd'hui (535 clients, 98 produits), pas comme socle d'un « ce qui a changé » quotidien.

---

## 4. Données actuellement disponibles

Volumes réels au 11/09/2026 (audit data de la même journée, voir mémoire `perimetre-data-comanet`) :

| Domaine | Volume | Couverture | Qualité pour décider |
|---|---|---|---|
| Sell-in (`sales`) | 9 474 lignes, 535 clients, 98 produits | 01/2025 → 31/08/2026 (20 mois), import Sage toutes les 2 semaines | Bonne. Canal = `site` (100 %) ; commercial sur 62 % de 2026, 0 % de 2025 ; 8 commandes grossistes PHARMAFIRST = 65 % du CA (normal, confirmé) |
| Stock (`stock_snapshots`) | 78 lignes, **2 dates** (05 et 10/09) | 77 produits ; 18 produits vendus sans stock | **Insuffisant pour toute tendance** ; couverture instantanée seulement. Import hebdomadaire décidé |
| Terrain (`animations`) | 1 381 animations, 9 459 lignes | 01/2025 → 09/2026 | **0 marque, coût 0** sur 100 % des lignes → ROI terrain non calculable |
| Régie (`ad_metrics`) | 652 lignes ; 602 API (10/08 → 11/09/2026), 50 fichier | 1 compte (COMANET MOROCCO, EUR), backfill en erreur « API access blocked » | Un mois d'API : benchmarks et winners jugent sur 30 jours. `ad_entities` / `ad_creatives` = 0 (catalogage jamais lancé) |
| Faits marketing | 10 123 dépenses, 30 753 résultats | rafraîchis 130 fois sans erreur | Bon socle pour canal × marque |
| Budgets | 4 marques / 10 en 2026 (6 sans budget, dont Gamarde = 59 % du CA) | import réparé (PR #14), à rejouer | Bloque budget consommé et « budget mois » Ads |
| Objectifs | 50 lignes, 2026, 7 marques / 10 | pas de 2025 | Comparaison N-1 impossible sur objectif |
| Produits | 98 | 98/98 sans catégorie, 23 sans PVC (20 vendus), 21 sans prix d'achat | Sell-out et marge partiels |
| Réglementaire | 95 dossiers, 103 événements | importés le 05/09 | Bon |
| Médical | 830 médecins, 1 délégué, 6 visites | démo | Non décisionnel |
| Contenus / activations / influence / inventaire | 11 / 2 / 2 / 0 | démo | Non décisionnel |
| Tâches | 92 (48 ouvertes), 44 terminées avec `completed_at` | | Seule trace d'exécution exploitable pour un « attendu vs réalisé » |
| Événements | 1 (`done`), 0 conséquence | | Journal vide |
| IA | 10 messages, 21 appels d'outils, 2 briefs en cache, 0 `ad_memory` | | Copilote à peine utilisé en prod |

Conséquence directe pour le Command Center : les blocs 1, 2 et 5 sont alimentables **dès maintenant** par
sell-in, réglementaire, stock instantané, clients, budgets (une fois rejoués) et Ads (30 jours). Le bloc 3
(prévisions) et la phase 4 (learning loop) n'auront de valeur qu'avec un historique de stock hebdomadaire,
des animations rattachées à une marque et un coût, et plus d'un cycle saisonnier de régie.

---

## 5. Capacités IA déjà présentes

**Déterministes (sans modèle de langage)** — c'est l'essentiel, et c'est ce qui doit rester le cœur :

- Ads Intelligence : benchmark (précédent, marque, objectif, historique, meilleur, produit), tendance, anomalies
  z-score, fatigue, winners (volume, jours, coût, stabilité, récence), motifs de contenu par angle / format,
  allocation par marque, produits à pousser, santé /100, budget projeté, impact business (corrélation
  affichée comme telle), mémoire persistée ; API `ADS_AGENT_API` (10 fonctions).
- Analytics marketing : verdict canal × marque (`diagnoseChannel()`, trois moteurs : Ads officiel, animation
  rentabilité, générique), réallocations chiffrées avec confiance, santé pondérée, dictionnaire de
  métriques, complétude des données, « Poser une question » sans LLM (`ask.ts`).
- Clients : segment, rythme de commande, commande théorique, retard, fort potentiel, recommandation typée.
- Stock : couverture, niveau, rupture estimée, commande conseillée (MOQ, délai, sécurité).
- Activations : impact ventes avant / pendant / après, verdict ROI, « pas encore comparable ».

**Avec modèle (Claude, `src/lib/ai/`)** — outillage complet, usage réel encore faible :

- Copilote ⌘K (SSE), 13 outils Zod (11 lectures, 2 écritures : tâche `PROPOSED`, rapport `DRAFT`),
  filtrés par la matrice et la portée, journalisés (`ai_tool_calls`), garde-fou lecture seule testé.
- System prompt versionné et mis en cache ; format Donnée / Analyse / Hypothèse / Recommandation ;
  doctrine « zéro chiffre hors `tool_result` », « corrélation ≠ causalité ».
- Brief du matin (admins, 5–7 lignes + 3 actions → tâches), « Expliquer » (cartes, cache 1 h), « Détailler »
  (plan d'exécution par clé de recommandation, `ai_action_plans`), rapports WEEKLY / MONTHLY BRAND REVIEW.
- Limites et coût dans `settings.ai` ; modèles en variables d'environnement.

Ce que ça signifie pour la cible : **le Command Center n'a pas besoin d'un nouveau modèle ni d'un nouvel
agent**. Il a besoin d'un objet « décision » commun, d'une sélection transverse, d'une persistance, puis d'un
outil `get_decisions` pour que le copilote et le brief lisent la même chose que l'écran.

---

## 6. Ce qui manque réellement

Par ordre de dépendance (chaque ligne s'appuie sur la précédente) :

1. **Un contrat de décision unique** (`Decision`) avec adaptateurs depuis les trois moteurs. Aujourd'hui trois
   objets, deux échelles de confiance, un nom de type en collision.
2. **La persistance des décisions** : identité stable dans le temps, `first_seen` / `last_seen`, statut
   (ouverte, approuvée, refusée, reportée, expirée, résolue), qui a décidé, pourquoi. Sans elle, ni « ce qui a
   changé », ni mémoire, ni apprentissage.
3. **Une photo quotidienne** des KPI et des décisions (cron), pour calculer les deltas de façon déterministe
   au lieu de recalculer tout à chaque page.
4. **La confiance sur les règles** (les Ads et l'analytics l'ont déjà) : volume, fraîcheur des données,
   complétude, comparabilité — en réutilisant la logique de `confidenceOf()`.
5. **Des preuves typées** : chaque fait cite sa métrique (`metrics_definitions.key`), sa période, sa source et
   son mode d'attribution — la table existe, elle n'est pas branchée sur les recommandations.
6. **La sélection des 5 décisions** : transverse, dédoublonnée par entité, diversifiée par domaine, avec
   « ne rien faire » possible ; aujourd'hui seule la page Ads le fait.
7. **Le bloc « ce qui va probablement arriver »** : rassembler les signaux datés existants, puis (phase 2)
   des projections nommées comme telles.
8. **Anomalies hors Ads** (sell-in par marque / client / produit, sell-out, stock) : `zScores()` existe,
   il n'est appliqué qu'aux séries de régie.
9. **Un score d'opportunité commun** (Ads winners / push, réallocations, clients à développer, surstock à
   écouler, contenus éprouvés).
10. **Attendu vs réalisé** : à l'approbation, fixer une métrique, une valeur attendue et un horizon ; à
    l'horizon, mesurer avec la fonction officielle (patron `compareSales()`), enregistrer l'écart ; calibrer la
    confiance par règle.
11. **What-if** : simulations sur les fonctions officielles (réallocation, commande, objectif), sans nouvelle
    formule.
12. **Exécution contrôlée** : approuver → tâche (existe) + notification (existe) + envoi du brief hors
    application (prévu, non fait) ; intégrations externes en écriture **exclues** aujourd'hui par doctrine
    (Meta lecture seule, Sage jamais écrit) — à décider explicitement en phase 5.

Ce qui **ne manque pas** et ne doit pas être refait : les règles métier, les moteurs Ads et analytics, la
couverture de stock, l'intelligence client, le format WHY / DATA / ACTION / CONFIANCE, la création de tâche,
les notifications, l'Event Engine, le copilote et ses outils, la page Ads Command Center comme modèle d'UI.

---

## 7. Architecture cible proposée

```
                       ┌──────────────────────────────────────────────┐
                       │  COMANET TODAY  (/)                          │
                       │  changé · préoccupant · probable · opportunités · 5 décisions
                       │  drawers : preuve, historique, plan, approuver / refuser / reporter
                       └───────────────▲──────────────────────────────┘
                                       │ lit UNE charge utile (comme buildCommandCenter)
┌──────────────────────────────────────┴───────────────────────────────────────────┐
│  src/lib/decisions/   (nouveau, pur, testé sans base)                             │
│   types.ts       Decision { key, domain, kind, title, why, evidence[], impact,     │
│                            confidence, action, approve, entity, brandId, engine } │
│   adapters/      rules→Decision · adsIntel→Decision · analytics→Decision          │
│   confidence.ts  confiance générique (volume, fraîcheur, complétude, comparable)  │
│   evidence.ts    preuve typée : metricKey + période + source + attribution        │
│   select.ts      les 5 décisions : dédoublonnage par entité, diversité, seuils    │
│   changes.ts     diff entre deux photos (décisions + KPI) → « ce qui a changé »   │
│   upcoming.ts    signaux datés existants (rupture, commande théorique, échéances, │
│                  fin de mois, budget projeté) → « ce qui va probablement arriver » │
│   opportunities.ts  score commun (phase 2)                                         │
│   store.ts       persistance : decisions, decision_reviews, kpi_snapshots          │
└──────▲───────────────────▲──────────────────────▲──────────────────────▲──────────┘
       │                   │                      │                      │
 src/lib/rules/     src/lib/ads-intel/    src/lib/analytics-marketing/   src/lib/{stock,clients,…}
 (24 règles, tel quel)  (tel quel)              (tel quel)               (fonctions officielles)
       │
 src/lib/events/  ─ nouveaux types : SALES_IMPORTED, STOCK_IMPORTED, META_SYNCED, TASK_COMPLETED,
                    DECISION_APPROVED / REJECTED / DEFERRED ; handler « photo + sélection »
 /api/cron/decisions (07:00, après analytics) ─ photo quotidienne, expiration, mesure à l'horizon (phase 4)
 src/lib/ai/tools/decisions.ts ─ get_decisions, explain_decision ; le brief lit les décisions retenues
```

Principes non négociables, hérités du dépôt :

- **Les moteurs existants restent la seule source des diagnostics.** `src/lib/decisions/` adapte, sélectionne,
  persiste et explique ; il ne recalcule aucune notion (le test `definitions-uniques` s'étend à ce dossier).
- **Déterministe d'abord.** Les cinq blocs se construisent sans appel au modèle ; le LLM n'intervient que pour
  la narration (« Expliquer », « Détailler », brief) — il lit les décisions, il ne les produit pas.
- **Approuver = créer la tâche** (mécanisme actuel) ; la décision est l'objet de gouvernance, la tâche l'objet
  d'exécution. Pas de second système de tâches.
- **Une donnée manquante s'affiche « non mesurable »** et baisse la confiance ; elle n'est jamais estimée.
- **Seuils dans `settings.decisions`** (nombre de décisions, confiance minimale, horizons par type, fenêtres
  d'anomalie), page Paramètres dédiée.

---

## 8. Tables et services à ajouter

### Tables (migrations à journaliser dans `drizzle/meta/_journal.json`)

| Table | Rôle | Phase |
|---|---|---|
| `decisions` | une ligne par décision **stable** (`key` unique = clé du moteur d'origine) : `engine`, `rule_id`, `domain`, `kind` (RISK / OPPORTUNITY / ACTION / DO_NOTHING), `title`, `priority`, `confidence`, `impact_kind`, `impact_value`, `payload` (why, evidence, action, liens — jsonb), `entity_type` / `entity_id`, `brand_id`, `status` (OPEN / APPROVED / REJECTED / DEFERRED / EXPIRED / RESOLVED), `first_seen_at`, `last_seen_at`, `resolved_at`, `task_id` | 1 |
| `decision_reviews` | chaque geste humain : `decision_id`, `user_id`, `action` (APPROVE / REJECT / DEFER / REOPEN), `reason`, `defer_until`, `created_at` — c'est la **mémoire des décisions** | 1 |
| `kpi_snapshots` | photo quotidienne `(day, scope_type, scope_id, metric_key, value, period_start, period_end, source)` ; sert aux deltas et aux anomalies hors Ads | 1 |
| `decision_outcomes` | attendu vs réalisé : `decision_id`, `metric_key`, `expected_value`, `horizon_date`, `actual_value`, `measured_at`, `verdict` (BETTER / AS_EXPECTED / WORSE / NOT_MEASURABLE) | 4 |
| `forecasts` | projections nommées : `(day, scope, metric_key, horizon, value, low, high, method, confidence)` | 2 |
| `decision_calibration` (ou `settings.decisions.calibration`) | taux de réussite par règle → ajustement de la confiance affichée | 4 |

Rien d'autre : anomalies et opportunités sont des **décisions** de `kind` ANOMALY / OPPORTUNITY, pas des
tables séparées. `events` est étendu par de nouveaux types, pas dupliqué. `audit_logs` (existe, 0 ligne)
reçoit les approbations en phase 5.

### Services (fichiers)

| Fichier | Contenu | Phase |
|---|---|---|
| `src/lib/decisions/types.ts`, `adapters/*.ts`, `confidence.ts`, `evidence.ts`, `select.ts`, `store.ts` | contrat, adaptateurs, confiance générique, preuves typées, sélection, persistance | 1 |
| `src/lib/decisions/changes.ts`, `upcoming.ts`, `today.ts` (`buildToday()` = charge utile unique de l'écran) | blocs 1, 3 et orchestration | 1 |
| `src/lib/events/emit.ts` + `dispatch.ts` | types `SALES_IMPORTED`, `STOCK_IMPORTED`, `META_SYNCED`, `TASK_COMPLETED`, `DECISION_*` ; handler photo | 1 |
| `src/app/api/cron/decisions/route.ts` + `vercel.json` | photo quotidienne 07:00 | 1 |
| `src/app/(app)/page.tsx` → COMANET TODAY ; `src/components/today/*` (drawers) ; `src/app/(app)/parametres/decisions/page.tsx` | écran et réglages | 1 |
| `src/lib/ai/tools/decisions.ts` ; brief : « appelle d'abord get_decisions » | copilote aligné sur l'écran | 1 |
| `src/lib/decisions/anomalies.ts` (généralise `zScores()`), `opportunities.ts`, `forecast.ts` | phase 2 | 2 |
| `src/lib/decisions/whatif.ts` + outils `simulate_*` ; surface « Stratégie » du copilote | phase 3 | 3 |
| `src/lib/decisions/outcomes.ts` (patron `compareSales()`), `calibration.ts` ; cron mesure à l'horizon | phase 4 | 4 |
| `src/lib/decisions/execute.ts` (approbation → tâche + notification + journal d'audit), envoi du brief (e-mail / WhatsApp), intégrations à décider | phase 5 | 5 |
| `tests/decisions/*.test.ts` | adaptateurs, sélection, diff, confiance, sans base | chaque phase |

---

## 9. Risques

| Risque | Gravité | Parade |
|---|---|---|
| **Données incomplètes** (stock 2 photos, animations sans marque ni coût, 6 marques sans budget, Meta 30 jours d'API) → décisions à faible confiance ou blocs vides | Élevée | La confiance et « non mesurable » sont dans le contrat dès la phase 1 ; l'écran dit ce qu'il faudrait importer (état vide utile, comme `/marketing/ads`) ; le chantier data en cours (import stock hebdo, budgets, animations) est un prérequis de la phase 2, pas de la phase 1 |
| **Doublons entre moteurs** (`ads-performance` et `topActions()` sur la même campagne ; `stock-coverage` et véto stock dans les recommandations Ads) | Moyenne | Dédoublonnage par `entity` dans `select.ts`, avec fusion des preuves ; test dédié |
| **Collision de types** `Recommendation` (règles) / `Recommendation` (Ads) | Moyenne | Adaptateurs explicites ; aucun `import` croisé entre `rules/` et `ads-intel/` dans `decisions/` |
| **Coût d'évaluation** : tout recalculer à chaque page + une photo par jour | Moyenne | L'écran lit la photo du jour et ne recalcule qu'à la demande (« Actualiser ») ; le cron tient dans `maxDuration` (l'Action Center complet tourne aujourd'hui en quelques secondes) |
| **Prévisions peu crédibles** : 20 mois de sell-in = un seul cycle saisonnier ; Ramadan, été, rentrée non isolables | Élevée pour la phase 2 | Méthodes simples et nommées (rythme, même mois N-1, moyenne mobile), bornes basses/hautes, confiance faible affichée ; « projection », jamais « prévision fiable » |
| **Dérive vers l'attribution** : un « impact » chiffré peut être lu comme une causalité | Élevée (exigence explicite) | `impact.basis` obligatoire (MESURÉ / EXTRAPOLÉ / CORRÉLATION) et affiché ; les outcomes comparent des fenêtres, pas des causes |
| **Coût et limites LLM** (`monthlyCostAlertUsd` 100) | Faible | Le Command Center est déterministe ; le modèle n'écrit que sur demande |
| **Écriture vers l'extérieur en phase 5** (Meta, e-mail, Sage) | Élevée | Hors périmètre tant qu'Hicham n'a pas levé la doctrine « lecture seule » ; chaque intégration = décision explicite, journal `audit_logs`, confirmation humaine |
| **Chantiers parallèles** : un import « Influenceuses » non commité est présent dans le dossier de travail ; le chantier data est en cours | Moyenne | Une branche `feat/command-center` depuis `main`, phases livrées en PR courtes, migrations journalisées |
| **Refaire l'existant** | Élevée (consigne explicite) | Règle du §7 : `decisions/` adapte et ne recalcule pas ; `definitions-uniques` étendu ; revue de chaque PR contre ce document |

---

## 10. Roadmap priorisée

Les cinq phases demandées, recalées sur ce qui existe. Chaque phase se livre en étapes courtes, testables
sans base, validées une par une (même méthode que le copilote et l'analytics).

### Phase 1 — AI Command Center · Decision Engine · Why Engine · pont avec le Rule Engine

| # | Étape | Fichiers / tables | Ce qu'Hicham vérifie |
|---|---|---|---|
| 1.1 | Contrat `Decision` + adaptateur **règles** (24 règles → décisions, confiance générique, preuves typées depuis `facts` + `metrics_definitions`) | `decisions/types.ts`, `adapters/rules.ts`, `confidence.ts`, `evidence.ts`, tests | L'Action Center affiche une confiance et des preuves typées, mêmes cartes |
| 1.2 | Adaptateurs **Ads** et **analytics** ; dédoublonnage par entité | `adapters/ads-intel.ts`, `adapters/analytics.ts`, `select.ts` | Une campagne n'apparaît qu'une fois ; « ne rien faire » possible |
| 1.3 | Persistance : `decisions`, `decision_reviews`, `kpi_snapshots` ; `store.ts` ; approuver (→ tâche, mécanisme actuel), refuser (motif), reporter | migration 0021 + journal, `store.ts`, server actions | Une décision refusée ne revient pas le lendemain ; l'historique est lisible |
| 1.4 | Photo quotidienne : cron 07:00, événements `SALES_IMPORTED` / `STOCK_IMPORTED` / `META_SYNCED` / `TASK_COMPLETED` → handler photo ; `changes.ts` | `events/`, `api/cron/decisions`, `changes.ts` | Bloc « ce qui a changé » déterministe, daté, avec deux horloges |
| 1.5 | `upcoming.ts` : signaux datés existants (rupture estimée, commande théorique, échéances DMP, fin de mois au rythme, budget Ads projeté, retards contenus / activations) | `upcoming.ts` | Bloc « ce qui va probablement arriver », chaque ligne avec sa date et sa source |
| 1.6 | Écran COMANET TODAY : 5 blocs, drawers (preuve, historique, plan « Détailler », approuver / refuser / reporter), `/actions` et `/marketing/ads` inchangés ; `settings.decisions` + Paramètres | `page.tsx`, `components/today/*`, `parametres/decisions` | Le matin : 5 décisions WHY → EVIDENCE → IMPACT → CONFIDENCE → APPROVE |
| 1.7 | Copilote : `get_decisions`, `explain_decision` ; le brief lit les décisions retenues | `ai/tools/decisions.ts`, `brief.ts` | Le brief et l'écran disent la même chose |

Livrable de phase : les blocs 1, 2, 4 (opportunités existantes seulement), 5 complets ; bloc 3 alimenté par
les signaux existants. Prérequis data : budgets rejoués (import réparé), rien d'autre.

### Phase 2 — Anomaly Detection · Opportunity Scores · Forecasting

| # | Étape | Réutilise |
|---|---|---|
| 2.1 | Anomalies sur `kpi_snapshots` et séries journalières sell-in / sell-out / stock (marque, client, produit) → décisions `ANOMALY` | `zScores()`, `trendOf()`, `stabilityOf()` |
| 2.2 | Score d'opportunité commun (winners, push, réallocation, clients DÉVELOPPEMENT / fort potentiel, surstock à écouler, motifs de contenu) → décisions `OPPORTUNITY` | `push`, `reallocationsFrom()`, `clientIntel()`, `isOverstock()`, `patternsOf()` |
| 2.3 | Projections v1 : fin de mois et fin d'année par marque (rythme, même mois N-1), rupture avec commande en cours et délai, retard client probable (dérive d'intervalle), dépense régie ; table `forecasts`, bornes, confiance | `monthProjection()`, `computeCoverage()`, `nextTheoretical` |

Prérequis data : import stock hebdomadaire en place (≥ 8 photos), animations avec marque et coût.

### Phase 3 — What-If Engine · Strategy Copilot

| # | Étape | Réutilise |
|---|---|---|
| 3.1 | Simulations sur fonctions officielles : réallouer X MAD (extrapolation au coût constaté, déjà dans `reallocation.ts`), commander N unités (`computeCoverage()`), viser un objectif (écart au rythme) ; résultats bornés et nommés « extrapolation » | `reallocation.ts`, `stock-math.ts`, `analytics.ts` |
| 3.2 | Outils `simulate_reallocation`, `simulate_order`, `simulate_objective` ; surface « Stratégie » du copilote (modèle avancé) qui compare des scénarios sans inventer de chiffre | `ai/tools/`, `service.ts` |

### Phase 4 — Decision Memory · Expected vs Actual · Learning Loop

| # | Étape | Réutilise |
|---|---|---|
| 4.1 | À l'approbation : métrique, valeur attendue, horizon par type de décision (`settings.decisions.horizons`) → `decision_outcomes` | `impact` typé de la phase 1 |
| 4.2 | Cron : à l'horizon, mesure avec la fonction officielle, verdict, « pas encore comparable » si fenêtre incomplète | patron `compareSales()` |
| 4.3 | Calibration : taux de réussite par règle et par type → confiance affichée ajustée, visible dans Paramètres ; mémoire lisible (« les relances de clients en retard ont été suivies d'une commande dans 62 % des cas ») | `ad_memory` comme modèle de phrase + preuve |

### Phase 5 — Controlled Execution · automatisations · intégrations

| # | Étape | Décision préalable d'Hicham |
|---|---|---|
| 5.1 | Approbation → tâche + notification + `audit_logs` ; envoi du brief et des 5 décisions hors application (e-mail, WhatsApp) depuis le cache existant | canal d'envoi |
| 5.2 | Automatisations sous confirmation : proposition de commande fournisseur (brouillon), rappel client au commercial, tâche réglementaire (existe déjà : `ensureRegulatoryTasks()`) | ce qui peut partir sans clic |
| 5.3 | Intégrations externes en écriture (régie, ERP) | **levée explicite** de la doctrine lecture seule ; sinon hors périmètre |

---

## Décisions prises par défaut (à contredire si besoin)

1. Le Command Center remplace la page `/` (Cockpit) ; les cartes KPI actuelles passent dans un drawer
   « Chiffres du jour » ; `/actions` reste la liste complète.
2. Approuver = créer la tâche (mécanisme actuel), rien de plus en phase 1.
3. Cinq décisions par défaut (`settings.decisions.max`), confiance minimale 35 (même seuil que
   `topActions()`), au plus deux par domaine.
4. Deux horloges conservées : les deltas sell-in se calent sur la date de référence des ventes, tout le reste
   sur la date réelle.
5. Aucun appel au modèle dans la construction des cinq blocs.

## Questions ouvertes

1. Les étapes 1 à 18 du brief n'ont pas été reçues dans cette session (seules l'étape 19 et la consigne
   finale l'ont été) : si elles contiennent des contraintes d'écran ou de périmètre, les coller avant la
   phase 1.
2. Qui, en dehors des administrateurs, voit les cinq décisions ? Proposition : la sélection est filtrée par
   la matrice comme l'Action Center (chacun voit ses domaines), les administrateurs voient tout.
3. Faut-il une décision « DO_NOTHING » visible quand tout va bien, comme sur la page Ads ? Proposition : oui,
   c'est une information de direction.
