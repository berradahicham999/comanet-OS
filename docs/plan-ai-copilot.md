# Copilote IA — plan d'implémentation

Branche `feat/ai-copilot`, créée depuis `main` (après fusion de `feat/activations` et `feat/analytics-decision`).
Ce document est l'étape 1 des livrables : il attend la validation d'Hicham avant tout code.

## 1. Ce qui existe déjà et qu'on réutilise

| Besoin du copilote | Déjà dans le code | Décision |
|---|---|---|
| Format Donnée / Analyse / Hypothèse / Recommandation | bloc « Poser une question » de `/marketing/analytics` (`src/lib/analytics-marketing/ask.ts`, sans LLM) | Le copilote garde le même rendu visuel (composant partagé) ; le bloc sans LLM reste en place, le copilote ne le remplace pas. |
| Chiffres officiels | `sellout.ts`, `stock-math.ts`, `budget.ts`, `ad-spend.ts`, `ads.ts`, `clients.ts` (`clientIntel`), `regulatory.ts`, `analytics.ts`, `animations.ts`, `rules/` | Chaque outil IA **appelle** ces fonctions. Aucune formule recalculée dans `lib/ai/`. `tests/definitions-uniques.test.ts` continue de l'imposer. |
| Droits | `permissions.ts` (`getAccess`, `can`, `brandFilter`, `clientFilter`, `isOwnOnly`) | Chaque outil déclare son module et son action ; le service filtre la liste d'outils **avant** de l'envoyer au modèle. |
| Tâches | table `tasks`, `createTaskFromRecommendation` | Un nouveau statut `PROPOSED` et une nouvelle source `AI`. Pas de seconde table de tâches. |
| Rapports | clé de module `rapports` (existe déjà dans la matrice, aucun écran ne l'utilise) | Les brouillons de rapport vivent sous ce module : Voir = lire, Créer = générer, Valider = valider un brouillon. |
| Notifications | table `notifications`, `content/notify.ts` | « Le copilote a proposé une tâche » et « un rapport attend votre validation » passent par là. |
| Seuils | `settings` (`comanet.rules`) | Les limites (requêtes/heure, budget tokens/jour, modèles) vivent dans `settings.ai`, modifiables dans `/parametres/ia`. |
| Recherche universelle | `/recherche` | `search_entities` réutilise la requête de cette page (à extraire dans `src/lib/search.ts`). |

## 2. Choix techniques

- **SDK** : `@anthropic-ai/sdk` directement, boucle d'outils écrite à la main (pas le Tool Runner bêta). Raisons : plafond de 8 appels, timeout 60 s, journalisation par appel, filtrage par permissions et streaming vers l'UI sont plus simples à garantir dans une boucle qu'on contrôle. `client.messages.stream()` pour le streaming ; les deltas texte sont renvoyés au navigateur en SSE depuis un route handler `src/app/api/ai/chat/route.ts` (les server actions ne streament pas).
- **Schémas d'outils** : Zod 4 (déjà installé) + `z.toJSONSchema()` pour produire l'`input_schema`. Chaque outil = `{ name, description, module, action, schema, run(input, ctx) }`.
- **Modèles** (à confirmer, question A) : rapide `claude-sonnet-5` (résumés de cartes, « Expliquer », brief), avancé `claude-opus-5` (questions libres, « Détailler », rapports). Variables `AI_MODEL_FAST` et `AI_MODEL_ADVANCED`, avec ces valeurs par défaut. Réflexion adaptative (comportement par défaut sur ces modèles) avec `effort: "low"` sur les surfaces rapides, `"medium"` sur les analyses libres.
- **Prompt caching** : le system prompt est envoyé en deux blocs — le bloc stable (rôle, contexte métier, principes, format) porte `cache_control: { type: "ephemeral" }` ; la date du jour, l'utilisateur et le contexte de page arrivent **après**, dans un second bloc non mis en cache. La liste d'outils est triée par nom pour rester stable.
- **Injection de prompt** : les résultats d'outils sont du JSON compact passé en `tool_result` ; le system prompt dit explicitement que noms de clients, commentaires et briefs sont des données. Aucun contenu de la base n'est jamais concaténé dans le system prompt.
- **Sans clé** : `isAiConfigured()` lit `ANTHROPIC_API_KEY` ; toutes les surfaces affichent un état « Copilote non configuré » avec le nom de la variable à renseigner. Aucun import du SDK n'échoue au démarrage.
- **Sécurité** : tout côté serveur (`server-only`), la clé ne quitte jamais le processus. Rate limit = comptage des `ai_messages` de l'utilisateur sur l'heure écoulée ; budget quotidien = somme des tokens du jour toutes surfaces confondues. Les deux seuils dans `settings.ai`.
- **Écritures autorisées** : `ai_conversations`, `ai_messages`, `ai_tool_calls`, `ai_cache`, `ai_action_plans`, `ai_reports`, et une insertion dans `tasks` avec `status = 'PROPOSED'`. Rien d'autre. Un test grep interdit tout `insert`/`update` sur une autre table depuis `src/lib/ai/`.

## 3. Migration `0018_ai_copilot.sql` (à ajouter au journal)

```
ALTER TYPE task_status ADD VALUE 'PROPOSED';       -- tâche proposée par l'IA, à accepter d'un clic
ALTER TYPE task_source ADD VALUE 'AI';

ai_conversations  id, user_id, title, context_module, context_path, created_at, updated_at
ai_messages       id, conversation_id, role (user|assistant), content, tool_calls jsonb,
                  tokens_in, tokens_out, cache_read_tokens, model, latency_ms, surface, created_at
ai_tool_calls     id, message_id, user_id, tool, params jsonb, duration_ms, row_count, error, created_at
ai_cache          key (pk), surface, content, model, tokens_in, tokens_out, expires_at, created_at
                  -- « Expliquer » (1 h par combinaison de filtres) et brief du matin (1 jour par utilisateur)
ai_action_plans   rec_key (pk), content_md, model, created_by, created_at, updated_at
                  -- plan d'exécution stocké sur une recommandation de l'Action Center
ai_reports        id, type (WEEKLY|MONTHLY_BRAND_REVIEW), brand_id, period_start, period_end,
                  title, content_md, sources jsonb, status (DRAFT|VALIDATED|ARCHIVED),
                  created_by, validated_by, validated_at, created_at
```

Conséquences dans le code existant : `listTasks()` et la détection « tâche ouverte existante » des règles ignorent `PROPOSED` ; la page `/taches` gagne un onglet « Proposées par le copilote » avec Accepter (→ `TODO`) / Refuser (→ `CANCELLED`).

## 4. Couche outils `src/lib/ai/tools/`

Un fichier par outil, tous enregistrés dans `index.ts`. Chaque outil reçoit un `ToolContext` (`access`, `refDate`, `now`, `settings`, `deps`) où `deps` regroupe les fonctions de requête **injectables** : les tests unitaires passent des mocks, aucune base requise.

| Outil | Module / action | S'appuie sur | Résultat compact |
|---|---|---|---|
| `get_sales_summary` | ventes / view | `analytics.ts` (`totals`, `byDim`, `compareMonth`, `objectiveFor`) | CA HT sell-in, volumes, clients actifs, variation, top 10 marques ou produits ou villes |
| `get_client_intelligence` | clients / view | `clientIntel()`, `segmentCounts()` | comptes par segment, top N clients demandés, dernier achat, CA 12 mois, tendance |
| `get_terrain_summary` | terrain / view | `animations.ts`, `sellout.ts`, objectifs par ville | sell-out TTC, jours, atteinte objectif, palmarès produits, animatrices sous objectif |
| `get_stock_coverage` | stock / view | `productStocks()`, `computeCoverage()`, `isUnderTension()` | couverture par référence, niveau, ruptures prévisibles, commande conseillée |
| `get_marketing_budget` | budgets / view | `budgetConsumption()`, `budgetConsumptionByBrand()` | prévu / engagé / dépensé / restant par catégorie et par marque |
| `get_ads_performance` | marketing / view | `adsByDim()`, `kpis()`, `diagnose()` | dépense MAD, résultats, coût par résultat, verdict SCALE / OPTIMIZE / STOP |
| `get_regulatory_alerts` | reglementaire / view | `situationOf()`, `daysUntil()` | dossiers à échéance, situation, jours restants |
| `get_action_center` | any (filtré par module) | `getRecommendations()` | recommandations ouvertes : règle, pourquoi, quoi faire, enjeu |
| `get_tasks` | taches / view | `listTasks()` | tâches par assigné et statut, retards |
| `search_entities` | any | `src/lib/search.ts` (extrait de `/recherche`) | marque, produit, client, POS, animatrice → id + lien |
| `propose_task` | taches / create | insert `tasks` (`PROPOSED`, source `AI`) | id de la tâche proposée |
| `propose_report` | rapports / create | insert `ai_reports` (`DRAFT`) | id du brouillon |

Règles communes : portée `brandFilter()` / `clientFilter()` / `isOwnOnly()` appliquée dans chaque outil ; limite de 50 lignes ; chaque résultat porte `period`, `scope` et `source` (« Sage sell-in HT » ou « animatrices sell-out TTC ») pour que le modèle les cite ; donnée absente → `{ available: false, reason, howToFix }`. Journalisation dans `ai_tool_calls`.

## 5. Service `src/lib/ai/`

```
client.ts        isAiConfigured(), client Anthropic, modèles depuis l'env
prompts/copilot.md   system prompt versionné (rôle, marques, sell-in/sell-out, ATD/CE/CVL, objectifs animation, format)
prompts/load.ts  lecture du .md, injection date/utilisateur/contexte dans un second bloc
run.ts           boucle agentique : max 8 appels, timeout 60 s, streaming, journalisation, calcul du coût
limits.ts        rate limit par utilisateur, budget tokens/jour (settings.ai)
conversations.ts CRUD ai_conversations / ai_messages
explain.ts       « Expliquer » une carte (cache 1 h, modèle rapide)
brief.ts         brief du matin (cache 1 jour par utilisateur, modèle rapide)
plans.ts         « Détailler » une recommandation (ai_action_plans, modèle avancé)
reports.ts       COMANET WEEKLY et MONTHLY BRAND REVIEW (ai_reports, modèle avancé)
suggestions.ts   questions suggérées par chemin de page
cost.ts          grille de prix par modèle (constante versionnée) → coût estimé en USD
```

## 6. Surfaces UI

| Surface | Fichiers | Étape |
|---|---|---|
| Panneau global | `src/components/ai/copilot-panel.tsx` (client, SSE), bouton dans `shell/app-shell.tsx`, raccourci ⌘K, historique | 3 |
| Rendu 4 blocs | `src/components/ai/answer-blocks.tsx`, partagé avec le bloc sans LLM | 3 |
| « Expliquer » ✦ | `src/components/ai/explain-button.tsx`, ajouté aux `KpiCard` du cockpit et aux graphiques | 4 |
| Brief du matin | `src/components/ai/morning-brief.tsx` en haut de `/` pour les administrateurs, boutons « Créer la tâche » | 5 |
| Action Center | bouton « Détailler » sur `recommendation-card.tsx`, plan affiché sous la carte | 6 |
| Tâches proposées | onglet dans `/taches`, Accepter / Refuser | 6 |
| Rapports | `/rapports` (liste, brouillon, valider, exporter en Markdown / impression) | 7 |
| Admin | `/parametres/ia` : coûts par jour / utilisateur / surface, modèles, limites | 8 |

Routes : `src/app/api/ai/chat/route.ts` (SSE), les autres surfaces via server actions dans `src/app/(app)/ai-actions.ts`.

## 7. Tests `tests/ai/`

- `tools.test.ts` : chaque outil avec `deps` mockées — filtrage par permissions (un utilisateur sans `ventes` ne voit pas `get_sales_summary`), portée marques, limite de lignes, donnée absente → `available: false`.
- `run.test.ts` : boucle agentique avec un client Anthropic factice — arrêt à 8 appels, timeout, journalisation, refus d'un outil hors liste.
- `guardrails.test.ts` : jeu de 15 à 20 questions de référence (une par outil + pièges : chiffre inexistant, hors permissions, tentative d'écriture Sage) ; assertions sur la présence des quatre blocs et sur l'absence de tout nombre non issu d'un `tool_result` (extraction des nombres de la réponse, comparaison avec les nombres retournés par les outils).
- `read-only.test.ts` : grep sur `src/lib/ai/` — aucune écriture hors des tables autorisées.
- `integration.test.ts` : appel réel, activé uniquement par `RUN_AI_INTEGRATION=1`.

## 8. Variables d'environnement

```
ANTHROPIC_API_KEY=            # absente → copilote « non configuré », application inchangée
AI_MODEL_FAST=claude-sonnet-5
AI_MODEL_ADVANCED=claude-opus-5
```

Les limites (requêtes/heure, tokens/jour, plafond mensuel d'alerte) sont dans `settings.ai`, pas en variables d'env.

## 9. Questions à trancher avant l'étape 2

**A. Modèles et plafond.** Proposition : `claude-sonnet-5` en rapide, `claude-opus-5` en avancé. Plafond d'alerte mensuel proposé : 100 USD (affiché dans `/parametres/ia`, bloque les surfaces automatiques au-delà, jamais les questions manuelles d'un administrateur). À confirmer ou modifier.

**B. Brief du matin.** Proposition : in-app uniquement en V1 ; la table `ai_cache` conserve le brief du jour, donc un envoi e-mail ou WhatsApp pourra le relire plus tard sans le régénérer. À confirmer.

**C. Animatrices.** Proposition : le copilote apparaît pour tout compte ayant au moins un module visible **hors** portée OWN (`isOwnOnly()`), ce qui exclut les animatrices et les délégués en V1 sans toucher à `users.role` (interdit par les règles du projet). À confirmer.

**D. Tâche proposée.** Proposition : nouveau statut `PROPOSED` sur la table `tasks` existante plutôt qu'une table à part. Une tâche proposée n'apparaît ni dans les compteurs ni dans les retards tant qu'elle n'est pas acceptée. À confirmer.
