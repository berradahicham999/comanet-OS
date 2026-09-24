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
  se contredit pas. La sortie au plus proche de la péremption (`allocateFefo()`) servira aux BL du lot 2.
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

## À venir

Lot 2 (ventes : BL, factures, avoirs, PDF), lot 3 (achats, réceptions, CMUP depuis les factures fournisseurs),
lot 4 (inventaires), lot 5 (règlements, bascule, exports comptables) — voir le plan.
