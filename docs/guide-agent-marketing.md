# Agent marketing — guide de lecture

L'Agent marketing est le Copilote IA de COMANET OS avec la persona « Directeur Marketing & Croissance » et
dix outils de lecture supplémentaires. Il ne raisonne plus sur un contexte écrit à la main : ventes, stock,
objectifs, marge, activité marketing et Ads sont **lus dans la base au moment de la question**, filtrés et
agrégés côté serveur, puis rendus au modèle en quelques dizaines de lignes. Il recommande ; la personne valide.

```
UTILISATEUR
   ↓  (⌘K, page /marketing/agent, ou sous-agent Claude Code via `npm run agent:tool`)
AGENT MARKETING  (src/lib/ai/prompts/marketing-agent.md + copilot.md)
   ↓  appels d'outils typés, filtrés par la matrice de droits, journalisés dans ai_tool_calls
OUTILS MARKETING  (src/lib/ai/tools/marketing-*.ts)
   ↓
COUCHE MARKETING INTELLIGENCE  (src/lib/marketing-intel/ — pure, testée sans base)
   ↓  MarketingIntelDeps
FONCTIONS OFFICIELLES  (analytics.ts, stock.ts / stock-math.ts, products.ts, budget.ts, ads.ts, ads-intel)
   ↓
POSTGRES  (sales, stock_snapshots, products, brands, objectives, campaigns, content_items, collaborations, activations, ad_metrics, budgets)
```

## Les règles à garder en tête

1. **Aucune seconde source de vérité.** La couche `marketing-intel` ne recalcule rien : couverture, tension et
   surstock viennent de `stock-math.ts`, le CA de `analytics.ts`, le budget de `budget.ts`, les verdicts Ads de
   `ads.ts`. Elle traduit ces notions dans le vocabulaire de l'agent (jours de couverture, CRITICAL / LOW /
   HEALTHY / OVERSTOCK, STAR / GROWTH / CASH_COW…) et les croise.
2. **Quatre niveaux de fiabilité, toujours nommés.** Chaque valeur est CONFIRMED (lue : stock à la dernière
   photo, CA facturé, objectif saisi), CALCULATED (formule officielle : couverture, croissance, contribution,
   run-rate), INFERRED (interprétation : catégorie, décision) ou MISSING (absente). Une donnée manquante est
   dite manquante ; elle n'est jamais estimée ni remplacée par 0. « Les ventes e-commerce baissent » est
   interdit si aucun outil n'a renvoyé de canal e-commerce.
3. **Jamais sur les ventes seules.** Le moteur de décision croise ventes × stock × marge × Ads :
   ventes ↑ + stock faible → RESTOCK ; ventes ↓ + stock élevé → CREATE_PROMOTION / FOCUS_SELL_OUT ;
   ventes ↑ + stock élevé → PUSH ; ventes ↓ + stock faible → DO_NOT_PROMOTE (diagnostiquer) ;
   marge faible + Ads performantes → OPTIMIZE, jamais de scale automatique.
4. **Lecture seule.** Aucun outil de l'agent n'écrit ; les seules écritures du copilote restent `propose_task`
   et `propose_report`. Rien vers Meta, Sage, le stock ou les ventes.
5. **Fraîcheur annoncée.** Chaque réponse rappelle « données de vente à jour au … » (dernier import Sage,
   retard en jours) et la date de la photo de stock.

## Les outils

| Outil | Ce qu'il renvoie | Module requis |
|---|---|---|
| `get_brand_overview` | CA, unités, croissance, objectif du mois et de l'année (%, écart, projection), marge pondérée, stock (unités, valeur, couverture moyenne, statuts, seuils en jours), top produits, risques, surstock, activité marketing, budget, Ads 30 j, fraîcheur | Ventes (stock, budgets, marketing, coûts internes selon droits) |
| `get_sales_performance` | CA / unités / commandes / clients sur 7d, 30d, 90d, ytd, custom ; vs période précédente et N-1 ; par SKU, canal, client | Ventes |
| `get_sales_breakdown` | répartition par canal, client, région (secteur), type de client, commercial ; parts et croissances | Ventes |
| `get_sales_targets` | objectif mensuel et annuel, réalisé, %, écart, run-rate, rythme annuel | Ventes |
| `get_inventory_status` | par SKU : stock, en commande, vente moyenne jour / mois, ventes 30 j, dernière vente, jours de couverture, date de rupture, commande conseillée, statut | Stock |
| `get_stock_risk` | RUPTURE_RISQUE / SURSTOCK / HEALTHY / NO_ROTATION / UNKNOWN, seuils en jours, CA 30 j à risque | Stock |
| `get_top_skus` | top 10 par CA, unités, croissance ou marge, avec stock et catégorie | Ventes |
| `get_product_performance` | par produit : ventes, croissance, contribution, marge, historique 12 mois, tendance 3 mois, stock, catégorie | Ventes |
| `get_marketing_context` | campagnes (actives, planifiées, terminées), promotions, planning éditorial, influence, activations, objectifs de la fiche marque, budget consommé, Ads 30 j | Marketing |
| `get_marketing_recommendations` | décisions ACTION / POURQUOI / DONNÉES / IMPACT / CONFIANCE, liste « à ne pas pousser », écart à l'objectif | Ventes |

