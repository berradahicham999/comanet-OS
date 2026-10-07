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
                                         # intégration gestion commerciale (journal, numérotation, ventes, achats, inventaires, règlements, bascule) — jamais sur la prod
MEDICAL_IT=1 DATABASE_URL=<base jetable> node --conditions=react-server --import tsx scripts/medical-integration.ts
                                         # intégration Médical v2 (chrono, GPS, hors connexion, corrections, ordonnances) — jamais sur la prod
CRM_IT=1 DATABASE_URL=<base jetable> node --conditions=react-server --import tsx scripts/crm-integration.ts
                                         # intégration CRM commercial (portefeuilles, chrono, GPS, objectifs client, fusion, règles, imports) — jamais sur la prod
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
src/lib/medical/      médical (médecins, visites, chrono et GPS, ordonnances, analyses)
src/lib/gestion/      gestion commerciale (montants exacts, numérotation, journal de stock, clients, fournisseurs, préparation de la bascule)
src/lib/crm/          CRM commercial (portefeuilles, fréquence, visites chronométrées, objectifs client, chronologie, assortiment manquant)
src/lib/creative/     Studio créatif / Intelligence contenu (tensions, territoires, opportunités, concepts, package, brief, apprentissage, étapes IA)
drizzle/              migrations SQL + meta/_journal.json
```

Modules : Cockpit, Action Center, Ventes, Clients (dont **CRM commercial** : Ma tournée, Suivi des visites, Portefeuilles, onglet Suivi commercial), Produits, Marques, Stock,
**Marketing** (Command Center, plan marketing, priorités & actions, campagnes, Influence, Digital Ads, contenu, **Studio créatif**, activations, matériel & goodies, budget & dépenses, analytics, agent marketing),
Terrain (animations, animatrices, saisie), **Médical** (médecins, Ma journée avec chrono et GPS, suivi terrain, ordonnances, analyses et tournée), Réglementaire, Tâches, Imports, Paramètres,
**Gestion commerciale** (préparation de la bascule, stock réel, fournisseurs, pièces de vente : BL, factures, avoirs, PDF ; achats : commandes, réceptions, factures fournisseurs, retours ; inventaires ; règlements, relances, envoi au comptable ; bascule).

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
| Prévision mensuelle modélisée (saisonnalité : Ramadan, solaire, rentrée), ratio observé d'un événement, lien « Commander » | `src/lib/forecast-shared.ts` + `src/lib/forecast.ts` | `buildForecast()`, `demandSeries()`, `seasonIndex()`, `observedEventRatio()`, `observedEventRatios()`, `suppliersByBrand()`, `orderPrefillHref()` |
| Marge brute d'un produit (prix encaissé HT = PPH, égal au prix public TTC, ramené HT moins la remise client moyenne) | `src/lib/stock-math.ts` | `netSellingPrice()`, `marginPct()` |
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
| Pièce de vente (montants, blocages, cycle, PDF, projection dans les ventes, commande client → BL) | `src/lib/gestion/calc.ts` + `documents-shared.ts` + `documents.ts` + `pdf.tsx` + `projection.ts` | `computeDocument()`, `amountInWords()`, `commercialIssues()`, `validateDocument()` (seule validation), `createBLFromOrder()`, `orderStatusAfterDelivery()`, `storedPdf()`, `projectDocument()` (seule écriture des ventes COMANET_OS) |
| Bibliothèque d'actions (modèles livrés + équipe, import / export Excel, modèle tiré d'une action ou d'une activation réalisée) et « ce qui marche par marque » | `src/lib/action-generator/library-shared.ts` + `library.ts` | `validateTemplate()`, `templateToFields()` / `fieldsToTemplate()` / `sheetRowToFields()` (formulaire = Excel), `templateFromProposal()`, `templateFromActivation()`, `listLibrary()`, `loadLibrary()` (ce que lit le générateur), `saveTemplate()`, `setTemplateActive()`, `resetOrDeleteTemplate()`, `importTemplates()`, `playbookFor()`, `savePlaybook()` (seules écritures de `action_templates` et `brand_marketing_playbooks`) |
| Lecture marketing d'une marque (statut de stock par SKU, profil / catégorie produit, objectifs et écart, contexte marketing, décisions) | `src/lib/marketing-intel/` | `buildBrandOverview()`, `buildInventory()`, `buildProductPerformance()`, `buildSalesTargets()`, `buildMarketingContext()`, `buildRecommendations()`, `stockStatusOf()`, `stockRiskOf()`, `salesProfileOf()`, `decide()` |
| Montants, quantités, coûts exacts (jamais de float), CMUP, valeur de stock | `src/lib/gestion/money.ts` | `parseDecimal()`, `roundDiv()`, `formatScaled()`, `nextCmup()`, `valueOf()`, `fmtQty()`, `fmtMoney()` |
| Numéro d'une pièce (séries, reprise Sage, sans trou) | `src/lib/gestion/numbering.ts` + `numbering-shared.ts` | `allocateNumber()` (seule écriture, dans la transaction de validation), `setNextNumber()`, `formatNumber()`, `patternError()`, `nextNumberError()` |
| Stock réel de l'entrepôt (journal de mouvements, lots, péremption, dépôts externes par photo) | `src/lib/gestion/ledger.ts` + `ledger-shared.ts` | `recordStockMovements()` (seule écriture), `stockState()`, `listMovements()`, `reverseImportMovements()`, `movementError()`, `allocateFefo()`, `expiryStatus()` |
| Journal d'audit (qui a créé, modifié, archivé quoi) | `src/lib/audit.ts` | `audit()` (seule écriture de `audit_logs`), `changedFields()`, `auditTrail()` |
| Pièce d'achat (montants en devise et en MAD, frais d'approche, coût de revient, rapprochement, cycle) | `src/lib/gestion/purchases-shared.ts` + `purchases.ts` | `computePurchase()`, `allocateLandedCosts()`, `unitCostMad()`, `invoiceGaps()`, `validatePurchase()` (seule validation, seule entrée d'achat en stock) |
| Inventaire (théorique figé, compté, écart, fiabilité, pistes d'explication) | `src/lib/gestion/counts-shared.ts` + `counts.ts` | `countedByLine()`, `lineGap()`, `countStats()`, `gapLeads()`, `recurringGaps()`, `validateCount()` (seule validation, seuls ajustements d'inventaire) |
| Règlement, solde d'une facture, balance âgée, relance, bascule (réel ou simulation) | `src/lib/gestion/receivables-shared.ts` + `payments.ts` + `documents-shared.ts` + `cutover.ts` | `invoiceBalance()`, `agingBucket()`, `agedBalance()`, `reminderLevel()`, `planAllocation()`, `createPayment()` (seule écriture des règlements), `emitsReal()`, `importBlockedByCutover()`, `setCutoverMode()` |
| P&L de gestion (nature des sites, CA direct / en bloc / commissions, coût des ventes, charges récurrentes, soldes, contribution par marque, point mort) | `src/lib/pnl-shared.ts` + `src/lib/pnl.ts` (+ `budgetConsumptionByMonth()` dans `budget.ts`) | `classifySite()`, `chargeMonths()`, `buildPnl()` (seule définition du compte de résultat), `pnlStatement()`, `createCharge()`, `reviseCharge()`, `createBulkSale()` |
| Contrôle de présence d'une visite (distance, heure retenue, durée, vitesse implicite, statut et motifs) | `src/lib/medical/gps-shared.ts` | `haversineM()`, `eventTime()`, `visitDurationMinutes()`, `impliedSpeedKmh()`, `verifyVisit()` |
| Chrono de visite (Démarrer / Terminer / non effectuée, clôture auto, correction, cabinet) | `src/lib/medical/chrono.ts` | `recordAction()` (seule écriture de `visit_events` et des heures de visite), `autoCloseStale()`, `correctVisit()`, `validateCabinet()`, `refreshVerification()` |
| Qui voit les heures et positions des visites | `src/lib/medical/field-access.ts` | `fieldScope()`, `inFieldScope()`, `requireFieldControl()` |
| Journée terrain (ordre, temps en visite / entre visites) et indicateurs du suivi | `src/lib/medical/field-report-shared.ts` + `field-report.ts` | `buildTimeline()`, `fieldVisits()`, `fieldKpis()` |
| Rapprochement d'un nom de médecin | `src/lib/medical/matching.ts` | `doctorNameTokens()`, `doctorAliasKey()`, `doctorNameScore()`, `matchDoctor()` |
| Ordonnances : potentiel A/B/C, segments, produits à présenter, impact des visites, tournée | `src/lib/medical/prescriptions-shared.ts` + `prescriptions.ts` + `analyses.ts` | `doctorPotential()`, `doctorSegment()`, `recommendProducts()`, `visitImpact()`, `tourPriority()`, `refreshDoctorPotentials()` (seule écriture du potentiel AUTO), `doctorBrief()` |
| Plan marketing (cadrage, chaîne planifié → alloué → engagé → dépensé → reste, allocation proposée, axes, plan mensuel) | `src/lib/marketing-plan/shared.ts` + `allocation.ts` + `plan.ts` | `planFraming()`, `budgetChain()`, `splitMonthBudget()`, `proposeAllocation()` (« non mesurable » sans historique), `savePlan()` (seule écriture des plans ; budget → `budgets`, CA objectif → `objectives`), `saveAllocation()` (→ `budget_lines`), `currentPlanFor()`, `axisOptions()` |
| Action marketing (budget prévu, canal, justification ; qui / quand / statut = sa tâche) | `src/lib/marketing-plan/actions.ts` | `createAction()` (seule création, tâche + action dans la même transaction), `updateAction()`, `setActionStatus()` (écrit `tasks.status`), `attachExpense()`, `listActions()`, `actionCounters()` |
| Décision unifiée (règles + intelligence Ads + intelligence marketing → une structure ; statut humain) | `src/lib/decisions/types.ts` + `adapters.ts` + `store.ts` + `store-shared.ts` + `build.ts` | `fromRule()`, `fromAdsIntel()`, `fromMarketingIntel()`, `buildUnifiedDecisions()`, `effectiveStatus()`, `approveDecision()` (crée l'action), `rejectDecision()` (écarte aussi la règle), `measureDecision()` (seule écriture de `marketing_decisions`) |
| Command Center marketing (quoi pousser, budget, objectif, retards, alertes) | `src/lib/marketing-plan/command-center.ts` | `buildMarketingCommandCenter()` |
| Dépense engagée (COMMITTED + SPENT) en SQL | `src/lib/budget.ts` | `engagedSql()` |
| Générateur d'actions marketing (60 modèles livrés sur 7 leviers, budget disponible par levier, estimation, score, non-répétition, opportunités, ajout au plan) | `src/lib/action-generator/catalog.ts` + `engine.ts` + `context.ts` + `server.ts` + `persist.ts` | `TEMPLATES` (modèles livrés), `renderPattern()` (textes à variables), `generate()` (seul moteur, pur), `axisAvailable()`, `proposedBudget()`, `splitBudget()`, `estimate()`, `scoreTemplate()`, `loadGeneratorData()`, `runGenerator()`, `brandOpportunities()`, `addProposalToPlan()` (seule écriture : plan, activation ou campagne, action, tâches, contenus, dépenses prévues) |
| CRM commercial : mois de suivi, visites attendues / comptées (plafonnées à la fréquence), progression, rythme, objectif client, priorité de tournée, assortiment manquant | `src/lib/crm/portfolio-shared.ts` (pur) | `monthBounds()`, `monthElapsedPct()`, `expectedVisits()`, `countedVisits()`, `visitProgress()`, `paceVerdict()`, `monthlyTarget()`, `objectiveProgress()`, `headlineObjective()`, `tourPriority()`, `suggestTour()`, `rankMissingAssortment()` |
| CRM commercial : portefeuilles (commercial attitré, fréquence, reprise depuis les droits), vue équipe / ville, visites du mois | `src/lib/crm/portfolio.ts` + `access.ts` / `access-shared.ts` | `portfolioOf()`, `teamOverview()`, `tourSuggestions()`, `visitsOfMonth()`, `assignAccountManager()` (seule affectation en masse), `setVisitFrequency()`, `applyDefaultFrequency()`, `managerProposals()`, `crmViewer()`, `canSeeUser()`, `canSeePositions()` |
| Visite commerciale (Démarrer / Terminer / non effectuée, hors connexion, clôture auto, correction, position du point de vente, commande déduite) | `src/lib/crm/visits.ts` + `visits-shared.ts` | `recordClientVisitAction()` (seule écriture des heures, du statut et du contrôle de `client_visits`, et de `visit_events.client_visit_id`), `planClientVisit()`, `logClientContact()`, `saveClientVisitReport()`, `autoCloseStaleClientVisits()`, `correctClientVisit()`, `validatePointOfSale()`, `visitOutcomes()`, `countsInProgress()` |
| Objectif client (CA HT sell-in, table `objectives.client_id`) | `src/lib/crm/objectives.ts` | `clientObjectives()`, `clientObjectiveProgress()`, `saveClientObjective()`, `deleteClientObjective()` ; toute lecture d'objectif de marque filtre `client_id is null` |
| Chronologie et fiche pré-visite d'un client (lecture seule) | `src/lib/crm/timeline.ts` + `intelligence.ts` | `clientTimeline()`, `clientVisitBrief()`, `missingAssortment()`, `clientReceivables()` |
| Client prêt à facturer, doublons de clients, groupe (enseigne), raisons sociales facturables, fusion de fiches | `src/lib/gestion/clients-shared.ts` + `clients.ts` | `billingReadiness()`, `duplicateCandidates()`, `createClient()`, `updateClientLegal()` (seule écriture de `group_id`), `listClientGroups()`, `clientLinks()`, `billingIdentity()` (identité imprimée), `saveLegalEntity()`, `mergePreview()`, `mergeClients()` (seule fusion) |

| Studio créatif : catégorie créative et discipline des allégations d'un produit, tensions consommateur activées par la fiche, taxonomie des mécaniques, empreinte et fatigue, apprentissage créatif (corrélation observée), scores explicables, opportunités, squelettes déterministes, brief | `src/lib/creative/` (`product-intel.ts`, `consumer.ts`, `territories.ts`, `fingerprint.ts`, `learning.ts`, `scoring.ts`, `opportunities.ts`, `rules.ts`, `brief.ts`, `compliance.ts`) | `creativeCategoryOf()`, `buildProductIntelligence()`, `matchTensions()`, `MECHANICS`, `creativeFingerprint()`, `similarity()`, `territoryUsage()`, `creativeLearning()`, `historicalFit()`, `scoreOpportunity()`, `scoreConcept()`, `buildOpportunities()`, `rankMechanics()`, `rulesConcepts()`, `draftPackage()`, `draftVariations()`, `buildBrief()`, `checkText()` / `checkPackage()` (seul contrôle des allégations) |
| Studio créatif : données, étapes IA, persistance | `src/lib/creative/context.ts` + `stages.ts` + `llm.ts` + `store.ts` + `server.ts` | `loadCreativeData()`, `creativePerformances()` (mémoire créative), `runStage()` (seul appel au modèle, sortie structurée), `findOpportunities()`, `generateConceptsFor()`, `buildPackageFor()`, `variationsFor()`, `sendToPlanning()` (seule création de contenu depuis le studio), `saveConcepts()` / `savePackage()` / `setConceptStatus()` (seules écritures de `creative_*`) |

`tests/definitions-uniques.test.ts` échoue si une seconde définition réapparaît.

**Planning éditorial** (`docs/guide-planning-editorial.md`). Plateformes, formats, objectifs, statuts et
transitions sont des tables de référence modifiables dans `/parametres/contenus` : le code ne connaît
aucun nom de statut, il lit les drapeaux (`is_published`, `awaiting_validation`, `in_production`,
`is_archived`). Archiver ne supprime rien. Les livrables sont stockés en `bytea` dans `content_assets`
via `src/lib/content/assets.ts` (seul module à toucher pour passer à un stockage objet). Les notifications
in-app vivent dans `notifications` (`src/lib/content/notify.ts`). **Brief PDF** : fichier `BRIEF` versionné dans
`content_assets` ; à la fin du dépôt, `importBriefFromAsset()` (`src/lib/content/brief-import.ts`) le fait lire par le modèle
(`runStage("brief-import")`, PDF joint en bloc document, prompt `brief-import.md`, aucune invention) puis `applyImportedBrief()`
écrit la fiche selon `mergeImportedBrief()` (le PDF remplace ce qu'il dit, ne vide jamais un champ ; références et produits
ajoutés ; deadline seulement si absente ; date de publication jamais), avec commentaire et `audit()`. Sans clé IA : fichier
gardé, formulaire à la main. « À préparer » (`myQueue()`) en tête du planning ; `briefMarkdown()` = brief à coller dans un assistant.

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
Logo et cachet dans `content_assets` (`company_slot`). Droits : modules `commandes`, `livraisons`, `facturation`,
`reglements`, `achats` (migration 0043 : commandes et règlements détachés, droits recopiés) ;
archiver / bloquer / supprimer = « Valider ». Stock (depuis le 03/10/2026, sans attendre la bascule) : `productStocks()`
= journal de l'entrepôt COMANET (dépôts internes vendables : produits vendus en direct + échantillons) + dernière photo de
chaque dépôt externe (`stockInternal`, `stockExternal`) ; « Stock réel » (`/gestion/stock`) ne montre que l'entrepôt
COMANET, « Stock & achats » (`/stock`) une colonne par dépôt et le total. Une photo exige un dépôt externe ; un export
Sage global sans dépôt n'entre plus dans le stock (contrôle de bascule seulement) ; une photo de distributeur ne touche plus aux prix des fiches.
Lot 2 livré : ventes. `sales_documents` + `sales_document_lines` (COMMANDE, BL, FACTURE, AVOIR), figées par triggers dès la
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
Lot 5 livré : règlements et bascule. `payments` (RG, figés par triggers) + `payment_allocations` (règlement ou avoir →
facture) + `payment_reminders` ; seul `src/lib/gestion/payments.ts` les écrit. Solde, balance âgée, relances, imputation
proposée : `receivables-shared.ts`. Un avoir s'impute sur sa facture à la validation. Bascule : `emitsReal()` (seule
source du « réel ou simulation »), `importBlockedByCutover()` (C5), page `/gestion/bascule` (`cutover.ts` : contrôles,
mode, rapport), reprise Sage (`importOpeningInvoices()`, source SAGE_REPRISE). Envoi au comptable : sélection multiple des pièces et ZIP de leurs PDF assemblé dans le navigateur (`piece-exporter.tsx`) + récapitulatif Excel du mois (`exports.ts`). Retours de tests : P.U. TTC sur le BL, nom du client imprimé corrigeable sur une pièce validée (`renameDocumentClient()`, seule clé `legalName` de l'identité figée, migration 0030), avoir financier sans origine (lignes libres par marque, motif sans retour).
Commandes clients (migration 0042) : type `COMMANDE`, série `BC` toujours réelle (pas une pièce fiscale), statuts
VALIDE (confirmée) → LIVRE_PARTIEL → LIVRE, `delivered_qty` par ligne ; saisie mobile avec produits habituels du client
(`/api/gestion/produits-habituels/[clientId]`), **sans remise** (le serveur force 0 ; la remise du client est posée sur le BL
préparé) ; `createBLFromOrder()` prépare un BL brouillon **entièrement modifiable**
(lignes `source_line_id` libres sur un BL, figées sur facture et avoir) ; la validation du BL fait avancer la quantité
livrée, son annulation la rend. Confirmer = Créer sur `commandes` (le commercial confirme sa saisie) ; « Préparer le
BL » = Créer sur `livraisons`. Portée OWN : seulement ses commandes (`isOwnOrder()` : saisie ou attribuée). Règles Action
Center `gestion-commandes-a-preparer`, `gestion-commandes-stock-insuffisant` ; seuil `settings.gestion.orderPrepAlertDays`.
Un point de vente, plusieurs raisons sociales (migration 0034) : `client_legal_entities` porte les raisons sociales
supplémentaires d'un client (l'identité de la fiche reste la principale) ; une pièce choisit l'entité facturée
(`sales_documents.legal_entity_id`, NULL = fiche), figée dans `client_snapshot` par `billingIdentity()`. Deux fiches du
même point de vente se fusionnent (`mergeClients()`, « Valider » sur Clients) : tout l'historique passe sur la fiche
gardée, le nom absorbé devient un libellé d'import, son identité une raison sociale ; refusée si la fiche absorbée porte
des pièces numérotées ou des règlements. Le **groupe** reste pour les enseignes à plusieurs magasins distincts.

**Médical v2 : chrono, GPS, ordonnances** (`docs/guide-visites-gps.md` pour les déléguées, migrations 0036-0038).
La déléguée travaille dans `/medical/journee` (mobile) : Démarrer → Terminer → compte rendu, ou « non effectuée ».
Chaque action passe par `/api/medical/visit-events` (route, pas server action : la file IndexedDB hors connexion la
rejoue par `fetch`, idempotente par `client_event_id`) et `recordAction()`. `visit_events` est en écriture seule
(triggers) ; la déléguée ne fournit jamais une heure (heure serveur, ou heure du téléphone recalée du décalage mesuré à
l'envoi). Statut de contrôle VERIFIEE / A_VERIFIER / NON_VERIFIEE / HORS_CONTROLE recalculé à chaque événement par
`verifyVisit()` ; seuils dans `settings.medicalField` (Médical → Paramétrage). Les visites antérieures sont
`AVANT_CHRONO` / `HORS_CONTROLE`. Position du cabinet : proposée au premier Démarrer (`gps_status = A_CONFIRMER`),
validée ou déplacée par la direction ou le manager sur la carte de `/medical/suivi` (Leaflet + OSM). GPS visible
seulement par les administrateurs et le `manager_id` de la déléguée (`field-access.ts`), jamais par « Valider » seul ;
les alertes Action Center terrain portent `fieldDelegateId` et sont filtrées dans `allRecommendations()`. Corrections :
`correctVisit()` (motif, événement CORRECTION, `audit()`), jamais sur une position. Clôture automatique : cron horaire
`/api/cron/medical` + à la lecture. Heures affichées : toujours `fmtTime()` côté serveur (le fuseau du navigateur peut
différer). Ordonnances : import `PRESCRIPTIONS` (liste blanche, colonne patient associée = import refusé), table
`prescriptions`, alias `doctor_aliases` / `product_aliases` / `client_aliases`, file de résolution
`/medical/ordonnances`. Potentiel AUTO jamais par-dessus une valeur MANUELLE. Analyses (segments, impact = corrélation
observée, tournée) : `/medical/analyses`. Copilote : `get_doctor_profile`, `get_field_control` (aucune coordonnée).
Test d'intégration : `MEDICAL_IT=1 DATABASE_URL=<base jetable> node --conditions=react-server --import tsx scripts/medical-integration.ts`.

**CRM commercial** (`docs/guide-crm-commercial.md`, plan `docs/plan-crm-commercial.md`, migration 0045). Portefeuille =
`clients.account_manager_id` (un commercial attitré par client, il entre dans sa portée « assignés ») ; fréquence de visite
`clients.visit_frequency_monthly` (NULL = non définie, hors progression ; 0 = ne pas visiter) ; visites `client_visits`
(PLANIFIEE, EN_COURS, EFFECTUEE, NON_EFFECTUEE, ANNULEE ; VISITE, APPEL, MESSAGE) ; le journal `visit_events` est partagé avec
le médical (`visit_id` OU `client_visit_id`, contrainte, triggers d'écriture seule) ; objectifs client = `objectives.client_id`
(hors des totaux par marque). Progression = visites effectuées du mois **plafonnées à la fréquence** de chaque client ; seuls les
types de `settings.crm.countedKinds` comptent (visite physique par défaut). Contrôle de présence : `verifyVisit()` avec la position
du point de vente (`clients.gps_*`, proposée au premier Démarrer, validée par la direction ou le manager `users.manager_id`) et les
seuils de `settings.crm`. Heures et positions : direction et manager seulement (`canSeePositions()`), jamais le copilote. Commande
« prise en visite » et relevé « fait en visite » sont **déduits** (`visitOutcomes()`), seul lien mesuré visite → vente. Écrans :
`/clients/tournee` (mobile, file hors connexion `fieldQueue("crm")`, route `/api/crm/visit-events`), `/clients/visites` (équipe, ville,
détail, carte, export), `/clients/portefeuilles` (affectation en masse, reprise depuis les droits), onglet « Suivi commercial » de la
fiche client. Aucun nouveau module de droits : tout sur `clients`. Règles Action Center : `src/lib/rules/crm-rules.ts` (alertes de
contrôle portées par `crmUserId`). Copilote : `get_client_portfolio`, `get_client_visits`.

**P&L** (`/gestion/pnl`, section du `docs/guide-gestion-commerciale.md`, migration 0031). Réservé aux administrateurs
(`requireAdmin()` : salaires). Compte de résultat mensuel HT : CA = ventes directes (sites de `settings.pnl.directSites`)
+ ventes en bloc aux distributeurs (`pnl_bulk_sales`, saisies à l'arrivage : Cospharma achète tout le stock Gamarde / Ainhoa)
+ commissions de prestation (taux × CA HT remisé du prestataire : PHARMAFIRST × 35 %). La revente des distributeurs (COS,
CAS…) est hors CA, affichée pour info. Coût des ventes : (quantité + UG) × `products.cost_price` ; sans prix d'achat, CA
signalé, jamais estimé. Marketing : `budgetConsumptionByMonth()` (même définition que le budget consommé). Charges :
`pnl_charges` PONCTUELLE ou MENSUELLE (début → fin), révision par clôture + nouvelle ligne ; postes dans
`pnl_charge_categories` (familles COMMERCIAL, PERSONNEL, STRUCTURE, FINANCIER, IMPOTS). Vue marque : frais communs non
répartis. N-1 des charges affiché seulement si des charges N-1 existent.

**Permissions modulaires par utilisateur** (`docs/permissions-modulaires.md`). Chaque compte porte
sa propre matrice `user_permissions` (19 modules × Voir / Créer / Modifier / Valider), une portée
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

**Marketing Operating System** (`docs/guide-marketing-os.md`, audit et plan `docs/plan-marketing-os.md`, migration 0044). La
boucle objectifs → plan → budget → allocation → actions → exécution → dépenses → résultats → analyse → réallocation, sans
second référentiel : le budget d'un plan EST la ligne `budgets` (marque × année), son CA objectif la ligne `objectives`
annuelle, son allocation par canal les `budget_lines`, sa consommation `budgetConsumption()`. Tables nouvelles :
`marketing_plans`, `marketing_plan_objectives`, `marketing_axes`, `marketing_plan_months`, `marketing_actions` (1:1 avec
une tâche `tasks` source MARKETING, `entity_type = 'marketing_action'` : responsable, échéance, priorité et statut y
vivent, `BLOCKED` ajouté à `task_status`), `marketing_decisions` (statut humain d'une décision : PROPOSED → APPROVED /
REJECTED → EXECUTED → MEASURED / EXPIRED, instantané de la recommandation). Colonnes de rattachement, NULL sur
l'historique et jamais fabriquées : `campaigns.axis_id`, `collaborations.axis_id`, `content_items.axis_id`,
`activations.axis_id`, `marketing_expenses.action_id`. Allocation proposée (`proposeAllocation()`, pure) = part réelle
N-1 par catégorie (dépenses engagées + régie, CONFIRMED) × ajustement par verdict de canal (`channelVerdicts()`),
seuils `settings.marketingPlan` ; sans historique suffisant « NON MESURABLE », jamais appliquée d'office. Couche de
décision unifiée (`src/lib/decisions/`) : aucun moteur modifié, adaptateurs purs ; approuver crée l'action et sa tâche,
refuser écarte aussi la recommandation de l'Action Center ; exécutée = tâche DONE, expirée = revue dépassée. Pages :
`/marketing` (Command Center : quoi pousser maintenant, budget, objectif, actions en retard, alertes), `/marketing/plan`
(+ `[id]`), `/marketing/priorites` (+ `[id]`), `/marketing/analytics/plan` (plan vs réel, lecture produit du moteur),
`/marketing/analytics/360` (ancienne vue d'ensemble). Règles Action Center : `plan-rules.ts` (actions en retard, plan sans
allocation, mois sans action). Agent : `get_marketing_plan`, `get_marketing_actions`, `get_unified_decisions`. Droits :
plan et actions via `marketing` (Créer / Modifier / Valider pour clôturer ou supprimer) ; allocation via `budgets`
Modifier ; enveloppe et CA objectif via « Valider une dépense » ou Administration (comme `saveBudget`).

**Générateur d'actions / Opportunity Center** (`docs/plan-action-generator.md`, guide dans `docs/guide-marketing-os.md`,
migration 0046). `/marketing/priorites` n'est plus une liste de tâches : « Opportunités du moment » (produit désigné par le
moteur de décision × meilleure action finançable, pourquoi maintenant), « Actions au plan » (objectif, budget, impact,
avancement des tâches, échéance, statut), bouton « + Générer une action » (`/marketing/priorites/generer` : marque,
objectif, levier, budget, période, cible, produit → 3 à 5 options ; fiche `/generer/[modèle]`). Une proposition sort de la
bibliothèque d'actions (`loadLibrary()`, 7 leviers) adaptée par `generate()` : budget
proposé dans le disponible du levier (alloué − engagé − réservé par les actions ouvertes ; sinon enveloppe ; sinon non
défini), détail poste par poste, rétroplanning daté avec responsable par rôle, contenus, KPI, résultat attendu
(hypothèses du modèle, INFERRED ; prix public réel ; coût par résultat Meta mesuré pour le digital ; sans prix, CA « non
mesurable »), score de pertinence détaillé, non-répétition (même modèle au plan = exclu ; réalisé récemment = malus).
Produit en risque de rupture = aucune option. La proposition est recalculée côté serveur à l'ajout (paramètres d'URL,
`params.ts`), jamais stockée avant : `addProposalToPlan()` crée en une transaction le plan (brouillon si absent),
l'activation (budget par poste, reflet comptable laissé au module Activations) ou la campagne (+ dépenses PLANNED
`action_id`), l'action (`createAction()`, source GENERATOR, `spec` figée, `template_key`, `activation_id`, `event_date`),
une tâche par étape (`source_key` `marketing-action:<id>:etape:<n>`) et les contenus. Annuler l'action annule ses tâches.
La répartition mécanique d'un budget mensuel en actions par canal a été supprimée (garde-fou dans
`definitions-uniques`). Agent : `generate_marketing_actions` (lecture seule).

**Bibliothèque d'actions** (`/marketing/bibliotheque`, migration 0047). Bibliothèque effective = `TEMPLATES` (60 modèles
livrés, 7 leviers : événementiel, trade, médical / prescripteurs, partenariats, digital, influence, contenu ; familles
comptoir, grossistes, calendrier marocain réservé à sa période par `onlyWhen`) + `action_templates` (même clé = modèle
livré modifié ou désactivé, rien n'est supprimé ; autres clés = modèles de l'équipe, d'un import Excel, d'une action ou
d'une activation réalisée). Nom et concept sont des textes à variables (`{heros}`, `{produit}`, `{marque}`, `{ville}`,
`{cible}`, `{benefice}`, `{actif}`, `{angle}`, `{saison}`, `{var|repli}`) : bénéfice et actif viennent de la fiche
marketing du produit. Formulaire et Excel partagent `TEMPLATE_COLUMNS` et une syntaxe texte (« J-30 ; libellé ; rôle »,
« libellé ; catégorie ; part % ; poste ») ; un modèle invalide est écarté du générateur et signalé « à corriger ».
« Enregistrer comme modèle » sur une action générée ou une activation : budget par poste, calendrier relatif à J,
produit / marque / ville remplacés par des variables. **Ce qui marche par marque** (`brand_marketing_playbooks`) : poids
des leviers, favoris, écartés, note ; critère de score de 10 points (favori 10, levier jusqu'à 7, écarté = exclu),
étiqueté INFERRED et affiché comme hypothèse de la direction, jamais comme une mesure. Seed : Auracos = grosse
influenceuse, Gamarde = conseil comptoir (vidéo médicale à tester), CygneLab = point de vente + digital, Alphascience =
médecins + un peu de point de vente. Droits : Marketing Modifier (créer, modifier, dupliquer, importer, enregistrer comme
modèle), Valider (désactiver, revenir à la version livrée, supprimer, ce qui marche par marque).

**Studio créatif / Intelligence contenu** (`docs/guide-studio-creatif.md`, migration 0048). Le générateur d'actions devient un
moteur créatif : DONNÉE → PRIORITÉ (moteur de décision marketing) → PRODUIT → TENSION CONSOMMATEUR → OPPORTUNITÉ → CONCEPT →
PACKAGE → BRIEF → PLANNING ÉDITORIAL → PERFORMANCE → APPRENTISSAGE. Aucun second référentiel : produit et priorité viennent de
`buildRecommendations()`, le budget de `loadGeneratorData()`, la fiche de `products`, la mémoire créative des créatives Meta
étiquetées (`autoTags()`), des contenus publiés (`content_items.reach / engagement`) et des collaborations ; le contenu produit est un
`content_items` ordinaire (brief complet, tâche du responsable). Tables : `creative_concepts` (empreinte territoire|mécanique|tension|
accroche|produit, score, statut PROPOSED → APPROVED / REJECTED → BUILT → SENT, lien `content_item_id`) et `creative_packages` ; seul
`store.ts` les écrit. Les opportunités sont recalculées à chaque lecture (clé rejouable). Taxonomie : 5 territoires, 38 mécaniques
avec métadonnées ; 22 tensions par catégorie (soin, dermo-cosmétique, solaire, complément) activées par les mots de la fiche, tension
par défaut sinon, jamais inventée. Scores = aide à la décision (dix critères /10, étiquetés), jamais une mesure ; apprentissages =
corrélations observées avec volume minimal. Conformité déterministe avant et après l'IA (`compliance.ts`) : un BLOCK interdit
l'envoi en production. IA par étapes séparées (`src/lib/ai/prompts/creative-*.md`, sortie structurée Zod via `runStage()`, mêmes
limites et suivi de coût que le copilote, surface « creative ») ; sans clé ou sur échec, squelette déterministe signalé
(`generatedBy: "RULES"`). Seuils dans `settings.creative`. Pages : `/marketing/studio` (opportunités, apprentissages, territoires
saturés), `/marketing/studio/opportunite/[clé]` (concepts : générer, approuver, écarter, construire), `/marketing/studio/concept/[id]`
(Content Studio, 11 onglets, variations, envoi au planning), `/marketing/studio/concept/[id]/brief` (imprimable). Droits : Marketing
Voir / Créer / Modifier. Agent : `get_creative_opportunities` (lecture seule).

**Prévision saisonnière** (`docs/guide-prevision-saisonniere.md`). Le stock cible et la commande conseillée ne reposent
plus sur la moyenne plate de 3 mois mais sur une **prévision mensuelle modélisée** : base désaisonnalisée des
`settings.forecast.baseMonths` derniers mois civils complets × indice saisonnier des événements de `settings.forecast.events`
(Ramadan à fenêtres explicites par année, saison solaire et rentrée récurrentes, coefficient et mots-clés de portée). Étiquetée
« modélisée » partout, jamais présentée comme une mesure ; aucune tendance n'est extrapolée ; un produit sans vente a une
prévision nulle. `avgMonthly` reste la rotation constatée. La page Paramètres affiche le **ratio observé** de chaque
événement (corrélation observée dans l'historique) à côté du coefficient saisi. `/stock/prevision` : tableau mensuel par
référence, regroupé par fournisseur (`supplier_brands`), bouton « Commander » qui ouvre `/gestion/achats/nouveau` pré-remplie
(quantités conseillées, dernier prix payé ou prix Exwork EUR) — la pièce n'est créée qu'à l'enregistrement.

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
`ANIMATIONS`, `ANIM_OBJECTIVES`, `ADS`, `MEDECINS`, `INVENTORY`, `INFLUENCERS`, `STOCK_INITIAL`, `PRESCRIPTIONS`
(ordonnances : aucune donnée patient, annulable), `VISITES_MEDICALES` (historique d'un CRM : clé `crm:<réf>`, visites
`HISTORIQUE` hors contrôle GPS, VM sans compte gardée en `delegate_label`, potentiel repris sur fiche vide, cabinet
proposé par `cabinetFromHistory()`, durée « 1 heure » = non mesurée ; migration 0039).
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
