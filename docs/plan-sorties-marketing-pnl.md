# Ventes en bloc, sorties marketing par BL et P&L réel — plan

Statut : **livré** sur `feat/sorties-marketing-pnl` (13/10/2026), décisions d'Hicham intégrées ; migration 0052.

## 1. Ce qui existe (inspection du 12/10/2026)

**P&L** (`src/lib/pnl-shared.ts` `buildPnl()`, `src/lib/pnl.ts`)
- CA = ventes directes (`sales`, sites COMANET / DESK DIGITAL) + ventes en bloc (`pnl_bulk_sales`, saisie à la main) + commission Pharmafirst (35 %).
- Coût des ventes directes = (quantité + UG) × `products.cost_price` ; en bloc = coût **saisi**.
- Marketing = `budgetConsumptionByMonth()` (dépenses engagées + régie + échantillons médicaux `sample_movements` SORTIE_VISITE), **un seul total, sans détail**.
- Soldes : marge brute → contribution (− marketing − charges commerciales) → EBE (− personnel − structure) → résultat net. Aucune ligne n'est cliquable.

**Pièces de vente** : `sales_document_lines.product_id` seul (lignes libres possibles pour les avoirs financiers). Le BL sort le stock (`recordStockMovements()`), l'annulation passe des contre-mouvements, la projection écrit `sales` pour les marques de « Ventes depuis les pièces ».

**Matériel** : `inventory_items` (stock entier, `unit_cost`), `inventory_movements` (déjà `client_id`), `inventory_categories` PLV / ÉCHANTILLON / GOODIE / PRINT → `budget_category` (PRINT → PLV). Seule écriture du stock : `recordMovement()`. Une sortie pour activation (`consumeMaterial()`) devient une dépense `marketing_expenses` (`activation_ref = MATERIAL:…`).

**Données de prod constatées**
| Fait | Conséquence |
|---|---|
| Cutover = **OFF** jusqu'au 01/01/2027 : les 30 factures / avoirs / BL existants sont **tous en simulation**. | Si l'on exclut la simulation, le CA en bloc est nul jusqu'à la bascule (décision 1). |
| `pnl_bulk_sales` 2026 : 3 ventes Gamarde à COSPHARMA STE = **2 369 555 MAD HT**, coût saisi 853 500. La vente du 23/04 (671 700) a un coût de **33 500** : probable faute de frappe (335 000 ?). | Retirer cette table du calcul fait disparaître 2,37 M de CA 2026 si rien ne la remplace. |
| COSPHARMA STE existe déjà (type AUTRE, canal « VENTE EN BLOC », 0 pièce, 0 vente). COSPHARMA le grossiste (code C4536, 1 073 lignes, 1,59 M) est une fiche distincte. | Le réglage pointera COSPHARMA STE par son id ; le grossiste n'est pas touché. |
| `échantillons animation` et `échantillons digital` : type PHARMACIE, aucune pièce, aucune vente. | Passage en AUTRE + interne + nature. |
| **Doublon `ECHANTILLON`** : 103 lignes de ventes Sage du site **PHARMAFIRST** (2025-2026, montant 0, 1 061 unités) + **2 BL brouillons** des 08 et 09/10/2026. Il existe aussi **`ECHANT DM OUMAMA ABOU`** (1 ligne Sage). | Signalés, non supprimés. Les 2 BL brouillons doivent être réaffectés au bon client « Échantillons … » (à toi de dire lequel). |
| Matériel : 9 articles (8 goodies Gamarde / Ainhoa, 1 PLV Auracos), **2 à coût 0** (Osmoseur Filtre, White Jade Facial Roller). Trousses GAMARDE : 771 en stock à 15 MAD. | Ces 771 trousses ont **déjà été passées en charge à l'achat** (« Trousses Gamarde » 31 200 SPENT, « TROUSSE GAMARDE » 36 000) : les sortir par BL au coût compterait deux fois (décision 3). |
| Échantillons délégués 2025 saisis en dépenses mensuelles (≈ 450 k) ; `sample_movements` : 70 entrées, 2 sorties visite en 2026. | Une dotation délégué par BL puis une remise en visite compteraient deux fois (décision 4). |
| Produits actifs sans coût de revient : Dulcima 8/8, Gamarde 8/30, Alphascience 1, Makari 1. | Coût manquant signalé (P&L et validation), jamais estimé. |