Seuils : `Paramètres → Règles & seuils → Agent marketing` (contribution STAR / CASH COW, CA minimal pour
classer, marge faible, nombre de recommandations). Les seuils de stock (couverture, tension, surstock) et de
croissance (Analytics marketing) sont ceux qui existaient déjà : rien n'est dupliqué.

## Catégories d'un produit

| Profil (ventes) | Définition |
|---|---|
| STAR | contribution ≥ seuil ET croissance ≥ seuil |
| GROWTH | croissance ≥ seuil, contribution sous le seuil |
| CASH_COW | contribution ≥ seuil, croissance sous le seuil |
| UNDERPERFORMER | baisse ≥ seuil |
| STABLE | le reste |
| INSUFFICIENT_DATA | CA sous le minimum sur la période et la précédente |

Le stock prime : STOCK_RISK (couverture critique ou tension) et OVERSTOCK remplacent le profil dans la catégorie
finale, parce qu'ils changent l'action. Sans période comparable, la croissance est « pas encore comparable » :
jamais STAR, GROWTH ni UNDERPERFORMER.

## Les surfaces

- **Page `/marketing/agent`** (module Marketing). Choix de la marque et de la période ; « Contexte métier
  actuel » (ventes, croissance, stock en jours, top SKU, produits à risque, objectif) calculé côté serveur avec
  la ligne « Données à jour : ventes au …, stock photo du … » ; « Recommandation » du moteur (priorités, à ne pas
  pousser, confiance, données étiquetées) sans appel au modèle ; tableau produits ; chat de l'agent avec la marque
  transmise automatiquement.
- **Panneau Copilote (⌘K)** : les mêmes outils sont disponibles partout ; sur `/marketing/agent`, les questions
  suggérées sont celles de l'agent.
- **Sous-agent Claude Code `comanet-marketing`** : lit les mêmes outils par `npm run agent:tool -- <outil>
  '<json>'` (lecture seule, `DATABASE_URL` de `.env.local`), et n'utilise plus de chiffres écrits en dur.

## Ce qui manque encore

- **Réassort** : le dernier réassort n'est pas suivi (`stock_snapshots` ne porte que des photos) — l'outil le dit.
- **Stock réservé / disponible** : aucune réservation n'est suivie ; disponible = stock.
- **Canaux consommateur** (e-commerce, dermatologues) : les canaux sont ceux facturés dans Sage ; un canal absent
  est absent, pas nul.
- **Marge** : uniquement quand prix d'achat et prix COMANET sont renseignés sur la fiche produit ; la couverture
  de la marge (% du CA) est affichée.
- **Objectifs** : mensuels ou annuels par marque ; aucun objectif produit ni marketing chiffré (la fiche marque
  porte un texte libre).
- **Prévision** : la projection fin de mois est un run-rate linéaire, nommé comme tel ; aucune prévision statistique.

## Pour les développeurs

- `src/lib/marketing-intel/` : `types.ts` (contrats, `MarketingIntelDeps`), `inventory.ts`, `performance.ts`,
  `targets.ts`, `decisions.ts` (purs), `build.ts` (orchestration à dépendances injectées), `gates.ts` (droits →
  portes), `queries.ts` (SQL : activité marketing), `server.ts` (câblage réel `realIntelDeps`, `intelContextFor`).
- `src/lib/ai/tools/marketing-*.ts` : schémas Zod, droits, mise en forme ; enregistrés dans `tools/index.ts`
  (`MARKETING_AGENT_TOOLS` donne l'ordre d'appel conseillé). `ToolDeps` étend `MarketingIntelDeps` : un seul câblage.
- `src/lib/ai/prompts/marketing-agent.md` (consigne de surface) + `src/lib/ai/marketing-agent.ts` ; la route
  `/api/ai/chat` accepte `agent: "marketing"`, `brand`, `period`.
- Tests : `tests/marketing-intel/engine.test.ts` (moteurs purs), `tests/ai/marketing-agent.test.ts` (les six
  scénarios avec doublures), `tests/ai/tools.test.ts` (registre, droits).
