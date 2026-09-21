# Stock chez le client (point de vente)

Répond à la question : **« quel stock ai-je chez ce client, sur quels produits, depuis quand,
et qui l'a relevé ? »**

Le point de vente **est** le client (`clients`) : il n'existe pas de second référentiel. Le stock
chez le client est une donnée terrain, distincte du stock COMANET (`stock_snapshots`) ; Sage reste
la source de vérité du sell-in et n'est jamais modifié.

## Modèle

Une seule table, `client_stock_readings` (migration `0021`) : `client_id`, `product_id`,
`quantity`, `read_at`, `user_id`, `channel` (`ANIMATION` | `TOURNEE_COMMERCIALE` | `IMPORT`),
`animation_id` (nullable), `comment`, `created_at`. Index `(client_id, product_id, read_at)`.

- **Un relevé = une photo datée.** Une ligne par relevé, jamais d'écrasement : l'historique est
  conservé. Le **stock actuel** d'un produit = son **dernier relevé**.
- Seule exception : corriger une animation remplace les relevés **de cette animation** (sinon
  chaque correction fabriquerait un faux relevé daté du même jour).
- Aucun relevé antérieur n'existait en production au 21/09/2026 (`animation_lines.stock_observed`
  n'avait jamais été rempli) : pas de reprise.

## Une seule logique métier (`src/lib/client-stock*.ts`)

| Notion | Fonction |
|---|---|
| Écriture (deux canaux) | `recordReadings()` — seule écriture, testée par `definitions-uniques` |
| Stock actuel, historique | `latestByProduct()` |
| Ancienneté | `agingOf()` — vert `< freshDays`, orange `< staleDays`, rouge au-delà, gris jamais relevé |
| Écart vs relevé précédent | `deltaOf()` |
| Couverture estimée | `estimatedCoverageWeeks()` = stock relevé ÷ rythme hebdomadaire de sell-in Sage sur la fenêtre — une **estimation**, `—` sans livraison |
| Droits par canal | `canRecordReading()` |

Seuils dans **Paramètres → Stock chez le client** (`settings.clientStock`) : `freshDays` (15),
`staleDays` (45), `coverageWindowDays` (90), `stockoutSelloutDays` (30). Rien en dur.

## Guide utilisateur — animatrice

Pendant la journée d'animation, dans **Saisie terrain** (mobile) :

1. Choisir le point de vente et ajouter les produits vendus.
2. Sur chaque ligne, le champ **« rayon »** est pré-rempli avec le dernier relevé connu chez ce
   point de vente (et sa date apparaît sous le nom du produit). Le corriger si le stock a changé,
   ou le laisser tel quel pour confirmer.
3. **Enregistrer** : les ventes et les relevés sont écrits ensemble (canal *Animation*, daté du
   jour de l'animation). Une animation prévue ou annulée ne constitue pas un relevé.

Le champ reste facultatif : une ligne vendue sans stock renseigné n'écrit aucun relevé.

## Guide utilisateur — commercial

Pendant la tournée, depuis la **fiche client**, onglet **« Stock en point de vente »** :

1. **Relever le stock** : la liste des produits (recherche, filtre par marque) montre pour chacun le
   dernier stock connu et sa date ; le champ est pré-rempli avec ce dernier relevé.
2. Ne modifier que ce qui a changé (gros champs, clavier numérique, boutons + / −). Cocher
   **« Relevé complet »** pour enregistrer tous les produits affichés, même inchangés.
3. **Enregistrer le relevé** : une ligne par produit modifié (ou affiché), canal *Tournée*, daté du jour.

Droits : **Créer sur Clients**. En portée *Assignés*, uniquement les clients de son portefeuille
(Utilisateurs & droits → clients assignés) ; en portée *Tout*, tous les clients. Aucun rôle
« Commercial » n'est créé : c'est la matrice qui décide.

## Consultation

- **Fiche client, onglet Stock** : dernier stock par produit, date + badge d'ancienneté, auteur +
  badge de canal, écart vs relevé précédent, sell-in Sage et sell-out animation sur la fenêtre
  (nommés, jamais additionnés), couverture estimée. Filtre par marque, tri par quantité ou
  ancienneté, historique dépliable par produit avec courbe dès 3 relevés.
- **Clients → Stock chez les clients** (`/clients/stock`) : un point de vente par ligne (dernier
  relevé, produits relevés, ruptures, ancienneté, dernier auteur et canal, commercial en charge).
  Filtres marque, ville, auteur, commercial, canal, ancienneté ; export Excel (interrupteur
  « Exporter »).

## Action Center

- **Rupture chez un client actif** (`client-stockout`) : dernier relevé à 0 et sell-out animation
  > 0 sur `stockoutSelloutDays` → *Proposer réassort*, proposé au commercial en charge du client.
- **Relevé de stock à faire** (`client-stock-stale`) : dernier relevé plus vieux que `staleDays` →
  proposé à l'animatrice si une animation y est prévue, sinon au commercial en charge.

Le « commercial en charge » d'un client = compte actif avec Créer sur Clients ayant ce client en
portefeuille. Sans portefeuille configuré, la tâche retombe sur le rôle Trade.
