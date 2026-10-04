# CRM commercial — guide

Pour suivre les visites commerciales par client, par ville et par commerciale, avec une fréquence de visite
mensuelle, une barre de progression du mois et des objectifs par client. Plan d'architecture :
`docs/plan-crm-commercial.md`. Migration `0045_crm_commercial`.

---

## 1. Mise en route (direction ou manager)

1. **Confier les clients** : *Clients → Portefeuilles*. Un client a **un seul commercial attitré**.
   - La carte « Reprise » propose le commercial de chaque client sans commercial, d'après les affectations
     actuelles des droits : client assigné nommément d'abord, sinon la ville. Rien n'est appliqué sans clic ;
     les cas à plusieurs candidates restent à trancher (filtre « Sans commercial »).
   - Cocher des clients → « Confier » à une commerciale, ou « Retirer le commercial ».
2. **Fixer la fréquence** (visites attendues par mois) sur la même page : un nombre, « Non définie », ou
   « Fréquence par défaut du type » (Paramètres → CRM commercial ; jamais appliquée seule, jamais par-dessus
   une fréquence saisie). **0** = ne pas visiter (client servi autrement). **Vide** = non définie : le client
   n'entre pas dans la barre de progression, il est listé à part.
3. **Objectifs clients** (facultatifs) : fiche client → onglet *Suivi commercial* → « Objectifs du client »
   (CA HT du mois ou de l'année, marque facultative), ou import *Objectifs de CA* avec une colonne **Client**.
4. **Managers** : la fiche utilisateur porte le manager (`manager_id`). Un manager voit le suivi de son équipe,
   les heures et les positions de ses commerciales.

L'import *Clients* accepte deux colonnes : « Commercial attitré » (nom ou e-mail d'un compte ; inconnu =
ligne signalée, fiche inchangée) et « Fréquence de visite » (entier de 0 à 31 ; vide = inchangé).

## 2. La commerciale : Ma tournée (téléphone)

*Clients → Ma tournée* (onglet mobile juste après les commandes).

- **Barre du mois** : visites comptées sur visites attendues, repère de l'avancement du mois, verdict
  « dans le rythme » / « en retard de N visites », détail par ville.
- **À voir en priorité aujourd'hui** : les clients les plus urgents, avec la raison (visite planifiée,
  visites restant à faire ce mois, commande attendue d'après le rythme habituel, objectif en retard, relevé de
  stock à refaire, dernière visite ancienne).
- **Démarrer → Terminer** : l'heure est celle du serveur ; la position est lue à ces deux instants seulement.
  Pendant la visite : « Prendre une commande », « Relever le stock », fiche pré-visite (rythme, produits
  habituels, objectif, dernier compte rendu, assortiment manquant, encours si droits sur les règlements).
- **Compte rendu** après Terminer : objectif, résultat, commentaire, prochaine action, prochaine visite
  (planifiée automatiquement).
- **Responsable absent / non effectuée** : motif, position enregistrée.
- **Hors connexion** : les actions partent toutes seules au retour du réseau (marquées « différées »).
- **Noter un appel** : appel ou message ; il entre dans la chronologie, pas dans la barre (réglable).

## 3. Règles de calcul

- **Visites comptées** : visites effectuées du mois civil, **plafonnées à la fréquence de chaque client**.
  Cinq passages chez un même client ne compensent pas quatre clients oubliés. Le nombre brut est affiché à part.
- **Avancement du mois** : jour du mois ÷ nombre de jours (aujourd'hui compris).
- **En retard** : progression inférieure de plus de N points (réglage, 25 par défaut) à l'avancement du mois.
- **Objectif client** : réalisé = sell-in HT du client (toutes sources, même mesure que Ventes). Objectif
  annuel = un douzième par mois. Avant le 15 (réglable) : « pas encore comparable ». Sans objectif saisi :
  « aucun objectif défini », jamais une valeur estimée.
- **Commande prise pendant la visite** : commande client saisie par la commerciale chez ce client entre
  10 min avant le démarrage et 2 h après la fin (réglable). C'est le seul lien mesuré entre une visite et une
  vente ; toute hausse de ventes après des visites reste une **corrélation observée**.
- **Assortiment manquant** : produits achetés sur 12 mois par au moins 40 % des clients comparables (même
  type, même ville sinon même secteur, CA de la moitié au double, au moins 5) et pas par ce client.
  Corrélation observée, jamais une prévision.

## 4. Suivi des visites (manager, direction)

*Clients → Suivi des visites* : par commerciale (progression, rythme, clients pas encore visités, visites
effectuées dont hors portefeuille, non effectuées, appels, commandes en visite, objectifs atteints / en retard)
et par ville ; filtre par ville et par mois ; export Excel (interrupteur « Exporter »).

Le détail d'une commerciale reprend son portefeuille, ses villes, la liste des visites du mois et, pour la
direction et son manager, la **carte** (démarrages, fins, trajet d'une journée) et le **contrôle de présence**.

## 5. Contrôle de présence (même moteur que le médical)

- Statut **Vérifiée / À vérifier / Non vérifiée** recalculé à chaque événement (rayon du point de vente,
  précision GPS, durée, envoi différé, horloge, déplacement impossible).
- La **position du point de vente** est proposée au premier Démarrer, puis **validée ou déplacée** sur la
  carte par la direction ou le manager. Tant qu'elle n'est pas validée, la visite reste « à vérifier ».
- **Corrections** : heures ou statut, motif obligatoire, journal et audit. Une position ne se corrige jamais.
- Visites oubliées : clôture automatique après 4 h (réglable), durée non mesurée.
- Les heures et positions ne sont visibles que de la **direction et du manager** de la commerciale ; le
  copilote n'en reçoit aucune.

## 6. Droits

Aucun nouveau module : tout passe par **Clients**. Voir = suivi de ses propres visites et de ses clients ;
Créer = Ma tournée, comptes rendus, appels ; Modifier = fréquences et objectifs ; Valider = confier un
portefeuille, ressaisir une visite faite sans chrono, suivi de toutes les commerciales. Le commercial attitré
d'une fiche la voit toujours, même hors de ses villes.

## 7. Action Center (catégorie Commercial)

- Clients prévus non visités (à partir du 20 du mois), une carte par commerciale.
- Portefeuille en retard de rythme (à partir du 8), tâche proposée au manager.
- Objectif client en retard (à partir du 15).
- Visites à vérifier, positions de point de vente à valider, clôtures automatiques et comptes rendus en retard
  (direction et manager seulement).

## 8. Copilote

`get_client_portfolio` (progression d'une commerciale ou de l'équipe, clients à voir) et `get_client_visits`
(chronologie et fiche pré-visite d'un client). Lecture seule, aucune position.

## 9. Tests

```bash
npm test
CRM_IT=1 DATABASE_URL=<base jetable> node --conditions=react-server --import tsx scripts/crm-integration.ts
```
