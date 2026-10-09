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

- **Le client reste le point de vente.** `name` = nom du point de vente (clé des imports, affiché partout) ;
  `legal_name` = raison sociale imprimée, 1ʳᵉ colonne de la base clients ; `group_id` → `client_groups` = **Groupe**
  (enseigne) qui rassemble plusieurs raisons sociales (migration 0032). Le champ « Groupe » se saisit en clair sur la
  fiche : un nom inconnu crée le groupe, un champ vide détache le client. Liste : filtre et vue « Regrouper par groupe ».
  `account_code` = code du Sage COMANET (« 056 ») ; `code` reste le code des fichiers distributeurs.
- **Un point de vente, plusieurs raisons sociales** (migration 0034). Quand un même magasin est facturé sous deux
  sociétés (ex. PARA LA GLOIRE et LA GLOIRE à Fès), on garde **une seule fiche** : ventes, animations, relevés de stock,
  encours et objectifs restent ensemble. Les raisons sociales supplémentaires vivent dans `client_legal_entities`
  (fiche client → « Raisons sociales facturables » : raison sociale, ICE, code Sage, IF, RC, patente, adresse) ; la
  fiche garde l'identité principale. Sur un BL, une facture ou un avoir, « Au nom de » choisit l'entité ; la facture
  issue de BL et l'avoir reprennent celle de leur pièce d'origine ; les mentions obligatoires sont exigées sur l'entité
  choisie et figées dans la pièce (`billingIdentity()`). Une entité ne prête jamais son ICE ni son code Sage à une autre.
