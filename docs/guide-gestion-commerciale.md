# Gestion commerciale — guide

Remplacement progressif de Sage pour les pièces émises par COMANET (sites `COMANET` et `DESK DIGITAL`).
Plan complet, décisions et lots : `docs/plan-gestion-commerciale.md`. Ce guide décrit ce qui est livré.

## Lot 1 — fondations (livré)

### Ce que l'on trouve dans l'application

| Écran | Rôle |
|---|---|
| **Gestion commerciale → Préparation** (`/gestion`) | Ce qui manque avant la première facture : identité de la société, clients vendus par COMANET sans raison sociale / ICE / adresse, articles sans référence COMANET, état du stock initial et des photos Cospharma / Pharmafirst, prochain numéro de chaque série. Triés par CA : on commence par le haut. |
| **Stock réel** (`/gestion/stock`) | État par article : entrepôt COMANET (journal), non vendable, dépôts externes (dernière photo), disponible, CMUP et valeur (droit « prix d'achat et marges »), lots et péremption, stock à une date passée. Onglets Lots et Journal ; saisie d'une casse / périmé ou d'un transfert (droit « Valider » sur Stock). |
| **Fournisseurs** (`/gestion/fournisseurs`) | Laboratoires et marques (marchandises) et prestataires hors stock (PLV, goodies, services). Création avec contrôle de doublon (nom, ICE), archivage, suppression tant qu'aucune pièce d'achat n'existe, historique. |
| **Fiche client → Identité & conditions** | Raison sociale, code client Sage, ICE, IF, RC, patente, adresse, contact, commercial attitré, remise par défaut, mode et délai de paiement (plafonné), plafond d'encours, adresses de livraison, remises par marque, blocage, archivage, suppression (seulement sans aucune donnée rattachée), historique. Bandeau « prêt à facturer » ou liste de ce qui manque. |
| **Clients → + Client** | Création avec détection des doublons pendant la saisie (ICE, nom et libellés bruts, nom proche dans la même ville, téléphone). |
| **Fiche article → Gestion commerciale** | Référence COMANET (ex. CYG01), EAN, nature (produit / service), TVA, unité, colisage, suivi des lots ; stock réel par dépôt, lots, CMUP, derniers mouvements. |
| **Paramètres → Gestion commerciale** | Identité de la société (mentions des pièces), logo et cachet, TVA par défaut, délais de paiement (défaut et plafond), stock insuffisant (bloquer / alerter), alerte péremption, date et sites de bascule, taux de TVA, modes de paiement, dépôts, numérotation (format et prochain numéro). |
| **Imports** | `Stock initial (journal)` : article (réf. COMANET, EAN ou code), lot, péremption, quantité, coût unitaire, dépôt. `Stock (photo)` : choisir le dépôt photographié (Cospharma, Pharmafirst). `Clients` et `Articles` acceptent les nouvelles colonnes (code Sage, raison sociale, ICE, IF, RC, adresse, délai, remise ; réf. COMANET, EAN, TVA, unité, colisage). |

### Règles

- **Le client reste le point de vente.** `name` = nom commercial ; `legal_name` = raison sociale imprimée.
  `account_code` = code du Sage COMANET (« 056 ») ; `code` reste le code des fichiers distributeurs.
- **L'article garde son code distributeur** (`sku`) ; la référence COMANET est `code`. Le matériel marketing
  (PLV, goodies) n'est pas un article : il reste dans `inventory_items` (Activations).
- **Stock = somme des mouvements.** Le journal `stock_movements` est en écriture seule : la base refuse toute
  modification, suppression ou `TRUNCATE`, même en cascade. Une erreur se corrige par un contre-mouvement
  (`reversal_of`). Seul `src/lib/gestion/ledger.ts` y écrit (test `definitions-uniques`).
- **Dépôts.** INTERNE : suivi mouvement par mouvement (Entrepôt COMANET, Non vendable). EXTERNE : stock confié à
  un distributeur, connu par photo importée (Cospharma pour Gamarde, Pharmafirst pour Auracos) ; aucun mouvement
  n'y est écrit. Un transfert vers un dépôt externe ne fait que sortir de l'entrepôt.
- **Lots.** Un article « suivi par lot » exige son lot à chaque mouvement. Une date de péremption déjà connue ne
  se contredit pas. La sortie au plus proche de la péremption (`allocateFefo()`) sert aux BL.
- **CMUP.** Recalculé à chaque entrée coûtée : (stock × CMUP + qté × coût) ÷ (stock + qté), stocké sur le
  mouvement (`cmup_after`). Annuler une entrée la retire de la moyenne au coût où elle était entrée.
- **Montants exacts.** Entiers à échelle fixe (`money.ts`) : montants 2 décimales, quantités 3, coûts 4. Un seul
  arrondi par résultat, au plus proche, le demi s'éloignant de zéro. La facture FA202600198 est reproduite au
  centime (746,24 / 149,25 / 1 790,98), alors que l'export Sage donnait 746,25 sur la même ligne.
- **Numérotation.** Format par série (`FA{AAAA}{N:5}` → FA202600198), compteur par année, pris dans la
  transaction de validation : pas de doublon, pas de trou. Le prochain numéro se règle tant qu'aucune pièce n'est
  numérotée dans l'année (reprise de la séquence Sage), puis la série est figée.
- **Audit.** Toute création, modification, archivage, blocage ou suppression d'un client, fournisseur, article ou
  paramètre écrit `audit_logs` dans la même transaction (`src/lib/audit.ts`, seul écrivain). Historique affiché
  sur chaque fiche.
- **Droits.** Clients : Créer / Modifier ; archiver, bloquer, supprimer = Valider. Articles : Modifier.
  Fournisseurs = module `achats` (archiver / supprimer = Valider). Stock : casse, transfert, annulation d'un stock
  initial = Valider. Paramètres = Administration. Modules `livraisons` et `facturation` créés, utilisés au lot 2.
  Modèle de rôle « Magasin » ajouté.
- **Identité de la société.** Dans `settings.gestion.company`, jamais dans le code (le dépôt GitHub est public) ;
  logo et cachet dans `content_assets` (`company_slot`), visibles des seuls administrateurs.

### Garde-fous ajoutés à l'existant

- `resetImportedData()` (réinitialisation du classeur) refuse de tourner dès qu'un mouvement de stock ou une
  fiche client complétée existe : le `TRUNCATE` en cascade les effacerait.
- La fusion d'articles est refusée si l'article source a des mouvements ; elle demande « Valider » sur Produits.
- L'annulation d'un import ne supprime plus un article ou un client qui a du stock, des relevés ou une identité légale.
- `updateClient` exige « Modifier » (et non plus « Voir ») ; l'archivage passe par « Valider ».

### Vérifier sur une base jetable

```bash
GESTION_IT=1 DATABASE_URL=postgresql://…/base_jetable node --conditions=react-server --import tsx scripts/gestion-integration.ts
```

Le script refuse de tourner sans `GESTION_IT=1` ou sur une URL Supabase : il écrit dans le journal, qui ne
s'efface pas.

## Lot 2 — ventes : BL, factures, avoirs, PDF (livré)

### Ce que l'on trouve dans l'application

| Écran | Rôle |
|---|---|
| **Gestion commerciale → Pièces** (`/gestion/pieces`) | Onglets Bons de livraison / Factures / Avoirs : recherche, filtres (statut, simulation), tri. Un bandeau rappelle le mode : tant que la bascule n'est pas faite, les pièces sont des **simulations**. |
| **+ Bon de livraison** (`/gestion/pieces/nouveau?type=BL`) | Saisie pensée pour le téléphone : client (recherche), date, site, commercial, règlement ; articles par nom, référence, marque ou code-barres, avec le stock du dépôt principal ; quantité, UG, P.U. HT, remise ; totaux en direct. « Brouillon » ou « Valider ». |
| **Fiche pièce** (`/gestion/pieces/[id]`) | Brouillon : modification, aperçu PDF « Provisoire », blocages à lever, suppression. Validée : lignes (lots servis, quantités facturées), totaux, montant en lettres, échéance, pièces liées, blocages levés, historique ; actions Marquer livré, Facturer ce client, Faire un avoir, Annuler le BL ; PDF, téléchargement, envoi WhatsApp / e-mail avec lien public. |
| **Facturer des BL** (`/gestion/pieces/facturer`) | Clients ayant des BL à facturer (du plus ancien), puis choix des BL : une facture brouillon regroupe leur reste à facturer. |
| **Paramètres → Gestion commerciale** | Mode de bascule (Sage fait foi / période parallèle), modèle de facture (PPH TTC + remise, ou prix net), tolérance de remise, « Livré » exigé avant facturation, contrôle d'encours, libellés du montant en lettres, durée des liens de partage, alerte BL non facturés ; motifs d'avoir (avec ou sans retour en stock). |
| **Action Center** (catégorie « Gestion commerciale ») | BL non facturés au-delà du délai réglé, pièces dont le déblocage est demandé, lots périmés ou proches de la péremption encore en stock. |
| **Recherche** et copilote | Un numéro de BL, de facture ou d'avoir se retrouve par la recherche universelle (droits Livraisons / Facturation et portée client respectés). |

### Règles

- **Cycle.** BL : Brouillon → Validé (stock sorti) → Livré (facultatif, exigible dans les paramètres) → Facturé en
  partie / Facturé ; ou Annulé (contre-mouvements de stock, numéro conservé). Facture : Brouillon → Validée.
  Avoir : Brouillon → Validé. Une pièce validée ne revient jamais en brouillon.
- **Pièce validée = figée par la base** (triggers de la migration 0026) : ni suppression, ni modification des
  montants, du client, des lignes ou des identités figées. Seuls le statut, les compteurs facturé / crédité et le
  PDF évoluent. Une erreur se corrige par un avoir. Seul `src/lib/gestion/documents.ts` écrit une pièce (test).
- **Montants** (`calc.ts`, seule définition) : remise ligne puis remise globale en cascade, arrondi au centime par
  ligne, TVA ligne par ligne sur le net arrondi, totaux = somme des lignes. Prix de base proposé = PPH TTC ÷ (1 + TVA),
  remise proposée = remise du client sur la marque, sinon sa remise par défaut. Le serveur recalcule tout à
  l'enregistrement : le navigateur n'est jamais cru.
- **Stock.** Le BL sort le stock à la validation (quantité + UG) du dépôt principal ; pour un article suivi par lot,
  les lots sont servis au plus proche de la péremption, sans jamais servir un lot périmé, et imprimés sur le BL.
  Stock insuffisant : refus (ou alerte, selon le réglage). Un avoir « avec retour » fait rentrer la marchandise au
  dépôt choisi, sur le lot livré à l'origine.
- **Facture d'articles = depuis les BL.** Une facture directe ne porte que des services ou des frais ; un article
  stocké se facture toujours depuis son BL (c'est le BL qui a sorti le stock). Une facture regroupe les BL d'un
  seul client, de même nature (réelle / simulation) et de même remise globale ; les UG suivent la première
  facturation d'une ligne. Pas de double facturation : la base vérifie le reste à facturer.
- **Avoir** : sur une facture validée, lignes non encore créditées reprises (à ajuster), motif obligatoire. Le TTC
  des avoirs ne dépasse jamais celui de la facture.
- **Blocages commerciaux** (`commercialIssues()`) : client bloqué, remise effective au-delà de la remise autorisée
  (+ tolérance), encours au-delà du plafond (si activé), prix net sous le CMUP (vente à perte). La validation est
  refusée ; une personne avec l'interrupteur **« Lever un blocage commercial »** (administrateurs par défaut) lève
  et valide — la levée (quoi, qui, quand) est enregistrée sur la pièce. Les autres **demandent le déblocage** :
  notification aux personnes habilitées et carte dans l'Action Center.
- **Mentions** : une facture ou un avoir exige raison sociale, ICE, adresse et ville du client. Échéance = date +
  délai du client (ou défaut), plafonnée. Montant en toutes lettres (« … MAD et … cents »). Identités de la
  société et du client figées à la validation, avec une empreinte SHA-256 du contenu (`content_hash`).
- **Numérotation** : séries légales BL / FA / AV quand COMANET OS émet réellement ; en période parallèle ou avant
  la bascule, séries de **simulation** SIMBL / SIMFA / SIMAV, jamais mêlées. Chronologie des factures réelles
  contrôlée (pas de facture datée avant la dernière validée).
- **Ventes (sell-in).** Une pièce n'alimente `sales` (source `COMANET_OS`, clé `COS:<ligne>`) qu'en mode ACTIF,
  hors simulation, après la date de bascule et pour un site basculé (`shouldProject()`) ; avant, Sage fait foi et
  projeter compterait deux fois. Le BL projette à sa date, l'avoir en négatif, la facture pose son numéro. Seul
  `src/lib/gestion/projection.ts` écrit ces ventes. `ORDER_KEY` compte une vente COMANET OS par BL ; la date de
  référence du cockpit se lit sur les seuls imports.
- **PDF** (`pdf.tsx`, @react-pdf/renderer, côté serveur) : mise en page Sage (logo, cartouches N° / Date / Client,
  bloc société, bloc client, tableau, Total HT / Remise / Net HT / TVA par taux / Total TTC / NET A PAYER, montant en
  lettres, échéance et règlement, cachet sur les pièces validées, RIB, « Page x / y », « À reporter » / « Report »
  exacts). Montants au format Sage (1.790,98). Mention « Provisoire » (brouillon) ou « Simulation ». Le PDF d'une
  pièce validée est rendu une fois, stocké (`content_assets`, genre PIECE) et relu tel quel ensuite.
- **Partage** : lien `/d/<jeton>` signé (clé dérivée, distincte des sessions), limité à une pièce validée et à la
  durée réglée ; WhatsApp (numéro du client converti au format international) et e-mail pré-remplis.
- **Droits** : BL = module Livraisons ; facture et avoir = Facturation. Créer / Modifier un brouillon, Valider
  (numéroter), annuler un BL = Valider sur Livraisons. Portée client respectée partout (liste, saisie, PDF, recherche).

### Vérifier sur une base jetable

Le script d'intégration couvre aussi les pièces : BL avec sortie FEFO et UG, remise bloquée puis levée, stock
insuffisant, facture regroupée, immutabilité (UPDATE / DELETE refusés par la base), double facturation refusée,
avoir avec retour en stock, annulation de BL, aucune projection hors mode ACTIF. Le PDF (module ESM) se vérifie
sur le serveur Next : `/gestion/pieces/<id>/pdf`.

## À venir

Lot 3 (achats, réceptions, CMUP depuis les factures fournisseurs),
lot 4 (inventaires), lot 5 (règlements, bascule, exports comptables) — voir le plan.
