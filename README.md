# COMANET OS — V1

Plateforme interne de pilotage stratégique, marketing et opérationnel de COMANET.
Couche d'intelligence, de recommandation et d'exécution **au-dessus de Sage** (Sage reste la source de vérité ; COMANET OS n'y écrit jamais).

```
DATA (imports Sage) → ANALYSE → INSIGHT → PLAN D'ACTION (Action Center) → EXÉCUTION (tâches) → MESURE
```

## Démarrage rapide

Prérequis : Node.js ≥ 20, PostgreSQL ≥ 14 (local ou Supabase).

```bash
npm install
cp .env.example .env          # DATABASE_URL, DATABASE_SSL, SESSION_SECRET
npm run db:push               # crée le schéma (ou : npm run db:migrate avec drizzle/0000_init.sql)
npm run db:seed:base          # utilisateurs, marques du portefeuille, paramètres
npm run db:import -- "/chemin/Compilé 2026 vf.xlsx" --reset   # charge le classeur (ventes 2024-2026, stock, objectifs, budgets)
npm run db:seed:demo          # (facultatif) terrain / réglementaire / tâches / contenus / campagnes fictifs, marqués [DÉMO]
npm run dev                   # http://localhost:3000
```

Comptes de démonstration (mot de passe `comanet2026`) : `hicham@comanet.ma` (Admin/DG), `samy@comanet.ma` (Admin), `nasr@comanet.ma`, `demzin@comanet.ma` (Marketing), `oumaima@comanet.ma` (Trade), `reglementaire@comanet.ma`, `animatrice@comanet.ma`. **Changez les mots de passe dans Paramètres → Utilisateurs avant toute mise en production.**

### En ligne (Supabase + Vercel)

Voir **[DEPLOY.md](DEPLOY.md)** : création du projet Supabase (PostgreSQL, Paris), dépôt GitHub, projet Vercel avec les
variables `DATABASE_URL` (Transaction pooler, port 6543), `DATABASE_SSL=true`, `SESSION_SECRET`, `SETUP_KEY`.
La base se crée ensuite **depuis le navigateur** sur `https://<votre-url>/installation` : connexion → schéma
(migrations) → socle (utilisateurs, marques, paramètres) → chargement du classeur compilé. Aucun outil à installer
sur un ordinateur ; les mises à jour se déploient automatiquement à chaque push sur GitHub, et les nouvelles
migrations s'appliquent depuis la même page.

Les fichiers importés transitent par la base (table `import_files`, envoi par morceaux de 1,5 Mo pour respecter la
limite de 4,5 Mo par requête des hébergeurs serverless) : aucun disque persistant n'est nécessaire.
`/api/health` sert de sonde de disponibilité.

## Modules V1

| Module | Écran | Ce qu'il fait |
|---|---|---|
| Cockpit DG | `/` | COMANET TODAY : CA du mois vs objectif / M-1 / N-1, YTD, activité, par marque, 13 mois vs N-1, blocs marketing · terrain · digital · réglementaire · stock, actions prioritaires, produits à risque |
| Action Center | `/actions` | Recommandations générées par le moteur de règles (WHY → WHAT TO DO → impact), filtrables, transformables en tâche assignée en un clic |
| Ventes | `/ventes` | CA par période (mois, trimestre, YTD, 30/90 j, 12 mois, personnalisé) × marque / produit / client / ville / canal / commercial / type client, vs période précédente et N-1 |
| Clients | `/clients`, `/clients/[id]` | Customer Intelligence : segments automatiques (croissance / stable / à risque / inactif / nouveau / ⭐ fort potentiel), rythme de commande, prochaine commande théorique, plan d'action par client, produits achetés, historique, animations, tâches |
| Produits | `/produits`, `/produits/[id]` | Bibliothèque (prix, lead time, MOQ, fiche marketing), ventes, stock & purchase forecast, top clients, réglementaire, contenus, tâches, alias, **fusion de doublons** |
| Marques | `/marques`, `/marques/[id]` | Portefeuille, objectifs, budget, stratégie marketing, produits, top clients/villes, actions de la marque |
| Stock & achats | `/stock` | Couverture (🟢 🟡 🟠 🔴, seuils configurables), rupture estimée, stock cible, **commande conseillée**, surstock, valeur immobilisée |
| Terrain | `/terrain`, `/terrain/saisie`, `/terrain/[id]`, `/terrain/animatrices` | Saisie mobile < 1 min, animations (sell-out, coût, ROI, sell-in avant/après = incremental), score composite des animatrices |
| Réglementaire | `/reglementaire` | Dossiers, alertes 180/120/90/60/30/15 j, documents manquants, **tâche de renouvellement automatique** |
| Tâches | `/taches` | Kanban, Mes tâches, priorités, échéances, commentaires, pièces jointes, origine (Action Center, réglementaire, stock…) |
| Marketing | `/marketing`, `/marketing/planning` | Budget par marque (prévu / engagé / dépensé / restant), plan par catégorie, actions & dépenses, campagnes (ROAS, CPA), ROI réel avec marge, planning éditorial Idée → Analysé |
| Imports | `/imports` | Excel / CSV → détection des colonnes → mapping → import avec dédoublonnage, rapprochement des désignations, historique, annulation |
| Paramètres | `/parametres` | Seuils des règles, objectifs annuels / mensuels, utilisateurs & rôles, données de démo |
| Installation | `/installation` | Hors session (clé `SETUP_KEY` ou Admin) : état de la base, migrations, socle, chargement du classeur compilé |
| Recherche | barre du haut | Produit, client, marque, dossier, tâche, campagne, contenu |

Rôles : **ADMIN/DG** (tout), **MARKETING** (marketing, planning, produits, tâches), **RÉGLEMENTAIRE** (dossiers, tâches), **TRADE** (ventes, clients, stock, terrain, imports, tâches), **ANIMATRICE** (saisie, ses animations, ses tâches). Voir `src/lib/access-shared.ts`.

## Moteur de règles (Action Center)

`src/lib/rules/` — une règle = un module `{ id, label, description, run(ctx) → Recommendation[] }`, enregistré dans `src/lib/rules/index.ts`. Aucun seuil n'est codé en dur : tout vient de `settings` (Paramètres → Règles & seuils).

| Règle | Déclencheur |
|---|---|
| `stock-coverage` | couverture < seuils ou < délai fournisseur → commande conseillée (priorité pondérée par le CA à risque) |
| `stock-overstock` | > 6 mois de couverture → plan d'écoulement, ou activation marketing si marge élevée |
| `stock-scale-caution` | campagne digitale active sur une marque dont un produit a < 1,5 mois de stock → ne pas scaler |
| `regulatory-expiry` | expiration ≤ délai de renouvellement, expiré, documents manquants |
| `brand-drop` | CA marque du mois à date < −X % vs M-1 à date, avec hypothèse (ruptures ?) |
| `ads-performance` | SCALE / OPTIMIZE / STOP par campagne (CPA & ROAS 30 j vs 90 j) |
| `budget-overrun` | budget engagé > seuil, prévu > budget, consommation en avance |
| `client-intel` | relance (commande théorique dépassée), client à risque, inactif à forte valeur, stock rayon élevé + sell-out faible → animation plutôt que relance |
| `terrain-sellout` | sell-out en animation < −X % vs animations précédentes du point de vente |
| `tasks-overdue` | tâches en retard par responsable |
| `data-quality` | clients / produits créés par import à qualifier |

Chaque recommandation possède une clé stable ; créer une tâche depuis la carte rattache la tâche à cette clé (la recommandation disparaît de la vue par défaut tant que la tâche est ouverte).

## Données & imports

- **Date de référence** : les analyses de vente se calent sur la dernière date de vente importée (bandeau « données en retard de N jours ») ; terrain, réglementaire, tâches et budgets sont temps réel.
- **Produits** : identité = désignation canonique normalisée + alias (`product_aliases`). Les désignations proches (« FLUIDE HYDRATANT LEGER » ⊂ « GAMARDE FLUIDE HYDRATANT LEGER ACTIVE Tube 40 g ») sont rapprochées automatiquement (`src/lib/import/match.ts` : inclusion de tokens, cohérence des contenances, formes galéniques incompatibles, tokens distinctifs). Les cas restants se fusionnent depuis la fiche produit.
- **Clients** : identité = client fonctionnel normalisé + alias (raisons sociales). Le code Sage est conservé quand il existe.
- **Ventes** : dédoublonnage par (date, client, article, quantité, montant, n° de pièce, site) ; sans n° de pièce, chaque ligne du fichier est conservée.
- **Canal** = colonne « Site » (COS, CAS, COMANET, PHARMAFIRST…).
- `scripts/import-workbook.ts` charge le classeur « Compilé 2026 » (correspondances clients & marques, ventes 2025-2026 + 2024, stock, objectifs 2026, budgets 2026 avec FOC / échantillons / détail par catégorie). L'interface `/imports` fait la même chose fichier par fichier.

## Structure

```
src/app/(app)/…         écrans (App Router, server components + server actions)
src/components/         shell, UI, charts (recharts), formulaires
src/db/schema.ts        modèle relationnel (Drizzle ORM / PostgreSQL)
src/db/seed-base.ts     utilisateurs, marques, paramètres
src/db/seed-demo.ts     données de démo (purgeables)
src/lib/analytics.ts    agrégats de ventes, périodes de comparaison, objectifs
src/lib/clients.ts      customer intelligence (segments, rythme, recommandation)
src/lib/stock.ts        couverture, rupture estimée, commande conseillée
src/lib/terrain.ts      performance animatrices, impact animation
src/lib/rules/          moteur de règles de l'Action Center
src/lib/import/         parsing, mapping, normalisation, rapprochement, import, classeur compilé, téléversement par morceaux
src/lib/setup.ts        page d'installation : état de la base, migrations (drizzle migrator), clé d'accès
src/lib/settings.ts     paramètres métier configurables
scripts/                import du classeur, captures d'écran, parcours E2E
drizzle/                migrations SQL (appliquées par `db:migrate` ou depuis /installation)
DEPLOY.md               mise en ligne pas à pas (Supabase + Vercel)
```

Stack : Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS 4, Drizzle ORM, PostgreSQL, recharts, SheetJS, jose (sessions), bcryptjs.

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` / `build` / `start` | développement / build / production |
| `npm run db:push` | applique le schéma à la base |
| `npm run db:generate` / `db:migrate` | migrations SQL (dossier `drizzle/`) |
| `npm run db:seed:base` | socle (idempotent) |
| `npm run db:import -- <xlsx> [--reset]` | charge le classeur compilé (`--reset` vide d'abord les données importées) |
| `npm run db:seed:demo` | données de démo |
| `node scripts/e2e.mjs` | parcours fonctionnel (serveur sur :3000) |
| `node scripts/shot.mjs <dossier> </a,/b> [--mobile]` | captures d'écran authentifiées |

## Feuille de route

- **V1 — CORE** (livré) : utilisateurs & rôles, marques, produits, clients, import Sage, ventes, terrain, réglementaire, tâches, budgets, planning, cockpit, Action Center, stock coverage & purchase forecast, customer intelligence, sell-in / sell-out terrain.
- **V2 — INTELLIGENCE** : forecasting CA avec scénarios, import des exports Meta / TikTok / Google Ads, base influenceuses & ROI par influenceuse, sell-out grossistes.
- **V3 — AUTOMATION** : connecteur API Sage, APIs Ads, COMANET WEEKLY & MONTHLY BRAND REVIEW envoyés par email, notifications, copilote IA (Donnée / Analyse / Hypothèse / Recommandation).
- **V4 — PREDICTIVE** : prévision achats multi-scénarios, allocation optimale des budgets, scoring clients, détection d'anomalies, simulation.
