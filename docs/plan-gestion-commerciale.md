# Gestion commerciale — plan d'architecture (remplacement de Sage)

Plan rédigé le 24 septembre 2026 sur `main` (`8156b63`), après lecture du code et de la base de production
(requêtes en lecture seule), et des deux mises en page Sage de la facture FA202600198 (13/07/2026).
**Statut au 24/09/2026 : plan validé par Hicham (D1 à D10), lot 1 livré** (voir `docs/guide-gestion-commerciale.md`).

Réponses d'Hicham :
- **Q1** — seuls COMANET et DESK DIGITAL passent sur COMANET OS ; les autres sites restent importés.
- **Q2** — décisions D1 à D10 validées.
- **Q3** — du stock COMANET est confié à des distributeurs : **Cospharma** distribue Gamarde, **Pharmafirst**
  distribue Auracos ; leur stock arrivera par import. → dépôts EXTERNES (photo importée), à côté des dépôts
  INTERNES suivis par le journal. Les données montrent aussi que COMANET facture Gamarde en direct (85 lignes en
  2026) et que le site COS vend de l'Ainhoa : le stock se lit donc **par dépôt**, pas par marque.
- Clients et articles : « déjà dans l'application » — mais sans identité légale ni référence COMANET ; la page
  Préparation liste ce qui manque et l'import accepte les nouvelles colonnes.
- Logo et cachet : extraits de la facture FA202600198, stockés en base (le dépôt est public).

Règle de lecture, comme pour les plans précédents : tout ce qui existe est **étendu**, jamais refait. Chaque
nouvelle notion a une seule fonction officielle, ajoutée au tableau de `CLAUDE.md` et gardée par
`tests/definitions-uniques.test.ts`.

---

## 1. Ce que la base de production change au brief

### 1.1 Le fichier « ventes Sage » mélange trois systèmes de numérotation

| Site(s) dans `sales.site` | Numérotation observée en 2026 | Lignes | Ce que j'en lis |
|---|---|---|---|
| **COMANET**, **DESK DIGITAL** | `FA202600261`, `BL202600600`, `AV202600038` — les BL des deux sites s'entrelacent dans la même série | 2 970 + 41 | Le Sage de COMANET. La facture fournie FA202600198 y figure. |
| COS, CAS, CAG, DAG, CMR | `LVC2601COS00…`, `FAC2607COS00298`, `FAN…` ; 25 commerciaux ; codes clients `C0014…C6359` ; codes articles `535010008…` | 4 840 + 975 + 14 | Un autre système (distributeur ou dépositaire ?) |
| PHARMAFIRST | `FA260725`, `BL262092`, `AV260028` ; en 2026, 1 seul produit vendu à 94 clients | 813 | Un autre système (grossiste ?) |

**Conséquence :** la règle du brief « avant la date = Sage, après = COMANET OS » ne peut pas s'appliquer à
toutes les ventes. Seuls les sites **émis par COMANET** passent sur COMANET OS ; les autres continueront
d'arriver par import. La bascule porte donc une **date et une liste de sites** (réglables). → Question Q1.

### 1.2 Les codes en base ne sont pas ceux du Sage de COMANET

- Sur la facture, le client porte le code **« 056 »** et une raison sociale ; en base, la même facture est
  rattachée à un client fonctionnel d'un autre nom (code `C…` du fichier distributeur, libellé Sage exporté différent).
- Sur la facture, les articles sont **CYG01 / CYG04**. En base, BEAUTY BOOST et SWEET DREAMS n'ont pas de `sku`.
  Les 46 `sku` existants sont au format `535010008`, celui du système COS.
- Seuls 240 des 542 clients ont un code et 46 des 98 articles un `sku`. **Aucune fiche n'a d'ICE, d'adresse ni de conditions de paiement.**

→ Le code tiers Sage de COMANET et le code article COMANET entrent dans **de nouvelles colonnes**. On n'écrase
pas `clients.code` ni `products.sku`, qui servent au rapprochement des imports distributeurs.

### 1.3 Un client en base est un point de vente, pas une raison sociale

`clients` est un client **fonctionnel**. 79 fiches regroupent de 2 à 38 libellés bruts (`client_aliases`), alors
qu'une facture exige **une** identité légale (raison sociale + ICE). Bonne nouvelle : seuls **75 clients** et
**87 articles** ont été facturés par COMANET ou DESK DIGITAL sur 12 mois. C'est le vrai périmètre de la reprise
(ICE, adresses, conditions), pas les 542 fiches.

### 1.4 L'arrondi du papier Sage diffère de l'export Sage

Pour la même ligne (BEAUTY BOOST, FA202600198), le papier imprime **746,24** et `sales` contient **746,25**.
L'export Sage porte le prix net non arrondi (124,375 × 6). La règle du §5 reproduit le papier au centime près.
Le rapport de contrôle de la période parallèle devra donc expliquer ces écarts d'un centime par ligne sur l'historique.

### 1.5 Volumes

