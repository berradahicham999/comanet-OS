# COMANET OS — contexte pour Claude Code

Plateforme de pilotage interne de **COMANET**, distributeur B2B casablancais de marques
dermo-cosmétiques et de compléments alimentaires (pharmacies, parapharmacies, grossistes).
Sage reste la source de vérité comptable ; COMANET OS lit ses exports et n'écrit jamais dedans.

Utilisateur : **Hicham**, co-gérant. Réponses et interface **en français**.
Devise MAD, fuseau `Africa/Casablanca`.

---

## Stack

Next.js 16 (App Router, server components + server actions) · React 19 · TypeScript ·
Tailwind CSS 4 · Drizzle ORM · PostgreSQL (Supabase, région Frankfurt) · déploiement Vercel (`fra1`).

```bash
npm run dev            # développement
npm test               # tests unitaires (node:test via tsx, aucune base requise)
npm run build          # build de production (à passer avant tout commit)
npx tsc --noEmit       # vérification de types (rapide, à passer souvent)
npm run lint
npm run db:generate    # génère une migration depuis src/db/schema.ts
npm run db:push        # pousse le schéma sans migration (dev uniquement)
npm run db:studio
```

Variables d'environnement : `DATABASE_URL`, `DATABASE_SSL`, `SESSION_SECRET`, `SETUP_KEY`,
`BUSINESS_TZ`, `DATABASE_POOL_MAX`. Voir `.env.example` et `DEPLOY.md`.

Sur Supabase, l'application utilise le **Transaction pooler (6543)** ; les scripts CLI
(`db:push`, `db:import`) le **Session pooler (5432)**.

---

## Organisation du code

```
src/app/(app)/        pages authentifiées, une par module
src/app/installation/ assistant d'installation en 4 étapes (schéma, socle, classeur)
src/components/       ui.tsx (design system), charts.tsx, nav-config.ts, shell/
src/db/schema.ts      schéma Drizzle — source unique du modèle de données
src/lib/              logique métier, une bibliothèque par domaine
src/lib/import/       moteur d'import (parse → mapping → run → rollback)
src/lib/meta/         connexion Meta Ads en lecture seule (client → sync → links)
src/lib/rules/        moteur de recommandations (Action Center)
drizzle/              migrations SQL + meta/_journal.json
```

