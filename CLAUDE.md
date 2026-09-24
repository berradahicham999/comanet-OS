# COMANET OS — contexte pour Claude Code

Plateforme de pilotage interne de **COMANET**, distributeur B2B casablancais de marques
dermo-cosmétiques et de compléments alimentaires (pharmacies, parapharmacies, grossistes).
Jusqu'ici, Sage était la source de vérité et COMANET OS lisait ses exports sans jamais écrire dedans.
**Ce principe change** : la gestion commerciale (`src/lib/gestion/`, plan dans `docs/plan-gestion-commerciale.md`)
remplace progressivement Sage pour les pièces émises par COMANET (sites `COMANET` et `DESK DIGITAL`). Les autres
sites du fichier de ventes (Cospharma : COS, CAS, CAG, DAG, CMR ; Pharmafirst) restent importés. Rien n'est
jamais renvoyé vers Sage.

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
npm run agent:tool -- <outil> '<json>'   # pont CLI de l'Agent marketing (lecture seule, données réelles)
GESTION_IT=1 DATABASE_URL=<base jetable> node --conditions=react-server --import tsx scripts/gestion-integration.ts
                                         # intégration gestion commerciale (journal, numérotation, ventes, achats, inventaires) — jamais sur la prod
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
src/lib/marketing-intel/ couche Marketing Intelligence de l'Agent marketing (vue marque, stock par SKU, performance produit, décisions)
src/lib/content/      planning éditorial (référentiels, workflow, notifications, fichiers, démo)
src/lib/activations/  activations marketing hors digital (référentiels, workflow, budget, inventaire, ROI, démo)
src/lib/gestion/      gestion commerciale (montants exacts, numérotation, journal de stock, clients, fournisseurs, préparation de la bascule)
drizzle/              migrations SQL + meta/_journal.json
```

Modules : Cockpit, Action Center, Ventes, Clients, Produits, Marques, Stock,
**Marketing** (vue d'ensemble, campagnes, Digital Ads, Influence, planning éditorial, activations, matériel, budgets, analytics, agent marketing),
Terrain (animations, animatrices, saisie), Réglementaire, Tâches, Imports, Paramètres,
**Gestion commerciale** (préparation de la bascule, stock réel, fournisseurs, pièces de vente : BL, factures, avoirs, PDF ; achats : commandes, réceptions, factures fournisseurs, retours ; inventaires ; règlements à venir).

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
| Résultat officiel d'une ligne publicitaire (selon l'objectif Meta) | `src/lib/ads.ts` | `resultKindOf()`, `resultCount()`, `kpis().costPerResult` |
| Intelligence Ads (benchmark, tendance, anomalies, fatigue, winners, contenu, décisions, mémoire) | `src/lib/ads-intel/` | `buildCommandCenter()`, `entityDetail()`, `searchHistory()`, `ADS_AGENT_API` |
| Catalogue Meta, produit et étiquettes d'une publicité | `src/lib/meta/entities.ts` | `syncEntities()`, `matchProductInText()`, `autoTags()` |
| Historique Meta 2023 → (rattrapage reprenable) | `src/lib/meta/backfill.ts` | `backfillAccount()`, `backfillAll()` |
| Diagnostic réel de la connexion Meta | `src/lib/meta/doctor.ts` | `runDoctor()`, `explainMetaError()` |
| Score animatrice | `src/lib/animations.ts` | `animatriceScores()` — source unique |
| Stock chez le client (dernier relevé, ancienneté, écart, couverture estimée, droits par canal) | `src/lib/client-stock.ts` + `client-stock-shared.ts` | `recordReadings()` (seule écriture), `latestByProduct()`, `agingOf()`, `deltaOf()`, `estimatedCoverageWeeks()`, `canRecordReading()` |
| Clé de commande, commercial, canal | `src/lib/analytics.ts` | `ORDER_KEY`, `SALES_REP`, `SALES_CHANNEL` |
| Ville, clé d'animation | `src/lib/animations-shared.ts` | `normalizeCity()`, `cityKey()`, `animationKey()` |
| Droits d'accès, portée, interrupteurs | `src/lib/permissions.ts` + `src/lib/access.ts` | `requireAccess()`, `requirePermission()`, `requireAdmin()`, `requireFlag()`, `canDo()`, `isOwnOnly()`, `brandFilter()`, `clientFilter()`, `hasFlag()` |
| Qui est animatrice / délégué | `src/lib/users.ts` | `listAnimatrices()`, `listDelegates()`, `ANIMATRICE_SQL`, `DELEGATE_SQL` |
| Statut d'un contenu éditorial, transitions, retards | `src/lib/content/workflow.ts` + `src/lib/content/shared.ts` | `transition()` (seule écriture du statut), `checkTransition()`, `nextTransitions()`, `lateness()`, `canValidateBrand()` |
| Statut d'une activation, budget, retards, retour | `src/lib/activations/workflow.ts` + `shared.ts` + `budget.ts` + `roi.ts` | `transitionActivation()` (seule écriture du statut), `budgetTotals()`, `expenseRowsFor()`, `syncActivationExpenses()` (seul reflet dans `marketing_expenses`), `activationLateness()`, `compareSales()`, `roiVerdict()`, `canValidateActivation()` |
| Stock d'un article d'inventaire | `src/lib/activations/inventory.ts` + `shared.ts` | `recordMovement()` (seule écriture du stock), `consumeMaterial()`, `inventoryStatus()` |
| Pièce de vente (montants, blocages, cycle, PDF, projection dans les ventes) | `src/lib/gestion/calc.ts` + `documents-shared.ts` + `documents.ts` + `pdf.tsx` + `projection.ts` | `computeDocument()`, `amountInWords()`, `commercialIssues()`, `validateDocument()` (seule validation), `storedPdf()`, `projectDocument()` (seule écriture des ventes COMANET_OS) |
| Lecture marketing d'une marque (statut de stock par SKU, profil / catégorie produit, objectifs et écart, contexte marketing, décisions) | `src/lib/marketing-intel/` | `buildBrandOverview()`, `buildInventory()`, `buildProductPerformance()`, `buildSalesTargets()`, `buildMarketingContext()`, `buildRecommendations()`, `stockStatusOf()`, `stockRiskOf()`, `salesProfileOf()`, `decide()` |
| Montants, quantités, coûts exacts (jamais de float), CMUP, valeur de stock | `src/lib/gestion/money.ts` | `parseDecimal()`, `roundDiv()`, `formatScaled()`, `nextCmup()`, `valueOf()`, `fmtQty()`, `fmtMoney()` |
| Numéro d'une pièce (séries, reprise Sage, sans trou) | `src/lib/gestion/numbering.ts` + `numbering-shared.ts` | `allocateNumber()` (seule écriture, dans la transaction de validation), `setNextNumber()`, `formatNumber()`, `patternError()`, `nextNumberError()` |
| Stock réel de l'entrepôt (journal de mouvements, lots, péremption, dépôts externes par photo) | `src/lib/gestion/ledger.ts` + `ledger-shared.ts` | `recordStockMovements()` (seule écriture), `stockState()`, `listMovements()`, `reverseImportMovements()`, `movementError()`, `allocateFefo()`, `expiryStatus()` |
| Journal d'audit (qui a créé, modifié, archivé quoi) | `src/lib/audit.ts` | `audit()` (seule écriture de `audit_logs`), `changedFields()`, `auditTrail()` |
| Pièce d'achat (montants en devise et en MAD, frais d'approche, coût de revient, rapprochement, cycle) | `src/lib/gestion/purchases-shared.ts` + `purchases.ts` | `computePurchase()`, `allocateLandedCosts()`, `unitCostMad()`, `invoiceGaps()`, `validatePurchase()` (seule validation, seule entrée d'achat en stock) |
| Inventaire (théorique figé, compté, écart, fiabilité, pistes d'explication) | `src/lib/gestion/counts-shared.ts` + `counts.ts` | `countedByLine()`, `lineGap()`, `countStats()`, `gapLeads()`, `recurringGaps()`, `validateCount()` (seule validation, seuls ajustements d'inventaire) |
| Client prêt à facturer, doublons de clients | `src/lib/gestion/clients-shared.ts` + `clients.ts` | `billingReadiness()`, `duplicateCandidates()`, `createClient()`, `updateClientLegal()`, `clientLinks()` |

`tests/definitions-uniques.test.ts` échoue si une seconde définition réapparaît.

**Planning éditorial** (`docs/guide-planning-editorial.md`). Plateformes, formats, objectifs, statuts et
transitions sont des tables de référence modifiables dans `/parametres/contenus` : le code ne connaît
aucun nom de statut, il lit les drapeaux (`is_published`, `awaiting_validation`, `in_production`,
`is_archived`). Archiver ne supprime rien. Les livrables sont stockés en `bytea` dans `content_assets`
via `src/lib/content/assets.ts` (seul module à toucher pour passer à un stockage objet). Les notifications
in-app vivent dans `notifications` (`src/lib/content/notify.ts`).

**Activations** (`docs/guide-activations.md`). Types (avec checklist par défaut), statuts (drapeaux `awaiting_validation`,
`is_validated`, `is_running`, `is_done`, `is_measured`, `is_archived`, `is_cancelled`), transitions, objectifs, cibles,
postes budgétaires, catégories d'inventaire et modèles sont des tables de référence modifiables dans
`/parametres/activations` ; les fenêtres de mesure et seuils de verdict dans `settings.activations`. Pas de module de
permission dédié : Voir / Créer / Modifier via « marketing » OU « clients » (`requireActivationAccess()`), validation via
administrateur, interrupteur « Valider une dépense » ou `brand_validators`. Une activation VALIDÉE engage chaque poste
pour son prévu (devis puis facture remplacent) : le reflet vit dans `marketing_expenses` (`activation_ref`), jamais
ailleurs. Le matériel sorti est une dépense au coût du moment. L'impact ventes (sell-in HT avant / pendant / après sur les
clients et produits rattachés) est une corrélation observée ; une fenêtre « après » incomplète affiche « pas encore
comparable ». Les fichiers réutilisent `content_assets` (polymorphe : contenu, activation, article d'inventaire).

**Stock chez le client** (`docs/guide-stock-clients.md`). Le point de vente EST le client. Une seule table
`client_stock_readings`, une ligne par relevé (photo datée, jamais d'écrasement), alimentée par deux canaux :
l'animatrice depuis la saisie terrain (champ « rayon », `ANIMATION`, `animation_id`) et le commercial depuis la fiche
client, onglet « Stock en point de vente » (`TOURNEE_COMMERCIALE`). Stock actuel = dernier relevé. Seuils d'ancienneté
et fenêtres dans `settings.clientStock`. La couverture est une estimation (stock ÷ rythme de sell-in), jamais une mesure.

**Ads Command Center** (`docs/ads-command-center.md`). `/marketing/ads` est UNE page : santé, snapshot, Action Center (3 à 5
décisions avec WHY / DATA / ACTION / CONFIANCE, « ne rien faire » compris), où mettre l'argent, winners et problèmes,
quoi pousser, quoi publier, santé des créatives, impact business, état des données ; tout le détail vit dans des drawers.
Les comptes COMANET ne suivent aucun achat : le **résultat officiel** est celui de l'objectif Meta (`resultKindOf()` :
conversation, vue de page, lead, achat, couverture) et `diagnose()` juge sur ce coût par résultat ; ROAS et CPA d'achat
affichent « — » tant qu'aucune valeur de conversion n'est mesurée. Les moteurs (`src/lib/ads-intel/`) sont purs et
réutilisables (`agent.ts` expose `get_current_ads_performance`, `recommend_content_to_create`…) ; l'interface ne calcule
rien. Un winner exige volume, jours, coût sous la référence, stabilité et récence (seuils dans `settings.adsIntel`).
Meta ne sert que 37 mois d'insights : un mois refusé est « historique indisponible », jamais estimé. `META_ACCESS_TOKEN`
accepte plusieurs jetons (virgules) car les comptes sont répartis sur plusieurs Business Managers. Lecture + analyse +
recommandation uniquement : aucune écriture vers Meta.

**Copilote IA** (`docs/guide-copilote-ia.md`, plan dans `docs/plan-ai-copilot.md`). Le modèle ne lit la donnée que par
les outils typés de `src/lib/ai/tools/` (Zod, dépendances injectables, filtrés par la matrice et la portée côté serveur,
journalisés dans `ai_tool_calls`) ; chaque outil appelle une fonction officielle du tableau ci-dessus, jamais une formule
maison. Écritures autorisées : tables `ai_*` et une tâche au statut `PROPOSED` (`tests/ai/read-only.test.ts` l'impose).
Réponses en quatre blocs Donnée / Analyse / Hypothèse / Recommandation ; zéro chiffre hors `tool_result` ; sell-in et
sell-out toujours nommés, jamais additionnés. System prompt versionné dans `src/lib/ai/prompts/copilot.md` (bloc mis en
cache), clé et modèles en variables d'environnement, limites dans `settings.ai` (`/parametres/ia`). Surfaces : panneau
⌘K (`/api/ai/chat`, SSE), « Expliquer » sur les cartes (`explain.ts`, cache 1 h), brief du matin (`brief.ts`, cache
quotidien, administrateurs), « Détailler » sur l'Action Center (`plans.ts`), rapports (`reports.ts`, module `rapports`).
Ouvert aux profils hors portée OWN (`copilotAllowed()`).

**Agent marketing** (`docs/guide-agent-marketing.md`). Le copilote avec la persona marketing
(`src/lib/ai/prompts/marketing-agent.md`) et dix outils de lecture (`src/lib/ai/tools/marketing-*.ts`) posés sur la
couche `src/lib/marketing-intel/` (pure, dépendances injectées, aucune formule maison : elle appelle les fonctions du
tableau ci-dessus). Chaque valeur rendue au modèle est étiquetée CONFIRMED / CALCULATED / INFERRED / MISSING ; une
donnée absente est dite manquante, jamais estimée. Le moteur de décision (`decisions.ts`) ne décide jamais sur les
ventes seules : ventes ↑ + stock faible = RESTOCK, ventes ↓ + stock élevé = promotion / sell-out, marge faible = pas
de scale automatique ; seuils dans `settings.marketingIntel` (Paramètres → Agent marketing) et réutilisation des
seuils de stock et de croissance existants. Surfaces : page `/marketing/agent` (contexte métier calculé côté
serveur, « données à jour au … », recommandation du moteur, chat avec la marque transmise), panneau ⌘K, et le
sous-agent Claude Code `comanet-marketing` via `npm run agent:tool -- <outil> '<json>'` (lecture seule). Aucune
donnée de vente ou de stock n'entre dans un prompt : elle est lue par les outils à chaque question.

**Gestion commerciale** (`docs/guide-gestion-commerciale.md`, plan `docs/plan-gestion-commerciale.md`). Lot 1 livré :
fondations. On **étend** `clients` (identité légale : `account_code` = code Sage COMANET, distinct de `code` qui vient
des fichiers distributeurs ; `legal_name`, `ice`, conditions) et `products` (`code` = réf. COMANET type CYG01,
distincte de `sku` ; EAN, TVA, suivi des lots) — aucun second référentiel ; le matériel marketing reste dans
`inventory_items`. Nouvelles tables : `suppliers`, `tax_rates`, `payment_modes`, `warehouses` (INTERNE = journal,
EXTERNE = photo importée : Cospharma, Pharmafirst), `stock_lots`, `stock_movements` (écriture seule, triggers qui
refusent UPDATE / DELETE / TRUNCATE ; une erreur se corrige par contre-mouvement), `document_series` +
`document_sequences`. Les montants sont des entiers à échelle fixe (`money.ts`), un test interdit `parseFloat` et
`toFixed` dans `src/lib/gestion/`. Toute écriture de référentiel laisse une trace `audit_logs` dans la même
transaction. Réglages : `settings.gestion` (identité de la société — jamais dans le code, le dépôt est public —,
TVA par défaut, délais, stock insuffisant, péremption, bascule : mode OFF → PARALLELE → ACTIF, date, sites).
Logo et cachet dans `content_assets` (`company_slot`). Droits : modules `livraisons`, `facturation`, `achats` ;
archiver / bloquer / supprimer = « Valider ». `productStocks()` lit encore les photos : il passera sur le journal
à la bascule (un seul point de changement).
Lot 2 livré : ventes. `sales_documents` + `sales_document_lines` (BL, FACTURE, AVOIR), figées par triggers dès la
validation ; seul `src/lib/gestion/documents.ts` crée, valide, livre, annule ou facture (`validateDocument()` : blocages
`commercialIssues()`, numéro, identités figées, sortie FEFO / retour, compteurs facturé / crédité). Montants :
`calc.ts` (`computeDocument()`, `amountInWords()`), seule définition. Avant la bascule (mode OFF / PARALLELE) les pièces
sont des simulations (séries SIMBL / SIMFA / SIMAV) ; en mode ACTIF seulement, `projection.ts` écrit `sales` (source
`COMANET_OS`). PDF : `pdf.tsx` (@react-pdf/renderer, `serverExternalPackages`), stocké à la validation ; lien public
`/d/<jeton>` (`share.ts`). Levée de blocage : interrupteur `overrideCommercial`. Règles Action Center : catégorie
GESTION (`src/lib/rules/gestion-rules.ts`), table catégorie → modules unique : `CATEGORY_MODULES`.
Lot 3 livré : achats. `purchase_documents` + `purchase_document_lines` + `landed_costs` (commande CF, réception BR,
facture fournisseur FF, retour RF), figées par triggers ; seul `src/lib/gestion/purchases.ts` les écrit
(`validatePurchase()`). Devise et **taux saisi sur la pièce** (jamais deviné). La réception fait entrer le stock au
coût de revient (prix × taux + frais d'approche répartis, `purchases-shared.ts`) : CMUP, `products.cost_price`. La
facture fournisseur est rapprochée des réceptions (écarts signalés, jamais corrigés). Matériel marketing via
`recordMovement()`. `productStocks()` : commandes en cours = reste à recevoir des commandes ouvertes. Droits : module
`achats` ; réception et retour aussi par `stock` (Magasin).
Lot 4 livré : inventaires. `stock_counts` + `stock_count_lines` (théorique et CMUP figés au démarrage) +
`stock_count_entries` (une saisie par compteur, sommées) + `count_gap_reasons` ; seul `src/lib/gestion/counts.ts` les
écrit (`validateCount()` : motif obligatoire, un AJUSTEMENT_INVENTAIRE par écart, numéro INV). Non compté ≠ zéro. Écart,
fiabilité et pistes (`counts-shared.ts` : `lineGap()`, `countStats()`, `gapLeads()` — donnée ≠ hypothèse). Comptage
mobile avec scan (BarcodeDetector) ; à l'aveugle, le théorique ne quitte pas le serveur. Droits : `stock` (Créer =
compter, Valider = valider).

**Permissions modulaires par utilisateur** (`docs/permissions-modulaires.md`). Chaque compte porte
sa propre matrice `user_permissions` (17 modules × Voir / Créer / Modifier / Valider), une portée
`user_scope` (OWN / ASSIGNED / ALL), des assignations de marques et de clients, et sept interrupteurs
transverses `user_flags`. Les modèles de rôle (`role_templates`) ne servent qu'à pré-remplir.
Règles : aucune décision d'accès sur `users.role` (enum legacy recalculée, lecture seule — un test
l'interdit) ; une page garde avec `requireAccess(module)`, une action avec `requirePermission(module, action)` ;
Cockpit, Action Center, Recherche et Imports utilisent `requireAnyModule()` et filtrent par module ;
importer = Créer sur le module du type (`IMPORT_MODULE`), annuler = Valider ; « Valider » = action
irréversible ou externe ; tout ce qui touche l'argent (enveloppes annuelles, engagement d'une dépense)
passe par Administration ou l'interrupteur « Valider une dépense » ; personne ne modifie ses propres
droits ; le dernier administrateur ne peut être ni rétrogradé ni suspendu. La prévisualisation
« en tant que » pose un cookie signé et refuse toute server action.

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
- `rollback.ts` — annulation ; seuls les imports « par ligne » (SALES, STOCK, ANIMATIONS, ADS,
  STOCK_INITIAL) sont réversibles, les imports de référentiel expliquent pourquoi ils ne le sont pas.
  Un stock initial ne s'efface pas : son annulation écrit des contre-mouvements dans le journal.

Types : `SALES`, `CLIENTS`, `PRODUCTS`, `STOCK`, `OBJECTIVES`, `BUDGETS`, `REGULATORY`,
`ANIMATIONS`, `ANIM_OBJECTIVES`, `ADS`, `MEDECINS`, `INVENTORY`, `INFLUENCERS`, `STOCK_INITIAL`.
`STOCK` (photo) porte un dépôt : Cospharma et Pharmafirst ne sont connus que par leurs photos.

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