En 8,5 mois de 2026, le Sage de COMANET a émis environ 261 factures, 600 BL et 38 avoirs, soit **~100 documents
par mois**. Un PDF figé de ~80 Ko représente ~100 Mo par an en base (la base fait 130 Mo aujourd'hui) : c'est
acceptable. `assets.ts` reste le seul module à modifier pour passer plus tard à un stockage objet.

---

## 2. Décisions d'architecture (à valider)

| # | Décision | Pourquoi | Alternative écartée |
|---|---|---|---|
| **D1** | `sales` reste **la** table du sell-in. On lui ajoute `source` (`SAGE` pour les lignes existantes, `COMANET_OS`) et `document_line_id`. Chaque BL et chaque avoir validé y est **projeté** par une seule fonction. | 30 fichiers lisent `sales`, 40 autres via les fonctions partagées : aucun ne change. La table porte déjà les colonnes nécessaires (`invoice_ref`, `lvc_ref`, `site`, `sales_rep`). | Transformer `sales` en vue UNION. Quatre écritures cassent (insert `ON CONFLICT`, suppression au rollback, `mergeProduct`, `TRUNCATE`), `fact_sales` resterait lié à l'ancienne table, et la RLS comme les cascades seraient perdues. |
| **D2** | On **étend `clients`** : `name` = nom commercial, plus `legal_name`, `ice`, `if_number`, `rc`, `patente`, adresse, conditions. L'identité client et société est **figée sur chaque document** au moment de la validation. | Le brief demande « raison sociale + nom commercial » sur la fiche client. On évite ainsi un second référentiel clients. | Une table « comptes de facturation ». Elle dupliquerait la notion de client. |
| **D3** | On **étend `products`** : code COMANET, EAN, taux de TVA, unité, colisage, suivi des lots, nature `PRODUIT` / `SERVICE`. **Le matériel marketing reste dans `inventory_items`** (module Activations). | Une nature `MATERIEL_MARKETING` dans `products` créerait un second référentiel du matériel. Les achats de goodies et de PLV passent par `recordMovement()`, déjà seul autorisé à écrire ce stock. | La 3ᵉ nature d'article prévue par le brief. |
| **D4** | Stock = journal `stock_movements`, **sans solde stocké**. Stock = Σ mouvements, stock à une date = Σ mouvements datés ≤ date. `productStocks()` change de source à la bascule, en un seul endroit. `products.cost_price` devient le **CMUP courant**, tenu par les réceptions. | La vingtaine d'appelants de `productStocks()` (Cockpit, règles, marketing-intel, IA, Ads) reçoivent le stock réel sans modification. Marges et valeur de stock restent justes. | Réécrire les lecteurs un par un. |
| **D5** | Deux paires de tables : `sales_documents` / `sales_document_lines` (BL, facture, avoir, retour) et `purchase_documents` / `purchase_document_lines`. Le statut n'est écrit que par une fonction `transition…()`, comme pour Contenus et Activations. **L'immuabilité est garantie par des triggers Postgres**, pas seulement par le code. | Une seule mécanique pour la numérotation, le PDF, l'audit et les liens entre documents : c'est le modèle Sage (en-tête + lignes, type de pièce). | Une table par type de document. |
| **D6** | Montants calculés dans un module **pur**, en **entiers** (BigInt : centimes, millièmes d'unité, centièmes de pourcentage). Colonnes `numeric`. **Aucun float**, aucun `parseFloat` sur un montant (gardé par un test). | Le brief l'exige et c'est vérifiable. | decimal.js : dépendance inutile. |
| **D7** | PDF par `@react-pdf/renderer`, généré côté serveur. **Nous calculons nous-mêmes la pagination** (lignes par page), ce qui rend le report des totaux exact et testable. À la validation, on fige le PDF **et** un instantané JSON (société, client, lignes, totaux, version du modèle), stockés via `assets.ts`. | Il n'existe aujourd'hui que `window.print()`. Un Chromium sur Vercel est trop lourd. | Playwright ou Puppeteer côté serveur. |
| **D8** | Trois modes : `OFF` → `PARALLELE` → `ACTIF` (§9). En parallèle, les documents sont des **simulations** : série à part, filigrane, rien de projeté dans les ventes. | Pendant le mois parallèle, un seul système doit émettre les pièces légales, et ce doit être Sage. | Numéroter pour de vrai dès le mois parallèle : on aurait des doublons de numéros avec Sage. |
| **D9** | Le journal d'audit réutilise **`audit_logs`**. La table existe, mais rien n'y écrit jamais. `src/lib/audit.ts` devient son seul écrivain. | La règle « ne pas reconstruire l'existant ». | Une nouvelle table d'audit. |
| **D10** | Date de bascule recommandée : **1ᵉʳ janvier 2027**, avec la période parallèle en décembre 2026. | Les séries FA2027 / BL2027 démarrent à zéro, sans reprise de séquence en cours d'année. L'inventaire annuel du 31/12 sert de stock initial. L'exercice 2027 est entièrement dans un seul système. | Une bascule en cours d'année (possible, avec le « prochain numéro » réglable). |

---

## 3. Conflits avec l'existant

| # | Où | Conflit | Traitement | Lot |
|---|---|---|---|---|
| C1 | `CLAUDE.md`, en-tête de `schema.ts` | « Sage reste la source de vérité ; COMANET OS n'écrit jamais dedans » | On réécrit le principe : COMANET OS devient la source des pièces émises par COMANET ; les imports restent la source des autres sites. | 1 |
| C2 | `sales.site` | Trois systèmes émetteurs (§1.1) | Bascule par site (`settings.gestion.cutover.sites`) | 5 (le modèle est posé dès le lot 1) |
| C3 | `src/lib/ref-date.ts` | `ref = min(aujourd'hui, max(sales.date))`. Les ventes COMANET OS, en temps réel, pousseraient la date de référence à aujourd'hui et masqueraient le retard de 2 semaines des imports | La date de référence ne lit que les sources importées (`source = 'SAGE'`) tant qu'il en reste. Le bandeau « données à jour au … » affiche les deux dates. | 2 |
| C4 | `ORDER_KEY` (`analytics.ts:56`) | Clé = `invoice_ref`. Une facture qui regroupe 4 BL compterait 1 commande au lieu de 4 et fausserait le rythme de commande des clients | Pour `source = 'COMANET_OS'`, la clé devient le n° de BL. On modifie la définition officielle et son test. | 2 |
| C5 | `importSales()` / `line_hash` | Une pièce COMANET OS réexportée par Sage aurait un autre hash : elle serait comptée deux fois | Après la bascule, les lignes des sites basculés datées d'après la date de bascule sont **refusées** avec un message explicite | 5 |
| C6 | `workbook.ts:37` `resetImportedData` | `TRUNCATE … products, clients CASCADE` viderait toutes les pièces et tout le journal de stock | Refus dès qu'une pièce ou un mouvement existe | 1 |
| C7 | `rollback.ts` (produits et clients orphelins), `produits/actions.ts` `mergeProduct` | Suppression ou fusion d'un article ou d'un client qui a des pièces | Nouvelles clés étrangères en `ON DELETE RESTRICT`. La détection d'orphelins connaît les nouvelles tables. La fusion est refusée si l'article source a des pièces ou des mouvements. | 1 |
| C8 | `clients` | Point de vente et raison sociale confondus (§1.3). `clients.code` n'est pas le code Sage COMANET | D2 + écran de reprise : rapprochement par code, ICE ou nom, doublons, scission d'un client fonctionnel qui regroupe plusieurs ICE | 1 |
| C9 | `products` | `sku` ≠ réf COMANET. 5 articles ont un « prix COMANET » supérieur au PPH (ex. Beauty Boost : 249 contre 199). La sémantique du prix de base est à fixer (Q10) | Nouvelle colonne `code`. Liste des incohérences dans le rapport de reprise. | 1 |
| C10 | `productStocks()` + une vingtaine d'appelants | Stock = dernière photo importée (3 photos en tout en prod), commandes en cours saisies à la main | Source = journal quand `stockSource = LEDGER`. Commandes en cours = commandes fournisseurs ouvertes. Les appelants ne changent pas. | 1 (activé à la bascule), 3 |
| C11 | Vitesse de sortie (`stock.ts:64`) | Elle est calculée sur **tous** les sites, distributeurs compris. Si COS et PHARMAFIRST revendent du stock déjà sorti de chez COMANET, la couverture est fausse | Après la bascule, la vitesse = sorties réelles du journal (BL + UG). À confirmer avec Q1. | 3 |
| C12 | Échantillons médicaux (`sample_movements`) | Une remise d'échantillons à une déléguée ne diminue pas le stock entrepôt | La remise crée un mouvement `ECHANTILLON_MARKETING` dans le journal | 2 |
| C13 | `inventory_items.stock` (Activations) | Solde stocké, contraire au principe du journal | On le garde (seul écrivain, verrou de ligne). Contrôle de cohérence solde = Σ mouvements dans l'écran Matériel. | 3 |
| C14 | `clients/actions.ts:13` `updateClient` | Protégé seulement par « Voir » (`requireAccess`) | `requirePermission("clients", "edit")` | 1 |
| C15 | `/clients` | Impossible de créer un client dans l'interface (seul l'import le peut) | Création, archivage, suppression si aucune pièce | 1 |
| C16 | `ui.tsx` | Pas de composant tableau. Chaque liste est un `<table className="tbl">` écrit à la main | Composant `DataTable` : tri, filtres, recherche, colonnes, pagination serveur, cartes sur mobile | 1 |
| C17 | Recherche | Deux copies des requêtes (`search.ts` et `/recherche`) | On ajoute les pièces (n° FA/BL/AV) et les fournisseurs, et on unifie les deux copies au passage | 2 |
| C18 | `fmtMAD` | Arrondit à 0 décimale | `fmtMoney2()` pour les pièces (format « 1.790,98 » comme Sage) | 2 |
| C19 | Permissions | Liste de modules fermée. Le seed des modèles de rôle ne se rejoue pas | Migration qui ajoute les modules, les droits admin et le modèle « Magasin » (§10) | 1 |
| C20 | `client_type` (enum) | Le brief veut une liste réglable | On garde l'enum (ses 4 valeurs sont exactement la liste du brief). Passer à une table de référence toucherait les analyses. | — |
| C21 | Supabase, pooler transactionnel (6543) | Les verrous consultatifs de session y sont inutilisables | Verrous de ligne (`FOR UPDATE`) dans la transaction de validation | 1 |
| C22 | Métriques et textes « Sage » (`metrics_definitions` SELL_IN, messages de l'IA « aucune vente Sage ») | Libellés devenus faux | « Sell-in (Sage + COMANET OS) » | 5 |

---

## 4. Modèle de données

Conventions : migrations écrites à la main et idempotentes (`0025_…` et suivantes, ajoutées au journal), RLS
activée comme sur les autres tables, `ON DELETE RESTRICT` vers `clients`, `products` et `suppliers`, horodatages
`timestamptz`.

### Lot 1 — fondations

| Table | Nouvelle / modifiée | Contenu |
|---|---|---|
| `clients` | modifiée | `sage_code` (unique si non nul), `legal_name`, `ice`, `if_number`, `rc`, `patente`, `billing_address`, `postal_code`, `email`, `contact_name`, `account_manager_id → users`, `default_discount_pct`, `price_list_key`, `payment_mode_key`, `payment_days`, `credit_limit`, `blocked`, `blocked_reason`. L'archivage réutilise `active`. |
| `client_delivery_addresses` | nouvelle | libellé, adresse, ville, par défaut |
| `client_brand_discounts` | nouvelle | client × marque → remise % |
| `products` | modifiée | `code` (réf COMANET, unique), `ean` (unique), `kind` (`PRODUIT`/`SERVICE`), `tax_rate_key`, `unit`, `pack_size`, `track_lots`, `last_purchase_price`. `price_wholesale` devient le « prix de vente HT de base » (Q10) et `cost_price` le CMUP (lot 3). |
| `suppliers` | nouvelle | `code`, `legal_name`, `nature` (`MARCHANDISES` / `HORS_STOCK`), `ice`, `if_number`, `country`, `currency`, contact, `payment_days`, `payment_mode_key`, `active` |
| `supplier_brands` | nouvelle | fournisseur × marque |
| `tax_rates`, `payment_modes`, `price_lists`, `warehouses` | nouvelles (référentiels) | modifiables dans `/parametres/gestion`. Dépôts `PRINCIPAL` et `NON_VENDABLE` créés d'office (Q3). |
| `stock_lots` | nouvelle | article, n° de lot, date de péremption ; unique (article, lot) |
| `stock_movements` | nouvelle | `product_id`, `lot_id`, `warehouse_key`, `type` (`STOCK_INITIAL`, `ENTREE_ACHAT`, `SORTIE_BL`, `RETOUR_CLIENT`, `RETOUR_FOURNISSEUR`, `AJUSTEMENT_INVENTAIRE`, `CASSE_PERIME`, `ECHANTILLON_MARKETING`, `TRANSFERT`), `quantity numeric(12,3)` signée, `unit_cost`, `cmup_after`, `date`, `source_type` + `source_id` + `source_line_id`, `reversal_of`, `import_id`, `created_by`. **Aucune mise à jour ni suppression (trigger).** |
| `document_series`, `document_sequences` | nouvelles | série (type, format, remise à zéro annuelle), compteur par (série, année) |
| `audit_logs` | réutilisée | premier écrivain : `src/lib/audit.ts` |
| `settings.gestion` | nouvelle section | identité société (raison sociale, adresse, téléphone, capital, RC, ICE, IF, CNSS, TP, RIB), mode et date de bascule, sites basculés, politique de stock insuffisant, modèle d'impression, délais de paiement, seuils |

### Lot 2 — ventes

| Table | Contenu |
|---|---|
| `sales_documents` | `type` (`BL`, `FACTURE`, `AVOIR`, `RETOUR`, plus plus tard `DEVIS` et `COMMANDE`), `status`, `number` (nul tant que brouillon), `series_key`, `fiscal_year`, `date`, `client_id`, `client_snapshot jsonb`, `company_snapshot jsonb`, `delivery_address`, `site` (canal projeté dans `sales.site`), `sales_rep_id`, `payment_mode_key`, `payment_days`, `due_date`, `global_discount_pct`, totaux (`gross_ht`, `net_ht`, `vat_total`, `ttc`), `vat_breakdown jsonb`, `amount_in_words`, `reason_key` (motif d'avoir), `origin_document_id`, `approvals jsonb` (dépassements levés : qui, quand, quoi), `is_simulation`, `source` (`COMANET_OS` / `SAGE_REPRISE`), `validated_by/at`, `cancelled_by/at/reason`, `pdf_asset_id`, `content_hash`. Champs prévus pour la facturation électronique DGI, laissés vides : `einvoice_uid`, `einvoice_status`, `einvoice_payload`. |
| `sales_document_lines` | `position`, `product_id` (nul pour une ligne libre ou un service), `lot_id`, `warehouse_key`, `ref` et `designation` figées, `quantity`, `free_quantity` (UG), `unit_price_ht`, `public_price_ttc` (PPH, pour le modèle d'impression 1), `discount_pct`, `net_ht`, `tax_rate`, `vat_amount`, `ttc`, `source_line_id` (ligne de BL → ligne de facture, ligne de facture → ligne d'avoir), `source_number` et `source_date` figés (n° et date du BL d'origine imprimés sur la facture), `invoiced_qty` / `credited_qty` tenus par transition |
| `credit_reasons` | référentiel des motifs d'avoir : retour produit, erreur de prix, remise après coup, produit périmé, autre |
| `sales` | + `source` (défaut `SAGE`), `document_line_id` (unique si non nul), `free_quantity` |
| `content_assets` | + propriétaire `sales_document_id` (contrainte « un seul propriétaire » étendue) ; + propriétaire « société » pour le logo et le cachet |

### Lot 3 — achats

`purchase_documents` (commande, réception, facture fournisseur, retour fournisseur ; devise, **taux de change
saisi sur la pièce**, n° de facture du fournisseur, PDF rattaché), `purchase_document_lines` (article **ou**
article d'inventaire marketing **ou** ligne libre, quantité commandée / reçue, lot, péremption, prix d'achat),
`landed_costs` (frais d'approche d'une réception — transport, douane, transit — et clé de répartition valeur ou
quantité).

### Lot 4 — inventaire

`stock_counts` (session : date et heure de référence, périmètre, comptage à l'aveugle, statut),
`stock_count_lines` (théorique figé, compté, écart en quantité / valeur / %, motif, commentaire),
`stock_count_entries` (une saisie par compteur, sommées par article et lot), `count_gap_reasons` (référentiel).

### Lot 5 — règlements et bascule

`payments` (mode, montant, référence de chèque / effet / LCN, banque, échéance de l'effet, statut
portefeuille → remis → encaissé / impayé), `payment_allocations` (règlement ou avoir → facture, montant). Les
factures ouvertes de Sage sont reprises en `sales_documents` avec `source = 'SAGE_REPRISE'`, leur numéro Sage et
leur solde, **sans projection** dans `sales` (déjà comptées par l'import).

---

## 5. Règles de calcul (module pur `src/lib/gestion/calc.ts`)

- **Unités exactes.** Quantité en millièmes, prix en centimes, remise et TVA en centièmes de pourcent, le tout en
  BigInt. Un seul arrondi par montant : **au centime, demi au-dessus, symétrique** pour les négatifs, de sorte
  qu'un avoir total annule sa facture au centime près.
- **Ligne.** `net_ht = arrondi(qté × PU HT × (1 − remise ligne) × (1 − remise globale))`, soit une cascade et
  non une addition. `tva = arrondi(net_ht × taux)`. `ttc = net_ht + tva`.
- **Pièce.** Tous les totaux sont des sommes de lignes. Le récapitulatif par taux = Σ bases et Σ TVA par taux. Le
  « Total HT » du pied = Σ `arrondi(qté × PU × (1 − remise ligne))`. La remise globale est affichée comme la
  différence avec le « Net HT ». C'est exactement la paire **Total HT / Net HT** du modèle Sage.
- **UG.** Elles sortent du stock et valent 0 MAD. Elles sont imprimées comme une ligne à part « UG » (le modèle
  Sage n'a pas de colonne pour elles).
- **Montant en lettres** (`words.ts`), avec les libellés de devise réglables. Par défaut, ceux de Sage : « … MAD
  et … cents ».
- **Vérification sur FA202600198.** PU HT = 199,00 ÷ 1,20 = 165,83. On a 6 × 165,83 × 0,75 = 746,235, soit
  **746,24**. TVA : 149,248, soit **149,25**. Totaux : **1 492,48 / 298,50 / 1 790,98**. C'est identique au papier Sage.
- **Contrôles au moment de valider.** Remise au-delà de la remise du client (plus la tolérance réglable), client
  bloqué, encours + pièce au-delà du plafond, prix net sous le CMUP (vente à perte), stock insuffisant (blocage
  ou alerte, réglable). Chaque dépassement doit être **levé** par un détenteur de l'interrupteur « Lever un
  blocage commercial », sur demande notifiée. La levée est tracée dans `approvals` et dans `audit_logs`.
- **Encours client** (`clientOutstanding()`, une seule définition) : Σ TTC des factures validées − règlements et
  avoirs imputés, + TTC des BL validés non facturés. **Échéance** = date + délai du client, plafonnée par le
  paramètre de délai légal. « Échue » est calculé à la lecture, jamais stocké.

## 6. Numérotation (`src/lib/gestion/numbering.ts`)

- Format par série, réglable : `{PREFIX}{YYYY}{SEQ:5}` donne `FA202600198`, `BL202600600`, `AV202600038`
  (formats Sage actuels). Remise à zéro annuelle.
- Le numéro est attribué **dans la transaction de validation**, par `UPDATE document_sequences SET next = next + 1
  … RETURNING`. Le verrou de ligne sérialise les validations concurrentes. Si la transaction échoue, l'incrément
  est annulé avec elle, **donc aucun trou**. Une pièce annulée garde son numéro.
- **Prochain numéro réglable** dans `/parametres/gestion`, jamais en dessous du dernier numéro attribué.
- Chronologie : une facture ne peut pas être datée avant la dernière facture validée de la série, ni dans le futur.
- La série de simulation (mode parallèle) est distincte : `SIM-FA…`.
- Remarque : l'historique Sage montre des variantes manuelles (`FA…-1`, `AV2026000003` à 7 chiffres, `AVAD…`).
  COMANET OS n'en produira pas. À la reprise, seul le dernier numéro de chaque série compte.

## 7. Stock, lots, CMUP (`src/lib/gestion/ledger.ts`, seul écrivain de `stock_movements`)

- Validation d'un BL : verrou `FOR UPDATE` sur les articles concernés (dans l'ordre des id, contre les
  interblocages), contrôle du disponible, puis écriture des mouvements `SORTIE_BL` (quantité + UG).
- **Lots.** Pour un article suivi par lot, la sortie se fait **au plus proche de la péremption** (FEFO),
  proposée automatiquement et modifiable ligne par ligne. Les lots périmés sont exclus. Alerte à J-X (réglable).
- Annulation d'un BL validé non facturé : contre-mouvements (`reversal_of`) et statut `ANNULE`, numéro conservé.
- Retour client : `RETOUR_CLIENT` vers `PRINCIPAL` ou `NON_VENDABLE` (abîmé ou périmé).
- **CMUP.** Chaque entrée d'achat recalcule `cmup = (stock × cmup + qté × coût de revient) ÷ (stock + qté)`,
  stocké sur le mouvement (`cmup_after`, jamais réécrit). Les sorties sont valorisées au CMUP du moment. Coût de
  revient = prix d'achat × taux de change de la pièce + frais d'approche répartis.
- **Stock initial.** Import Excel (article, lot, péremption, quantité, coût unitaire) en `STOCK_INITIAL`,
  annulable tant qu'aucun autre mouvement n'existe sur ces articles.
- **Branchement.** `productStocks()` lit le journal quand `settings.gestion.stockSource = 'LEDGER'` (à la bascule),
  sinon la dernière photo. La couverture 🟢/🟡/🟠/🔴, la commande conseillée, le croisement stock × marketing,
  l'Action Center et l'IA en profitent sans modification.

## 8. Modèles d'impression

**Facture — ce que montrent les deux PDF fournis**

| Zone | Contenu Sage | Source dans COMANET OS |
|---|---|---|
| En-tête gauche | Logo, puis bloc gris : raison sociale, adresse, Tél, Capital, RC, ICE, I.F, CNSS, TP | `settings.gestion.company` ; logo via `assets.ts` |
| En-tête droit | Trois cartouches arrondis : **Facture N°**, **Date**, **Client** (code) ; cartouche gris « Provisoire » | Numéro, date, `sage_code`. « PROVISOIRE » sur un brouillon (sans numéro), vide une fois la pièce validée |
| Bloc client | Coins d'équerre : raison sociale, adresse sur 2 lignes, ICE, ville | `client_snapshot` |
| Tableau (modèle 1) | REF · Désignation · Qté (3 déc.) · P.U. HT · **PPH TTC** · **REMISE** · Montant HT · TVA · Mt TTC | lignes |
| Tableau (modèle 2) | REF · Désignation · Qté · **Px Uni. HT net** · Total HT · TVA · Mt TTC | lignes |
| Pied | Total HT, Net HT, Total TVA, Total TTC, **NET A PAYER**, montant en lettres | totaux |
| Bas de page | Cachet et signature (image), RIB | image « cachet » via `assets.ts`, RIB en paramètre |

Constats :

1. **Le modèle 1 est cohérent au centime** : 6 × 165,83 × 75 % = 746,24. **Le modèle 2 ne l'est pas** : il
   imprime 124,37, et 6 × 124,37 = 746,22 ≠ 746,24. Un pharmacien qui refait le calcul trouve 2 centimes d'écart.
   Je recommande le modèle 1, avec une option par client (Q9).
2. **Le RIB est tronqué** sur le modèle 1 (il s'arrête au milieu du numéro). SGMB et Saham Bank désignent le même
   compte. Le RIB viendra des paramètres, en entier.
3. **Ce que le brief exige et que le modèle Sage n'imprime pas** : taux de TVA (seul le montant apparaît), mode de
   paiement, date d'échéance, n° de page. Je propose de les ajouter discrètement sous le bloc des totaux (« TVA 20 %
   · Échéance 11/09/2026 · Règlement : chèque ») sans toucher au reste de la mise en page. Mentions à faire
   valider par ton comptable.
4. **Documents longs.** En-tête répété, « Report » en haut et « À reporter » en bas de chaque page, « Page 1/3 ».
5. **Figé** à la validation : PDF + instantané JSON + version du modèle. Changer un paramètre plus tard ne modifie
   aucune pièce émise.

**Encore manquants : les modèles Sage du BL, de l'avoir et du bon de réception.** Sans eux, le BL reprendra
l'en-tête et le bloc client de la facture, avec les colonnes REF · Désignation · Lot · Péremption · Qté · UG. Q6
décide si les prix y figurent.

**Envoi.** WhatsApp (`wa.me` avec message prérempli et lien) et e-mail (`mailto:` avec lien) : aucune
infrastructure nouvelle. Le lien pointe vers `/d/[jeton]`, un jeton signé qui expire (réglable), valable
uniquement pour une pièce validée. Un vrai envoi SMTP pourra venir plus tard s'il est utile.

## 9. Bascule sans double comptage

| Mode | Pièces COMANET OS | Projection dans `sales` | Import Sage des sites basculés | Stock |
|---|---|---|---|---|
| `OFF` (jusqu'au lot 5) | Tests seulement | non | normal | photos importées |
| `PARALLELE` (1 mois) | **Simulations** : série `SIM-`, filigrane « Simulation — sans valeur légale », rien envoyé aux clients | non | normal : Sage fait foi | journal alimenté (stock initial en début de mois) |
| `ACTIF` (à partir de la date de bascule) | Pièces légales, séries reprises au « prochain numéro » | oui (BL et avoirs) | **refusé** pour les dates ≥ bascule, avec un message clair | journal = source (`stockSource = LEDGER`) |

- **Rapport de contrôle** du mois parallèle, pour les sites COMANET et DESK DIGITAL : CA HT, nombre de pièces par
  type, stock par article (journal contre photo Sage de fin de mois). Écarts listés ligne par ligne, avec les
  écarts d'arrondi d'un centime identifiés comme tels (§1.4).
- **À la bascule** : ajustement du journal sur le stock Sage final (ou sur l'inventaire du 31/12), reprise des
  factures ouvertes avec leur solde, prochain numéro de chaque série, puis passage du mode à `ACTIF`.
- **Exports comptables** (xlsx, et CSV si le logiciel du comptable le demande — Q11) : journal des ventes, journal
  des achats, état de TVA par taux et par période, grand livre clients, balance âgée (0-30, 31-60, 61-90, +90).

## 10. Droits

Trois nouveaux modules dans la matrice. Les modules existants reprennent les actions qui leur reviennent :

| Module | Voir | Créer | Modifier | Valider |
|---|---|---|---|---|
| `clients` (existant) | fiche | créer | modifier | archiver / supprimer |
| `produits` (existant) | fiche | créer | modifier | archiver / supprimer |
| `stock` (existant, sens étendu) | état, mouvements, lots | compter un inventaire, saisir une réception | — | valider un inventaire, ajustement ou casse |
| **`livraisons`** (nouveau) | BL | brouillon | brouillon | valider (sortie de stock), annuler |
| **`facturation`** (nouveau) | factures, avoirs, encours | brouillon, encaissement | brouillon | valider, émettre un avoir |
| **`achats`** (nouveau) | fournisseurs, commandes, factures fournisseurs | créer | modifier | valider, archiver un fournisseur |

- **Nouvel interrupteur `overrideCommercialLimits`** (« Lever un blocage commercial ») : remise au-delà du
  plafond, client bloqué, encours dépassé, vente à perte.
- **Paramètres** (TVA, numérotation, mentions, bascule) : `requireAdmin()`.
- **Modèles de rôle.** Administrateur : tout. Commercial / Trade : clients C/M, livraisons V/C/M/Val, facturation V
  (réglable), stock V/C. **Magasin** (nouveau) : livraisons V/C/M/Val, stock V/C, produits V. Marketing : inchangé ;
  ses achats de goodies et de PLV passent par la page Matériel.
- La portée existante s'applique telle quelle : un commercial en portée OWN ou ASSIGNED ne voit que les pièces de
  ses clients (`clientFilter()`).
- En prod aujourd'hui, **Samy est déjà administrateur** avec les 14 modules : il aura les mêmes droits que toi
  sauf décision contraire (Q7). Personne n'a encore le profil « Magasin ».

## 11. Écrans

Nouveau groupe de navigation **Gestion commerciale** : Tableau de bord (BL à facturer, échéances, encours,
blocages en attente), Bons de livraison, Factures, Avoirs & retours, Règlements (lot 5), Achats (commandes,
réceptions, factures fournisseurs), Fournisseurs, Inventaires.

On étend les écrans existants :

- **Fiche client** : onglets Infos, Pièces, Encours & échéances, Achats par marque et produit, Stock en point de
  vente (existant).
- **Fiche article** : mouvements, lots, CMUP.
- **`/stock`** : état par article, marque et lot, valeur au CMUP, stock à une date.
- **`/parametres/gestion`** : société, TVA, numérotation, modèles d'impression, conditions, motifs, bascule.

Mobile d'abord pour la saisie d'un BL en tournée (recherche d'article, quantités au pouce) et pour le comptage
d'inventaire (scan).

## 12. Lots

| Lot | Contenu | Migration | Tests (purs, sans base) | Taille |
|---|---|---|---|---|
| **1 — Fondations** | `settings.gestion` et référentiels ; numérotation (moteur et paramètres) ; clients (colonnes, création, archivage, suppression, doublons, écran de reprise depuis la liste Sage) ; fournisseurs ; articles (colonnes, reprise des réf. COMANET et EAN) ; journal de stock, lots, import du stock initial, état du stock en lecture ; `audit.ts` ; triggers d'immuabilité ; droits (C14, C19) ; garde-fous C6 et C7 ; `DataTable` ; `CLAUDE.md` réécrit (C1) | `0025_gestion_fondations` | format de numéro, CMUP, stock à date, FEFO, doublons clients | L |
| **2 — Ventes** | BL (brouillon → validé → livré → facturé / annulé, sortie de stock, PDF) ; facture depuis un BL et regroupement de plusieurs BL ; facture directe (services) ; remises en cascade, UG ; avoirs et retours ; levée des blocages ; projection dans `sales` (active en mode `ACTIF`) ; C3, C4, C12, C17, C18 ; règles de l'Action Center (BL non facturés, blocages en attente) | `0026_gestion_ventes` | remises en cascade, TVA multi-taux, arrondis, symétrie avoir / facture, regroupement de BL, montant en lettres, pagination et report | XL |
| **3 — Achats** | commandes, réceptions (partielles, lots, écarts), factures fournisseurs (PDF rattaché, rapprochement), devises, frais d'approche, CMUP → `cost_price` ; hors-stock → `recordMovement()` ; suivi par fournisseur, marque et mois ; C10 et C11 | `0027_gestion_achats` | répartition des frais d'approche, CMUP multi-réceptions, conversion de devise | L |
| **4 — Inventaire** | sessions, comptage mobile avec scan (caméra), à l'aveugle, plusieurs compteurs, rapprochement, motifs, validation → ajustements, analyse des écarts (voir ci-dessous), règles de l'Action Center | `0028_gestion_inventaire` | écarts en quantité / valeur / %, fiabilité, écarts récurrents, écart ÷ sorties | L |
| **5 — Règlements et bascule** | 5a : encaissements, imputations, échéancier, balance âgée, relances. 5b : modes de bascule, reprise des factures ouvertes, rapport de contrôle, refus d'import (C5), exports comptables, C22 | `0029_gestion_reglements` | imputations partielles, balance âgée, encours | L |

- Chaque lot livre sa partie de `docs/guide-gestion-commerciale.md` et un résumé de ce qui est livré et de ce qui reste.
- **Test de numérotation concurrente.** C'est un test d'intégration, hors `npm test`, lancé à la main sur un vrai
  Postgres. PGlite sérialise les connexions : il ne prouverait rien.
- **Analyse des écarts d'inventaire (lot 4).** Pour chaque piste, on sépare la **donnée** (« 3 BL validés plus de
  48 h après leur date ») de l'**hypothèse** (« sortie physique avant saisie »). Pistes suivies : BL tardifs,
  réceptions non saisies, retours non enregistrés, échantillons sortis sans mouvement, lots périmés non déclarés.
- **Rythme.** La période parallèle suppose les lots 1, 2, 3 et 5a. Arrêter Sage suppose les cinq lots. Le lot 4
  sert dès l'inventaire du 31/12 s'il est prêt.

**Prérequis données (en parallèle du lot 1, côté COMANET) :**

- Exports du Sage COMANET : liste des clients (code, raison sociale, ICE, IF, RC, adresse, conditions), liste des
  articles (réf., désignation, PPH, TVA, prix d'achat, EAN), stock par lot, derniers numéros de chaque série.
- Modèles PDF du BL, de l'avoir et du bon de réception.
- Logo en haute définition et image du cachet.

## 13. Principe → garantie technique

| Principe du brief | Garantie |
|---|---|
| Pièce validée non modifiable ni supprimable | Trigger : aucune modification des champs financiers ni suppression hors brouillon. Lignes figées. Test source : aucun `update(salesDocumentLines)` hors `workflow.ts`. |
| Numérotation continue, sans trou | Compteur incrémenté dans la transaction de validation. Contrainte unique (série, numéro). |
| Stock = journal | Trigger : ni mise à jour ni suppression sur `stock_movements`. Test source : aucune insertion hors `ledger.ts`. |
| Archiver plutôt que supprimer | `ON DELETE RESTRICT`. La suppression d'une fiche n'est proposée que si elle n'a aucune pièce. |
| Traçabilité | `audit_logs` écrit dans la même transaction que chaque création, validation, levée de blocage ou annulation. Chronologie visible sur chaque pièce. |
| Aucune règle en dur | `settings.gestion` et référentiels. Test source : aucun taux ni préfixe littéral dans `src/lib/gestion/`. |
| Montants exacts | `calc.ts` en BigInt. Test source : aucun `parseFloat` ni `Number(` sur un montant dans `src/lib/gestion/`. |

## 14. Questions

Chaque question a une **réponse par défaut** : sans réponse contraire, j'applique le défaut.

**À trancher avant le lot 1**

- **Q1 — Sites.** COS, CAS, CAG, DAG et CMR sont-ils un distributeur (ou un dépositaire) avec son propre système ?
  PHARMAFIRST est-il un grossiste qui te transmet ses ventes ? Qu'est-ce que DESK DIGITAL ?
  *Défaut : seuls COMANET et DESK DIGITAL passent sur COMANET OS ; DESK DIGITAL devient un « canal » choisi sur le BL.*
- **Q2 — Décisions D1 à D10.** Surtout D2 (on étend `clients`), D3 (le matériel marketing reste dans Activations)
  et D10 (bascule au 1ᵉʳ janvier 2027).
- **Q3 — Dépôts.** Un seul entrepôt physique ? Du stock en dépôt chez un distributeur ?
  *Défaut : `PRINCIPAL` + `NON_VENDABLE`, d'autres ajoutables en paramètre.*

**À trancher avant le lot 2**

- **Q4 — TVA** par famille (dermo-cosmétique, compléments, goodies). *Défaut : 20 % partout, taux réglable par article.*
- **Q5 — UG.** Sur quelles marques, selon quelle règle (ex. 10 + 1) ? *Défaut : saisies à la main par ligne ; règles automatiques plus tard.*
- **Q6 — BL.** Devis et commandes clients, ou directement le BL ? Lot et péremption imprimés ? Prix sur le BL ?
  Étape « Livré » obligatoire avant de facturer ?
  *Défaut : BL direct ; lot et péremption imprimés ; prix imprimés ; « Livré » facultatif.*
- **Q7 — Validation des factures.** Qui valide ? Samy garde-t-il exactement tes droits ?
  *Défaut : toi et Samy ; le commercial crée, un administrateur valide.*
- **Q8 — Stock insuffisant.** *Défaut : blocage, levable par « Lever un blocage commercial ».*
- **Q9 — Modèle de facture.** 1 (PPH + remise) ou 2 (prix net) ? *Défaut : modèle 1, plus taux de TVA, échéance et mode de paiement.*
- **Q10 — Prix de base.** Le P.U. HT facturé est-il toujours PPH TTC ÷ (1 + TVA), puis la remise du client (199 → 165,83 − 25 %) ?
  Ou existe-t-il des tarifs HT propres (grossistes) ?
  *Défaut : PPH ÷ (1 + TVA) arrondi au centime + remise client / marque / ligne ; tarifs par catégorie possibles mais vides.*
- **Remise maximale.** *Défaut : au-delà de la remise du client (tolérance 0 point), il faut une levée de blocage.*

**À trancher avant le lot 5**

- **Q11 — Comptable.** Quel logiciel utilise-t-il (Sage Comptabilité ? quel format d'import ?) ? Régime de TVA
  (encaissement ou débit) pour l'état de TVA ? Plafond légal des délais de paiement à retenir ?
  *Défaut : xlsx ; délai client par défaut 60 jours.*
- **Q12 — Calendrier.** Bascule au 1ᵉʳ janvier 2027 avec parallèle en décembre, ou une autre date ?