Modules : Cockpit, Action Center, Ventes, Clients, Produits, Marques, Stock,
**Marketing** (vue d'ensemble, campagnes, Digital Ads, Influence, planning éditorial, budgets),
Terrain (animations, animatrices, saisie), Réglementaire, Tâches, Imports, Paramètres.

---

## Règles de développement

**Ne pas reconstruire l'existant.** Réutiliser les composants (`src/components/ui.tsx`),
les tables et les relations déjà en place. Ne jamais créer une deuxième table pour une
notion qui existe déjà (pas de second référentiel produits, clients ou marques).

**Attribution : corrélation ≠ causalité.** C'est une exigence explicite d'Hicham et elle
s'applique partout dans le marketing. Un chiffre d'affaires n'est présenté comme *attribué*
que s'il est réellement mesuré : valeur de conversion remontée par la régie, code promo
nominatif, ou montant saisi à la main. Tout le reste s'affiche comme
« **corrélation observée** », jamais « cette campagne a généré X MAD ». Une fenêtre de
comparaison incomplète affiche « pas encore comparable » plutôt qu'un écart trompeur.
Une donnée manquante s'affiche « — » ou « non mesurable » ; elle n'est jamais estimée.

**Une notion métier = une seule fonction.** Les définitions officielles vivent chacune dans
un module dédié et sont utilisées partout (pages, règles, cockpit, exports). Ne jamais
recalculer une de ces notions à la main dans une page ou une requête :

| Notion | Module officiel | Points d'entrée |
|---|---|---|
| CA sell-out (TTC, prix public) | `src/lib/sellout.ts` | `selloutAmountSql()`, `selloutSumSql()`, `lineSellout()` |
| Couverture de stock, commande conseillée | `src/lib/stock-math.ts` + `src/lib/stock.ts` | `computeCoverage()`, `productStocks()`, `isUnderTension()` |
| Budget marketing consommé | `src/lib/budget.ts` | `budgetConsumption()`, `budgetConsumptionByBrand()` |
| Dépense publicitaire (priorité régie → saisie) | `src/lib/ad-spend.ts` | `adSpend()` |
| Verdict publicitaire | `src/lib/ads.ts` | `diagnose(cur, ref, brandAvg, settings.ads)` |
| Score animatrice | `src/lib/animations.ts` | `animatriceScores()` — source unique |
| Clé de commande, commercial, canal | `src/lib/analytics.ts` | `ORDER_KEY`, `SALES_REP`, `SALES_CHANNEL` |
| Ville, clé d'animation | `src/lib/animations-shared.ts` | `normalizeCity()`, `cityKey()`, `animationKey()` |

`tests/definitions-uniques.test.ts` échoue si une seconde définition réapparaît.

**Seuils dans `settings`**, pas en dur dans les règles. Les **secrets** (jetons de régie)
restent en variables d'environnement, jamais en base.

**Devises.** Les comptes publicitaires Meta facturent en EUR et en USD. `ad_metrics.spend` et
`revenue` sont toujours en MAD, convertis avec un taux **saisi** dans `settings.fxRates` ; le
montant d'origine, la devise et le taux appliqué sont conservés sur la ligne. Sans taux
configuré, la synchronisation est refusée — un montant en dirhams n'est jamais deviné.

**Français partout** : libellés, commentaires de code, messages d'erreur, noms de colonnes
affichés. Les identifiants techniques restent en anglais.

**Écrans vides utiles** : un module sans données explique quoi importer et où le trouver
(voir l'état vide de `/marketing/ads`), il n'affiche pas seulement « aucune donnée ».

---

## Imports

Un seul moteur pour tous les types : `src/lib/import/`.

- `parse.ts` — lecture xlsx/csv, détection de la ligne d'en-tête et **de l'encodage**
  (UTF-8 vs Windows-1252 ; sans elle les exports de régie accentués sont illisibles).
- `fields.ts` — champs et synonymes par type, mapping automatique.
- `run.ts` — un `import<Type>()` par type de données.
- `rollback.ts` — annulation ; seuls les imports « par ligne » (SALES, STOCK, ANIMATIONS, ADS)
  sont réversibles, les imports de référentiel expliquent pourquoi ils ne le sont pas.

Types : `SALES`, `CLIENTS`, `PRODUCTS`, `STOCK`, `OBJECTIVES`, `BUDGETS`, `REGULATORY`,
`ANIMATIONS`, `ANIM_OBJECTIVES`, `ADS`.

Pour les publicités, `src/lib/meta/` fait la même chose par API et suit les mêmes conventions
(clé de dédoublonnage stable, lots, `import_id`/`source`). La synchro relit une **fenêtre
glissante** de 28 jours : Meta révise ses conversions plusieurs jours après coup. Sur une
période synchronisée, les lignes du même compte issues d'un import fichier sont supprimées —
elles décriraient les mêmes journées sous une autre clé.

Conventions à respecter pour tout nouvel import :

1. **Idempotent** : une `dedupe_key` stable + `onConflictDoUpdate` — recharger le même
   fichier met à jour, ne duplique pas.
2. **Par lots** : une requête par 200–1000 lignes, jamais une requête par ligne
   (un import ligne par ligne prenait 10 minutes sur 1 400 lignes ; en lots, 1,4 s).
3. **Anti-régression** : ne jamais écraser avec du vide une valeur saisie dans l'application.
4. **`import_id`** sur les lignes créées, pour rendre l'import annulable.

---

## Moteur de règles (Action Center)

`src/lib/rules/` — chaque règle exporte un `Rule` et est enregistrée dans `index.ts`.
Une recommandation dit **pourquoi** (`why`, le diagnostic), **quoi faire** (`action`),
et propose une tâche assignable. Les règles se croisent : une campagne à scaler vérifie
d'abord la couverture de stock des produits poussés.

---

## Déploiement

`main` sur GitHub (`berradahicham999/comanet-OS`) → Vercel déploie automatiquement →
migrations appliquées depuis `/installation` (bouton « Appliquer les migrations »),
qui lit `drizzle/meta/_journal.json`.

**Toute nouvelle migration doit être ajoutée au journal**, sinon elle n'est jamais appliquée.

Production : https://comanet-os.vercel.app