- **Fusionner deux fiches du même point de vente** (fiche client → « Fusionner une fiche en double », droit « Valider »
  sur Clients). Candidats proposés : même groupe (petits groupes), doublons probables, recherche. L'aperçu liste ce qui
  sera déplacé ; confirmation en tapant FUSIONNER. `mergeClients()` rattache à la fiche gardée ventes, animations,
  relevés, activations, matériel, ventes en bloc, adresses, libellés d'import, raisons sociales, brouillons, tâches,
  assignations et remises (la fiche gardée l'emporte en cas de doublon) ; le nom absorbé devient un libellé d'import
  (les prochains fichiers tombent au bon endroit), son identité légale une raison sociale facturable (sauf même ICE ou
  même raison sociale) ; les champs vides de la fiche gardée sont complétés, puis la fiche absorbée est supprimée.
  Journal : MERGE sur la fiche gardée, MERGED_INTO sur l'absorbée. Refusée si la fiche absorbée porte des pièces
  numérotées ou des règlements (figés sur leur client) : fusionner dans l'autre sens. Un test vérifie que toute table
  qui référence `clients` est prise en charge par la fusion.
- **Groupe ≠ fusion.** Le groupe rassemble des magasins distincts d'une même enseigne (COTE PARA, BIG PARA) et laisse
  chaque fiche séparée ; la fusion concerne un seul magasin saisi deux fois.
- **Supprimer** une fiche n'est possible que si rien n'y est rattaché (ventes, animations, pièces, règlements…) ; sinon
  on la fusionne dans la bonne fiche ou on l'archive.
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

## Commandes clients : le bon de commande saisi par le commercial (livré)

Le commercial saisit la commande du client sur son téléphone, au comptoir ; l'administration la
transforme en bon de livraison en un clic. Un quatrième type de pièce de vente, `COMMANDE`, dans les
mêmes tables que BL, factures et avoirs (migration 0042 : série `BC`, colonne `delivered_qty`).

| Écran | Rôle |
|---|---|
| **Commandes clients** (`/gestion/pieces?type=COMMANDE`, entrée de menu dédiée) | Liste des commandes : brouillons, confirmées, livrées en partie, livrées, annulées. |
| **+ Commande client** (`/gestion/pieces/nouveau?type=COMMANDE`) | Même éditeur que le BL, **avec la remise négociée** (par ligne, pré-remplie avec la remise du client, et globale) : client, raison sociale, date, site, commercial ; **produits habituels du client** (12 mois, un appui ajoute la quantité moyenne commandée), recherche d'article, stock disponible, prix au PPH ; « Brouillon » ou « Confirmer ». |
| **Fiche commande** | Confirmée : numéro `BC`, PDF, envoi WhatsApp / e-mail avec lien public, colonne « Livré x / y » par ligne, **Préparer le BL**, Annuler la commande, pièces liées (ses BL), historique. |
| **BL préparé depuis une commande** | Brouillon de BL avec l'en-tête et les lignes au reste à livrer (UG sur la première livraison), **les remises de la commande reprises telles quelles** (par ligne et globale) ; une commande sans aucune remise (saisie avant le 08/10/2026) reçoit la remise du client (sur la marque, sinon par défaut). **Tout reste modifiable** avant validation : quantités, prix, remises, remise globale, raison sociale, articles ajoutés. Le BL imprime « Suivant commande n° BC… ». |
| **Action Center** | « Commandes clients à préparer » (confirmées sans BL au-delà de `settings.gestion.orderPrepAlertDays`, 2 jours par défaut) et « Commandes clients sans stock » (reste à livrer supérieur au stock de l'entrepôt). |

Règles :

- **Cycle.** Brouillon → Confirmée (`VALIDE`, numéro BC) → Livrée en partie (`LIVRE_PARTIEL`) → Livrée (`LIVRE`) ;
  ou Annulée. Le statut suit les quantités livrées (`orderStatusAfterDelivery()`), recalculées à chaque validation
  ou annulation de BL. Livrer plus que commandé est permis : la commande est une intention, le BL engage.
- **Remise sur la commande** (décision d'Hicham, 08/10/2026, qui remplace « pas de remise sur la commande ») : le
  commercial saisit la remise négociée, pré-remplie avec celle du client. Au-delà de la remise autorisée, la
  confirmation est bloquée (déblocage comme sur un BL). Le BL préparé reprend la remise confirmée et la considère
  comme autorisée : pas de second déblocage, sauf si on la relève sur le BL. Le PDF de la commande imprime la remise.
- **Ni stock, ni vente, ni encours.** Seul le BL sort le stock et, en mode actif, alimente les ventes. La série `BC`
  est réelle avant comme après la bascule : une commande n'est pas une pièce fiscale, elle sert dès aujourd'hui.
- **Blocages commerciaux** à la confirmation comme sur un BL (client bloqué, remise, vente à perte, encours si
  contrôlé) : le commercial demande le déblocage, une personne habilitée le lève.
- **Droits.** Module **Commandes clients** (séparé des Livraisons depuis la migration 0043) : Créer = saisir et
  **confirmer** (le commercial confirme sa propre saisie, rien ne sort du stock) ; Modifier = modifier un brouillon,
  annuler une commande ; Valider = corriger le nom imprimé. « Préparer le BL » demande Créer sur **Livraisons** : un
  commercial peut donc prendre des commandes sans jamais toucher aux BL. Portée client respectée ; en portée « ses
  données », la personne ne voit et ne modifie que les commandes qu'elle a saisies ou qui lui sont attribuées
  (champ Commercial). Modèle de rôle prêt à appliquer : « Commercial (prise de commande) ».
- **Un seul BL brouillon à la fois par commande** ; une commande annulée ne se livre plus (le BL en cours est
  refusé à la validation) ; une commande ne s'annule pas tant qu'un BL brouillon en dépend.
- `createBLFromOrder()` et `cancelOrder()` vivent dans `src/lib/gestion/documents.ts`, seule écriture des pièces.
  Scénario complet dans `scripts/gestion-integration.ts`.

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
| **Recherche** et copilote | Un numéro de BL, de facture ou d'avoir se retrouve par la recherche universelle (droits Commandes / Livraisons / Facturation et portée client respectés). |

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
  projeter compterait deux fois — sauf pour les marques de « Ventes depuis les pièces » (ci-dessous). Le BL
  projette à sa date, l'avoir en négatif, la facture pose son numéro. Seul
  `src/lib/gestion/projection.ts` écrit ces ventes. `ORDER_KEY` compte une vente COMANET OS par BL ; la date de
  référence du cockpit se lit sur les seuls imports.
- **UG** : imprimées sur le BL seulement (le magasin les livre). Jamais sur une facture ni un avoir, qui vont au
  comptable tels quels ; elles restent enregistrées sur la pièce, dans le stock et dans les ventes.
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

Le script d'intégration couvre aussi les pièces de vente : BL avec sortie FEFO et UG, remise bloquée puis levée, stock
insuffisant, facture regroupée, immutabilité (UPDATE / DELETE refusés par la base), double facturation refusée,
avoir avec retour en stock, annulation de BL, aucune projection hors mode ACTIF. Le PDF (module ESM) se vérifie
sur le serveur Next : `/gestion/pieces/<id>/pdf`.

## Lot 3 — achats (livré)

### Ce que l'on trouve dans l'application

| Écran | Rôle |
|---|---|
| **Gestion commerciale → Achats** (`/gestion/achats`) | Onglets Commandes / Réceptions / Factures fournisseurs / Retours ; montants en devise et en dirhams ; commandes en retard signalées. |
| **+ Commande** | Fournisseur, devise, **taux saisi sur la pièce** (jamais deviné, 1 refusé pour une devise), livraison attendue, lignes article / matériel marketing / ligne libre. Le dernier prix payé à ce fournisseur dans cette devise est proposé. PDF « Bon de commande » et e-mail pré-rempli au fournisseur. |
| **Réceptionner** (depuis une commande) ou **+ Réception sans commande** | Reste à recevoir repris, quantités ajustables (réception partielle), lot et péremption (obligatoire pour un article suivi par lot), dépôt interne, **frais d'approche** (transport, douane, transit) répartis à la valeur ou à la quantité, coût de revient unitaire en direct. PDF « Bon de réception ». |
| **Facturer des réceptions** (`/gestion/achats/facturer`) | Un fournisseur, ses réceptions à facturer, une facture brouillon : n° de facture du fournisseur (obligatoire, unique), prix et quantités de la facture reçue, taux du jour de la facture. Pièce jointe : le PDF de la facture. |
| **Retour fournisseur** (depuis une réception) | Sortie de stock sur le lot reçu, au CMUP. |
| **Suivi des achats** (`/gestion/achats/suivi`) | Coût de revient des réceptions nets des retours, par mois × fournisseur et par marque, 12 mois glissants ou par année. |
| **Fiche fournisseur** | Ses pièces d'achat et « + Commande ». |
| **Stock & achats, commande conseillée** | Les « commandes en cours » sont le reste à recevoir des commandes ouvertes (sinon la valeur de la photo importée). |
| **Action Center** | Commandes en retard (livraison attendue + délai de grâce), réceptions sans facture fournisseur au-delà du délai réglé. |
| **Paramètres → Gestion commerciale** | Délai de grâce des commandes, alerte réceptions sans facture, tolérance d'écart de prix facture ↔ réception. |

### Règles

- **Cycle.** Commande : Brouillon → Envoyée → Reçue en partie → Reçue ; Soldée (le reliquat n'est plus attendu) ;
  Annulée (rien reçu). Réception : Brouillon → Entrée en stock → Facturée en partie / Facturée. Facture et retour :
  Brouillon → Validé. Séries CF, BR, FF (enregistrement interne), RF, sans trou.
- **Figées par la base** (triggers de la migration 0027) : une pièce d'achat validée ne se modifie ni ne se supprime ;
  seuls statut, clôture et compteurs (reçu, facturé, retourné) évoluent. Seul `src/lib/gestion/purchases.ts` écrit
  ces tables (test).
- **Montants** (`purchases-shared.ts`, seule définition) : ligne = qté × prix (4 décimales, en devise) × (1 − remise) ;
  montant en dirhams = même produit × taux, arrondi une fois ; TVA sur le montant en dirhams.
- **Coût de revient** = (HT en dirhams + frais d'approche répartis) ÷ quantité, 4 décimales. La répartition tombe
  exactement sur le montant du frais (plus grands restes). Il entre dans le **CMUP** à la validation de la réception,
  et `products.cost_price` devient le CMUP (marges, valeur du stock), `last_purchase_price` le dernier coût.
- **La facture fournisseur s'enregistre telle qu'elle est.** Écarts de prix (au-delà de la tolérance) et de quantité
  avec les réceptions, article facturé sans réception : signalés et figés sur la facture, jamais corrigés en silence ;
  le CMUP reste celui de la réception (décision par défaut : un écart se règle avec le fournisseur, avoir ou
  complément). Pas de double facturation d'une réception ; un même n° de facture fournisseur ne s'enregistre qu'une fois.
- **Matériel marketing** (PLV, goodies) : même pièce d'achat, mais son stock reste tenu par `recordMovement()`
  (Activations), en unités entières, au coût de revient au centime.
- **Dépôts.** Une réception entre dans un dépôt interne ; Cospharma et Pharmafirst restent connus par leurs photos.
- **Droits.** Module Achats pour tout ; la réception et le retour sont aussi ouverts au module Stock (profil
  Magasin). Valider = numéroter et faire bouger le stock ; solder ou annuler une commande = Valider sur Achats.
- **Garde-fous ajoutés.** Un fournisseur qui a des pièces s'archive, il ne se supprime pas ; un article sur une pièce
  (vente ou achat) ne se fusionne plus ; la réinitialisation du classeur est refusée dès qu'une pièce existe.

## Lot 4 — inventaires (livré)

### Ce que l'on trouve dans l'application

| Écran | Rôle |
|---|---|
| **Gestion commerciale → Inventaires** (`/gestion/inventaires`) | Liste des inventaires (statut, fiabilité, écart net) et préparation : nom, date, dépôt interne, marques (aucune = tout le stock), à l'aveugle ou non, consignes. |
| **Fiche d'un inventaire** | Préparation modifiable puis **Démarrer** (fige le théorique). En cours : compteurs et nombre de saisies, **rapprochement** (théorique, compté, écart en quantité / valeur / %, motif et commentaire enregistrés à chaque choix ; filtres écarts / non comptés), « Non comptés → 0 », **Valider** ou Annuler. Validé : fiabilité, écarts et **pistes d'explication**. |
| **Compter** (téléphone) | Scan du code-barres à la caméra (Chrome Android), douchette ou saisie de l'EAN, ou recherche par nom ; choix du lot (ou « autre lot » avec péremption) ; quantité ; « Mes saisies » avec retrait. À l'aveugle, aucun théorique n'est envoyé à l'écran. |
| **Paramètres → Gestion commerciale** | Motifs d'écart (référentiel modifiable), comptage ouvert trop longtemps, délai maximal sans inventaire, seuil d'écart récurrent. |
| **Action Center** | Inventaire ouvert trop longtemps, pas d'inventaire récent, écarts récurrents. |

### Règles

- **Cycle.** En préparation → Comptage en cours (théorique et CMUP de chaque article × lot du périmètre figés au
  démarrage ; un article sans stock a une ligne à 0) → Validé (numéro INV sans trou) ou Annulé. Un inventaire clos est
  figé par la base (migration 0028). Seul `src/lib/gestion/counts.ts` écrit les inventaires (test).
- **Plusieurs compteurs** : chaque saisie est une ligne (compteur, heure) ; le compté d'une ligne est la **somme** des
  saisies (lot comparé sans casse). Un article ou un lot trouvé en rayon sans théorique crée sa ligne.
- **Non compté ≠ zéro.** Une ligne sans saisie n'est ni juste ni fausse : elle n'est pas ajustée. « Non comptés → 0 »
  seulement si le rayon a été vérifié vide.
- **Validation** (droit Valider sur Stock) : chaque écart exige un motif ; chaque ligne comptée en écart devient un
  mouvement **AJUSTEMENT_INVENTAIRE** (quantité = écart, sur son lot, à la date du comptage, au CMUP : l'ajustement
  ne modifie pas le CMUP).
- **Fiabilité** (`countStats()`) : part des lignes comptées sans écart, et 1 − |écarts| ÷ valeur théorique ; l'écart
  net et l'écart en valeur absolue sont affichés tous les deux (un net nul peut cacher deux écarts).
- **Pistes d'explication** (`gapLeads()`) : chaque piste sépare la **donnée** (fait mesuré) de l'**hypothèse** ; une
  piste n'apparaît que si sa donnée existe et va dans le sens de l'écart. Manquant : BL daté au plus tard du jour du
  comptage mais validé après son démarrage, BL validés en retard, échantillons remis aux délégués sans sortie au
  journal, lot périmé. Surplus : réception validée après le démarrage, commande ouverte (livraison non réceptionnée),
  avoir « sans retour ». Dans les deux sens : mouvements pendant le comptage. S'y ajoutent l'écart rapporté aux
  sorties de la période (depuis l'inventaire précédent) et le nombre d'inventaires où l'article était déjà en écart.
- **Droits** : préparer, démarrer et compter = Créer sur Stock ; valider, annuler, motifs et « non comptés → 0 » =
  Valider sur Stock. À l'aveugle, seul qui valide voit le théorique.

## Lot 5 — règlements et bascule (livré)

### Ce que l'on trouve dans l'application

| Écran | Rôle |
|---|---|
| **Règlements** (`/gestion/reglements`) | Indicateurs (reste à encaisser, échu, portefeuille, à remettre en banque) et quatre onglets : règlements, échéancier (factures ouvertes par échéance), balance âgée par client (non échu, 1-30, 31-60, 61-90, +90 j), à remettre en banque. |
| **+ Règlement** | Client (ceux qui ont des factures ouvertes d'abord), date, mode, montant, n° de chèque / effet, banque, échéance d'un effet ; **imputation proposée** sur les factures les plus anciennes, modifiable ligne par ligne ; un reliquat reste « non imputé » sur le règlement. |
| **Fiche règlement** | Imputations (désimputer, imputer le reste), suivi : remis en banque → encaissé, ou impayé (motif) ; annulé depuis le portefeuille. |
| **Fiche facture / avoir** | Solde, règlements et avoirs imputés (un impayé est barré), « Encaisser ». Avoir : crédit restant et imputation sur une autre facture du client. |
| **Relances** (`/gestion/relances`) | Clients avec des factures échues, niveau 1 / 2 / 3 selon le retard, message prêt (WhatsApp, e-mail) ; chaque relance est enregistrée. |
| **Envoi au comptable** (`/gestion/exports`) | Sélection des pièces (BL, factures, avoirs) d'une période et ZIP de leurs PDF, **les mêmes que ceux des clients (sans UG)**, avec un récapitulatif CSV ; et un récapitulatif Excel du mois : journal des ventes (base et TVA par taux), TVA par taux, journal des achats, règlements, balance âgée. |
| **Bascule** (`/gestion/bascule`) | Contrôles (bloquants et avertissements), mode (Sage fait foi → période parallèle → COMANET OS émet), reprise des factures ouvertes de Sage, rapport de contrôle mensuel (CA HT et nombre de pièces COMANET OS contre Sage, stock du journal contre la photo Sage). |
| **Action Center** | Factures échues à relancer, effets à remettre en banque, impayés récents, rappel de bascule. |
| **Paramètres** | Niveaux de relance (7 / 30 / 60 j), délai entre deux relances, remise des effets N jours avant échéance ; mode de paiement « encaissé à la réception ». |

### Règles

- **Règlement** (série RG, sans trou) : virement et espèces sont encaissés à l'enregistrement ; chèque et effet
  entrent en portefeuille → remis → encaissé, ou impayé. Client, montant, date et mode sont figés par la base ;
  un règlement ne se supprime pas. Seul `src/lib/gestion/payments.ts` écrit règlements, imputations et relances.
- **Solde d'une facture** (`invoiceBalance()`) = TTC − déjà réglé à la reprise − imputations des règlements valides et
  des avoirs. Un impayé ou un annulé ne solde plus rien : la facture se rouvre d'elle-même. Une imputation ne dépasse
  jamais le solde de la facture ni le disponible du règlement ; réelle et simulation ne se mélangent pas.
- **Avoir** : à sa validation, il solde d'abord sa facture d'origine ; le reste est un crédit client imputable
  ailleurs. Les avoirs validés avant ce lot ont été imputés par la migration 0029.
- **Encours de risque** (plafond d'encours) : soldes des factures moins les seuls règlements **encaissés** et les
  avoirs, plus les BL non facturés ; un chèque en portefeuille reste un risque.
- **Bascule.** `emitsReal()` : une pièce est légale (séries BL / FA / AV) seulement en mode ACTIF, datée du jour de
  bascule ou après, sur un site qui bascule ; sinon simulation (SIM…). En mode ACTIF : projection des ventes,
  **refus d'import** des lignes Sage de ces sites datées après la bascule (`importBlockedByCutover()`, C5). (Le
  stock, lui, n'attend pas la bascule : `productStocks()` lit déjà le **journal** de l'entrepôt COMANET plus les
  dernières photos de Cospharma et Pharmafirst.) Le
  passage à ACTIF exige qu'aucun contrôle bloquant ne reste (date, identité, logo et cachet, stock de départ) et la
  saisie de « BASCULER » ; il se fait depuis la page Bascule, jamais depuis les paramètres.
- **Ventes depuis les pièces (avant la bascule, octobre 2026).** Décision d'Hicham : les ventes des marques que
  COMANET facture elle-même (CygneLab, Alphascience, Makari, Dulcima) viennent des BL saisis ici dès maintenant,
  alors que Sage reste la pièce légale ; Gamarde et Auracos restent importées. Réglage `settings.gestion.salesFromDocuments`
  (date `from` + marques, page Bascule, Administration). À partir de `from`, sur les sites qui basculent, les BL et
  avoirs validés — **simulation comprise** — alimentent `sales` pour ces marques seulement (`projectedLines()`), et
  l'import ignore les lignes de ces marques sur ces sites (`importSkippedForDocuments()`, compté en avertissement, pas
  en erreur). Cospharma et Pharmafirst restent importés pour toutes les marques. Le réglage est refusé si des ventes
  importées de ces marques existent déjà à cette date ou après (elles doubleraient les BL), et chaque enregistrement
  recalcule les ventes projetées (`resyncProjection()` : ajoute les BL déjà validés, retire ce qui ne l'est plus,
  jamais une pièce légale). Conséquence : une vente de ces marques non saisie en BL n'apparaît plus dans Ventes.
- **Reprise Sage** : état des factures non soldées (code client ou nom, n° pièce, date, échéance, TTC, reste) →
  pièces FACTURE figées, source `SAGE_REPRISE`, `reprise_paid` = TTC − reste, sans ligne ni projection (déjà dans
  les ventes importées). Idempotente.
- **Rapport de contrôle** : un écart d'un centime par pièce au plus est affiché comme arrondi.
- **Libellés** : les messages parlent de « vente (sell-in) » et non plus de « vente Sage » (C22).
- **Droits** : règlements = module **Règlements et relances** (séparé de la Facturation depuis la migration 0043 :
  un commercial peut encaisser un chèque sans pouvoir facturer). Créer = saisir, Modifier = imputer / remettre /
  encaisser / relancer, Valider = impayé / annulation ; envoi au comptable = Voir sur Facturation + interrupteur « Exporter des données » ;
  bascule = Administration.

## Retours de tests (septembre 2026)

- **BL** : le prix unitaire s'imprime en **TTC** (P.U. HT × (1 + TVA), au centime) ; le reste du BL est inchangé.
- **Nom du client imprimé** corrigeable sur une pièce validée (fiche de la pièce, droit Valider) : motif obligatoire,
  historique « ancien → nouveau », PDF régénéré (l'ancien reste archivé). Seule la raison sociale imprimée change —
  client rattaché, ICE, adresse, montants et numéro restent figés par la base (migration 0030). À réserver à une faute de frappe.
- **Changer de client** sur un BL ou une commande validés (carte « Client de la pièce », droit Valider ; migration 0050) :
  pour une pièce saisie sur la mauvaise fiche. On cherche le bon client (nom, ville, ICE), on choisit sa raison sociale,
  on donne un motif : client rattaché, nom, ICE, adresse et code client sont repris de la fiche, les ventes projetées de
  la pièce passent sur ce client, la liste des pièces affiche le nouveau nom, le PDF est régénéré, l'historique garde
  « ancien (ICE) → nouveau (ICE) ». Choisir la même fiche reprend son identité actuelle (ICE ou adresse corrigés après
  coup). Lignes, montants, numéro et stock ne bougent pas. Une commande emporte ses BL (il faut aussi Valider sur les
  livraisons s'ils sont validés), y compris une commande annulée après une livraison partielle ; un BL issu d'une
  commande se change par la commande. Refusé pour une facture ou un avoir (pièce fiscale : avoir puis nouvelle
  facture) et pour un BL déjà facturé. Le garde-fou de la base ne laisse bouger client, identité et empreinte que pour
  un BL ou une commande, et seulement depuis `reassignDocumentClient()`.
- **Avoir financier** (Pièces → Avoirs → « + Avoir financier ») : sans facture ni BL, motif sans retour en stock
  (« Remise sur objectifs » par défaut), une ligne par marque avec son montant HT. Sans effet sur le stock ni sur le
  sell-in produit ; validé, il devient un crédit client imputable sur ses factures depuis sa fiche.
- **Export groupé** (Envoi au comptable, ou « Sélectionner et exporter » depuis la liste des pièces) : période,
  types (BL, factures, avoirs), cases à cocher, puis un ZIP assemblé dans le navigateur avec le PDF de chaque pièce
  et un récapitulatif CSV (sans limite de nombre). Le récapitulatif comptable du mois reste disponible en Excel.

## Suite

Le module est complet. Calendrier retenu : période parallèle en décembre 2026, bascule au 1ᵉʳ janvier 2027
(date modifiable dans Paramètres).


---

## P&L (compte de résultat de gestion)

**Où :** Gestion commerciale → **P&L** (`/gestion/pnl`). Réservé aux administrateurs (on y voit les salaires).

**Ce que le P&L compte comme CA de COMANET (HT)**

| Source | D'où vient la donnée | Coût des ventes |
|---|---|---|
| Ventes directes (sites `COMANET`, `DESK DIGITAL`) | fichier de ventes / pièces COMANET OS | (quantité + UG) × prix d'achat de l'article |
| Ventes en bloc aux distributeurs (Gamarde, Ainhoa → Cospharma à l'arrivage) | **saisie** : P&L → Ventes en bloc | coût d'achat saisi sur la vente |
| Commission de prestation (Auracos via Pharmafirst) | 35 % × ventes HT remisées du site `PHARMAFIRST` | aucun |
| Revente des distributeurs (sites `COS`, `CAS`, `CAG`, `DAG`, `CMR`) | fichier de ventes | **hors CA** — affichée pour information |

Les sites se classent dans P&L → Règles. Un site non classé est exclu et signalé.

**Charges.** Marketing : repris du module Marketing (dépenses engagées + dépense de régie + échantillons), rien à ressaisir.
Le reste se saisit dans P&L → Charges : une charge **mensuelle** (salaire, loyer, internet) se déclare une fois ; « Réviser à
partir de » change le montant sans toucher aux mois passés ; « Arrêter » la clôt. Une charge **ponctuelle** tombe sur son
mois. Une charge peut être affectée à une marque (animatrice dédiée) : elle entre alors dans la contribution de la marque.
Les remises exceptionnelles supportées sur les opérations Pharmafirst (3 %) et les gratuités passées en avoir chez Cospharma
(au coût d'achat) sont des charges commerciales.

**Soldes.** Marge brute → contribution après marketing et charges commerciales → résultat d'exploitation (après
personnel et structure) → résultat net (après financier et impôts). Point mort mensuel = charges fixes récurrentes du
dernier mois ÷ taux de contribution observé.

**Ce qui n'est jamais estimé :** un article sans prix d'achat, une vente en bloc sans coût, un mois sans charges. Le
bandeau « À compléter » les liste avec leur montant.