## 2. Décisions d'Hicham (12/10/2026)

1. **CA en bloc** : règle stricte (factures réelles − avoirs réels uniquement) **et reprise des 3 ventes 2026** en factures réelles
   `SAGE_REPRISE` avec leurs lignes (produit, quantité, prix, remise) pour que le coût se calcule. `pnl_bulk_sales` sort du calcul.
   Conséquence assumée : une vente en bloc facturée dans COMANET OS avant le 01/01/2027 sera en simulation, donc hors P&L,
   tant qu'elle n'est pas reprise de la même façon.
2. **Sorties marketing en simulation : comptées.** La charge suit le mouvement de stock réel, simulation ou non.
3. **Matériel : charge à l'achat, toujours.** Un BL de matériel trace la sortie (stock, client, nature, valeur au coût figé,
   historique) mais ne crée **aucune** charge marketing. Goodies et PLV restent dans le P&L par leurs dépenses d'achat.
4. **Échantillons médicaux : charge à la dotation, par BL.** À partir de la date de démarrage des sorties par BL
   (`marketingOutputs.from`), les remises en visite (`sample_movements`) restent suivies mais ne sont plus valorisées dans le budget.

## 3. Modèle de données — migration 0051 (une seule)

- `marketing_output_natures` (key, label, sort, active) : ANIMATION, MEDICAL, DIGITAL (influence + UGC), COMMERCIAL ; modifiable dans Paramètres → Gestion.
- `clients.is_internal` (bool, défaut false) + `clients.output_nature_key` (→ natures). Contrainte : nature obligatoire si interne.
- `sales_document_lines.inventory_item_id` (→ `inventory_items`) + `unit_cost` (coût unitaire **figé à la validation**) ; contrainte `CHECK (product_id IS NULL OR inventory_item_id IS NULL)`.
- `sales_documents.activation_id` (facultatif) : rattache une sortie à une activation.
- `inventory_movements.document_line_id` + `reversal_of` (annulation = contre-mouvement, jamais une suppression).
- `marketing_expenses.document_line_id` (unique partiel), `client_id`, `output_nature` — utilisés pour les échantillons **produits** seulement (décision 3).
- Réglages (pas d'id en dur) : `settings.gestion.bulkSales = { clientId, from }` et `settings.gestion.marketingOutputs = { from, insufficientStock: BLOCK | WARN }`.
- Ajout au journal `drizzle/meta/_journal.json`.

## 4. Lots

### Lot A — Ventes en bloc depuis les pièces
- **Une définition** : `bulkSalesAgg()` dans `pnl.ts` = lignes des FACTURES validées − lignes des AVOIRS validés du client du réglage, HT net (`net_ht` de ligne), à la date de la pièce, statut ∉ {BROUILLON, ANNULE}, hors simulation (selon décision 1). Le BL n'est jamais lu : seule la facture compte, donc un BL facturé ne compte qu'une fois.
- Coût = (quantité + UG) × `products.cost_price` des lignes de facture ; avoir **avec retour** = coût négatif ; avoir financier = CA seul. Sans coût de revient : CA signalé « coût manquant ».
- Les BL et avoirs de COSPHARMA STE ne sont **jamais projetés** dans `sales` (sinon ils tomberaient en ventes directes) et `salesAgg()` exclut ce client.
- `pnl_bulk_sales` : table gardée, retirée du calcul, écran `/gestion/pnl/ventes-bloc` masqué (lien retiré, page en lecture seule pour l'historique).
- **Reprise des 3 ventes 2026** : `importBulkInvoices()` (dans `documents.ts`, à côté de `importOpeningInvoices()`) crée des FACTURES
  `SAGE_REPRISE`, `is_simulation = false`, avec lignes calculées par `computeDocument()`, sans mouvement de stock (la marchandise est sortie
  avant le journal) ni projection. Idempotent par numéro Sage. Données à fournir : numéro, date, lignes (réf. produit, quantité, UG, PU HT,
  remise), et si la facture est réglée.
- Avoir financier : ses lignes n'ont pas d'article, donc pas de marque → « Sans marque » dans la vue par marque, signalé.

### Exclusion des clients non commerciaux (A4 + B12)
- **Une fonction** `nonCommercialClientIds()` / fragment `COMMERCIAL_CLIENT_SQL` (dans `analytics.ts`, à côté de `ORDER_KEY`) : clients internes + client « vente en bloc ».
- Appliquée dans : `whereClause()` de `analytics.ts` (Ventes, classements, Cockpit), `clientIntel()` de `clients.ts` (segments), CRM (`portfolio`, `intelligence`, `timeline`), outils du copilote (`ai/tools/deps.ts`), règles Action Center qui lisent `sales`. La projection n'écrit plus rien pour ces clients.
- « Proposition IA » n'existe pas dans le dépôt : c'est la skill `proposition-client-comanet`. Si elle lit par les outils de l'agent, l'exclusion la couvre ; sinon, à me préciser.
- COSPHARMA (grossiste C4536) : intact.

### Lot B — Sorties marketing par BL
1. **Fiche client** : case « Client interne (sorties marketing) » + nature. Nettoyage (après ton accord, en prod) : `échantillons animation` → AUTRE / interne / ANIMATION ; `échantillons digital` → AUTRE / interne / DIGITAL ; création de « Échantillons médical » (MEDICAL) et « Échantillons commercial » (COMMERCIAL). `ECHANTILLON` et `ECHANT DM OUMAMA ABOU` : présentés, rien modifié.
2. **Saisie du BL** : une seule recherche sur produits + matériel, badge **Produit** / **Matériel**, stock disponible affiché. Ligne matériel : quantité seule, prix 0, TVA 0, imprimée « Offert » sur le PDF.
3. **Validation** (`validateDocument()`, même transaction) :
   - ligne produit : sortie de stock existante (FEFO) ; si client interne, `unit_cost` figé = `products.cost_price` ;
   - ligne matériel : `recordMovement()` SORTIE (client, date du BL, `document_line_id`, coût figé = `unit_cost` de l'article) ; stock insuffisant = blocage ou alerte selon `marketingOutputs.insufficientStock` ; **aucune charge** (décision 3) ;
   - coût 0 ou manquant : alerte affichée avant validation et signalée dans le P&L (jamais bloquant, jamais estimé) ; produit **sans marque** : blocage (une dépense marketing a toujours une marque) ;
   - client interne : pas de contrôle « vente à perte » / remise, pas de facturation possible (`createInvoiceFromBLs()` refuse), pas de projection dans `sales`.
4. **Comptabilisation** : nouveau module `src/lib/gestion/marketing-outputs.ts`, **seul écrivain** des `marketing_expenses` à `document_line_id` : une dépense SPENT par ligne **produit** d'un client interne = (quantité + UG) × coût figé, catégorie ÉCHANTILLONS, marque du produit, nature du client, `client_id`, `activation_id` si le BL est rattaché. Simulation comprise (décision 2). Un goodie / PLV offert à un vrai client (point 10) : aucune charge (déjà à l'achat), la sortie est tracée avec le client et la nature COMMERCIAL.
   - Échantillons médicaux (décision 4) : `budget.ts` cesse de valoriser `sample_movements` SORTIE_VISITE à partir de `marketingOutputs.from`.
5. **Annulation du BL** : contre-mouvements matériel (`reversal_of`), suppression des dépenses de la pièce (le BL reste au statut Annulé, comme les ventes projetées aujourd'hui).
6. **Activations** : un BL rattaché alimente l'activation (bloc « Sorties par BL » sur sa fiche, compté dans son réalisé). `syncActivationExpenses()` ne touche que les lignes `activation_ref` non nulles : aucune collision.
7. **Matériel** : fiche article → historique de consommation (date, BL, client, nature, quantité, coût) et cumul par nature.

### Lot C — P&L réel
```
CA net                          directes + en bloc (pièces) + commissions
− Coût d'achat                  directes + en bloc
= Marge brute (+ taux)
− Marketing réel                Publicité (régie, sinon saisie)
                                Échantillons — animation / médical / digital / commercial
                                Goodies · PLV & print · Influence & UGC · Activations (autres postes) · Autres
= Contribution marketing
− Personnel
− Frais                         charges commerciales + structure
= EBITDA
− Financier − Impôts
= Résultat net                  (gardé sous l'EBITDA)
```
- Goodies, PLV & print = dépenses d'achat (décision 3) ; échantillons par nature = sorties par BL + échantillons saisis avant `from` (nature « non renseignée »).
- Le détail marketing vient de `budgetConsumptionByMonth()` qui renvoie désormais une **ventilation** (fonction pure `marketingBucketOf()` dans `budget.ts`), dont la somme reste égale au consommé officiel : budget, Command Center et P&L restent d'accord.
- Par mois et par marque (filtre existant + tableau de contribution par marque enrichi du détail marketing).
- **Drill-down** : chaque cellule est un lien vers `/gestion/pnl/detail?ligne=…&mois=…&marque=…` (`pnlLineSources()`) : factures / avoirs, BL, lignes importées (par facture Sage), dépenses (lien BL, activation, campagne, collaboration), dépense régie par campagne, charges.

## 5. Tests
- Unitaires (`npm test`, sans base) : `buildPnl()` facture + avoir (avec et sans retour), pièce en simulation exclue, aucune double prise avec `pnl_bulk_sales`, ventilation marketing = total officiel, `marketingBucketOf()`, EBITDA.
- Intégration (`GESTION_IT=1`, base jetable PGlite) : BL « échantillons digital » avec 1 produit + 1 goodie → stock produit et stock matériel diminuent, aucune ligne `sales`, dépense = Σ qté × coût figé, bonne nature / catégorie / marque ; annulation → stocks rétablis, dépenses retirées ; contrainte « produit OU matériel » refusée par la base ; coût 0 signalé ; goodie à 0 sur un vrai client → charge COMMERCIAL avec `client_id`.
- Décisions : BL échantillon digital produit + goodie → seule la ligne produit crée une charge ; sample_movements après `from` non valorisés ; reprise des factures en bloc idempotente.
- `tests/definitions-uniques.test.ts` : seul `marketing-outputs.ts` écrit les dépenses à `document_line_id` ; seule `nonCommercialClientIds()` définit l'exclusion.

## 6. Vérification sur la prod (lecture seule, avant tout merge)
P&L 2026 avant / après ligne à ligne, CA en bloc reconstitué, contrôle « COSPHARMA grossiste inchangé », liste des clients exclus et de ce qu'ils retirent des classements. Les écritures en prod (nettoyage des clients, réglages) seulement après ton accord explicite.

## 7. Découpage proposé
Une branche `feat/sorties-marketing-pnl`, trois commits (A + exclusion, B, C), une PR, migration 0051 à appliquer par toi via `/installation`.

## 8. Activations alignées (décision d'Hicham, 12/10/2026)
`consumeMaterial()` (Activations) créait une dépense `MATERIAL:<catégorie>` à la sortie du matériel, ce qui comptait deux fois un
goodie déjà passé en charge à l'achat. Aligné : la sortie pour activation reste tracée et valorisée dans `activation_materials`
(coût complet de l'activation), sans dépense ; la migration 0052 retire les anciens reflets `MATERIAL:` (aucun en prod au 12/10/2026).

## 9. Reste à faire après le merge
- Appliquer la migration 0052 (`/installation`).
- Paramètres → Gestion : client « vente en bloc » = COSPHARMA STE ; date « Sorties marketing par BL depuis le ».
- Fiches clients : `échantillons animation` / `échantillons digital` en clients internes ; créer « Échantillons médical » et
  « Échantillons commercial ». `ECHANTILLON` (Pharmafirst, 2 BL brouillons) et `ECHANT DM OUMAMA ABOU` : laissés tels quels.
- Reprise des 3 ventes en bloc 2026 (`scripts/reprise-ventes-bloc.ts`) avec les lignes des factures Sage.
