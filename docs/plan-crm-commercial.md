# CRM commercial — plan d'architecture

Plan rédigé le 4 octobre 2026 sur `feat/droits-gestion` (`e666c3d`), à partir de la demande de l'associé d'Hicham :

> 1. une gestion des objectifs par client, s'ils sont définis ;
> 2. un listing des clients affectés, avec une fréquence de visite mensuelle, ainsi qu'une barre de progression
>    sur le mois.

Et de la précision d'Hicham : suivre **les visites commerciales par client et par ville, de chaque commercial**.

**Statut au 04/10/2026 : décisions par défaut Q1 à Q6 validées par Hicham, lots 1, 2 et 3 livrés** sur
`feat/crm-commercial` (migration **0045**, la 0044 étant prise par le Marketing OS). Guide d'usage :
`docs/guide-crm-commercial.md`. Règle de lecture, comme pour les plans précédents : tout ce qui existe est
**étendu**, jamais refait ; chaque notion nouvelle a une seule fonction officielle, ajoutée au tableau de `CLAUDE.md`.

**Écarts assumés par rapport à la proposition ci-dessous :**
- La commande prise et le relevé de stock faits pendant une visite sont **déduits** (même commerciale, même
  client, fenêtre de la visite : `visitOutcomes()`), pas stockés : ni `client_visits.order_id` ni
  `client_stock_readings.visit_id`. Les modules Pièces et Stock chez le client restent intacts.
- Fréquence, commercial attitré et objectifs se règlent dans un onglet **« Suivi commercial »** de la fiche
  client (avec la chronologie, l'encours et l'assortiment manquant), pas dans « Identité & conditions ».
- Le contrôle GPS est actif dès le lot 1 (même écran d'information que le médical, version propre au CRM).
- « Fiche pré-visite » et « à voir aujourd'hui » sont calculés sans modèle de langage (raisons mesurées) ; le
  copilote y accède par `get_client_portfolio` et `get_client_visits`.
- Le commercial attitré d'une fiche entre dans la portée « assignés » de la personne (il voit toujours son
  portefeuille) — `resolveFromTables()` de `permissions.ts`.
- Une reprise **sur demande** propose le commercial attitré d'après les affectations existantes des droits
  (en production au 04/10/2026 : 0 client sur 534 avec un commercial attitré, 82 clients et plusieurs villes
  affectés par les droits).

---

## 1. Ce qui existe déjà et qu'on réutilise

| Besoin | Déjà en place | À faire |
|---|---|---|
| « Clients affectés » à un commercial | `clients.account_manager_id` (commercial COMANET attitré, compte utilisateur, migration 0025) ; `user_client_assignments` + `user_city_assignments` (portée des droits, ASSIGNED) ; `clients.sales_rep` (libellé texte venu des fichiers distributeurs : 25 commerciaux Cospharma, inutilisable pour nos commerciales) | Faire d'`account_manager_id` **le** portefeuille (un client = un commercial responsable). Écran d'affectation en masse. Rien de nouveau en base. |
| Ville, secteur | `clients.city`, `clients.sector` (`cityToSector()`, 11 secteurs) | Regroupement de la tournée par ville / secteur. Rien à créer. |
| Objectifs | `objectives` (marque × produit × année × mois, CA HT + unités), import `OBJECTIVES`, page Ventes → objectifs | **Étendre** `objectives` d'une colonne `client_id`. Pas de seconde table d'objectifs. |
| Visites avec chrono, hors connexion, contrôle de présence | Médical : `doctor_visits`, `visit_events` (écriture seule), `recordAction()`, `verifyVisit()` (pur), `/medical/journee` (mobile, file IndexedDB) | Nouvelle table `client_visits` (un médecin n'est pas un client) ; `visit_events` **généralisée** (colonne `client_visit_id`) ; `gps-shared.ts` réutilisé tel quel au lot 2. |
| Relevé de stock en tournée | `client_stock_readings`, canal `TOURNEE_COMMERCIALE`, onglet « Stock en point de vente » | La visite renvoie vers l'onglet existant ; le relevé fait au cours de la visite porte `visit_id`. |
| Prise de commande en visite | Commandes clients (type `COMMANDE`, série BC, saisie mobile, produits habituels) | La visite propose « Prendre une commande » (lien pré-rempli) ; la commande créée pendant la visite est rattachée (`client_visits.order_id`). |
| Rythme de commande, prochaine commande théorique, segment | `clientIntel()` (`nextTheoretical`, `daysUntilNext`, `overdue`, `segment`) | Tri de la tournée par urgence. Rien à recalculer. |
| Barre de progression | `Progress` dans `src/components/ui.tsx` | Réutilisée. |
| Objectif mensuel de visites par personne | `medical_delegates.monthly_visit_objective` | Modèle repris, mais l'objectif commercial se **déduit des clients** (somme des fréquences), il n'est pas saisi par personne. |
| Alertes | Moteur de règles (`src/lib/rules/`), tâches assignables | Trois règles CRM. |

---

## 2. Vocabulaire

- **Portefeuille** d'un commercial : les clients actifs dont il est `account_manager_id`.
- **Fréquence de visite** d'un client : nombre de visites attendues par mois (`clients.visit_frequency_monthly`,
  entier, NULL = non définie). Un client sans fréquence apparaît « fréquence non définie » et **n'entre pas** dans la
  barre de progression ; on n'estime jamais une fréquence.
- **Visite** : un passage physique chez le client (ou un appel / un message si on l'accepte, voir Q4), avec un
  début, une fin, un compte rendu. Une visite compte pour le mois de sa date.
- **Progression du mois** d'un portefeuille : visites effectuées ÷ visites attendues, où les visites d'un même client
  sont **plafonnées à sa fréquence** (passer cinq fois chez le même client ne compense pas quatre clients oubliés).
  Affichée à côté de l'avancement du mois civil (« 12 visites sur 40 attendues · 60 % du mois écoulé »).
- **Objectif client** : CA HT (et unités facultatives) attendu sur un client pour un mois ou une année, si quelqu'un
  l'a saisi. Réalisé = sell-in HT du client dans `sales` (toutes sources), même mesure que le module Ventes.
  Sans objectif saisi : « aucun objectif défini », jamais une valeur déduite de l'historique.

---

## 3. Modèle de données (migration 0044)

### 3.1 `clients` — deux colonnes

```
visit_frequency_monthly  integer      -- NULL = non définie ; 0 = « ne pas visiter » (client servi par distributeur)
gps_lat / gps_lng        numeric(9,6) -- position du point de vente, proposée au premier « Démarrer », validée par le manager (lot 2)
gps_status               text         -- A_CONFIRMER | CONFIRMEE | NULL (lot 2, même logique que le cabinet médical)
```

`account_manager_id` existe déjà (index `clients_account_manager_idx`).

### 3.2 `objectives` — une colonne

```
client_id  uuid references clients(id) on delete cascade  -- NULL = objectif marque / produit (existant)
```

L'index unique `objectives_scope_uq` intègre `coalesce(client_id, uuid-zéro)`. Un objectif client peut porter une
marque (`brand_id`) pour « objectif Gamarde sur la pharmacie X » ; `product_id` reste NULL sur un objectif client.

### 3.3 `client_visits` — nouvelle table

```
id, client_id (not null), user_id (commercial, not null), 
date (date métier, jour de Casablanca), 
status      PLANIFIEE | EN_COURS | EFFECTUEE | NON_EFFECTUEE | ANNULEE
kind        VISITE | APPEL | MESSAGE                          (Q4)
started_at, ended_at                                          (heure serveur, écrites par le chrono seulement)
timing_source  CHRONO | SAISIE_MANUELLE
objective, result, comment, next_action, next_visit_date, not_done_reason
order_id              -> sales_documents.id   (commande prise pendant la visite)
stock_reading_count   int                     (relevés faits pendant la visite, dénormalisé pour l'affichage)
verification_status / verification_reasons / verified_at      (lot 2, mêmes valeurs que le médical)
dedupe_key, import_id, created_at
```

Index : `(client_id, date)`, `(user_id, date)`, `(status)`.

### 3.4 `visit_events` — généralisation

`visit_id` devient nullable ; ajout de `client_visit_id uuid references client_visits(id)` ; contrainte CHECK
« exactement l'un des deux renseigné ». Les triggers « écriture seule » existants restent. `client_event_id` reste la
clé d'idempotence de la file hors connexion.

### 3.5 `client_stock_readings` — une colonne

`visit_id uuid references client_visits(id) on delete set null` : un relevé fait pendant la visite y est rattaché.
`recordReadings()` reste la seule écriture ; elle accepte `visitId`.

### 3.6 `settings.crm`

```
defaultFrequencyByType   { PHARMACIE: 1, PARAPHARMACIE: 1, GROSSISTE: 2, ... }   -- proposition, appliquée à la demande seulement
lateVisitDayOfMonth      20    -- jour du mois à partir duquel un client non visité devient une alerte
maxVisitHours            4     -- clôture automatique d'une visite EN_COURS (même mécanique que le médical)
visitKinds               ["VISITE"]  ou ["VISITE","APPEL","MESSAGE"]   (Q4)
```

---

## 4. Fonctions officielles (à ajouter au tableau de `CLAUDE.md`)

| Notion | Module | Points d'entrée |
|---|---|---|
| Portefeuille d'un commercial, fréquence, visites attendues et réalisées du mois, progression (par commercial, par ville, par client) | `src/lib/crm/portfolio-shared.ts` (pur) + `portfolio.ts` | `expectedVisits()`, `visitProgress()` (plafonnement par client), `monthElapsedPct()`, `portfolioOf()`, `portfolioByCity()`, `setVisitFrequency()`, `assignAccountManager()` (seule écriture d'`account_manager_id` hors fiche client) |
| Objectif client et réalisé | `src/lib/crm/objectives.ts` | `clientObjectives()`, `clientObjectiveProgress()` (réalisé = sell-in HT via la même requête que Ventes), `upsertClientObjective()` |
| Visite commerciale (Démarrer / Terminer / non effectuée / clôture auto / correction) | `src/lib/crm/visits.ts` + `visits-shared.ts` | `recordClientVisitAction()` (seule écriture de `client_visits.started_at/ended_at` et de `visit_events.client_visit_id`), `planVisit()`, `completeReport()`, `autoCloseStaleClientVisits()`, `correctClientVisit()`, `visitStatusLabel()` |
| Chronologie d'un client (visites, commandes, BL, factures, règlements, relevés, animations, tâches) | `src/lib/crm/timeline.ts` | `clientTimeline()` — lecture seule, agrège l'existant, n'écrit rien |

Le contrôle de présence (lot 2) **n'a pas de nouvelle fonction** : `verifyVisit()` de `src/lib/medical/gps-shared.ts`
est pur et prend une position de référence ; il reçoit celle du point de vente au lieu de celle du cabinet. Un test de
`tests/definitions-uniques.test.ts` interdira toute seconde formule de distance ou de progression.

---

## 5. Écrans

### 5.1 Pour la commerciale (mobile) — `/clients/tournee`

- En-tête : **barre de progression du mois** (`Progress`) : « 12 / 40 visites · 30 % », avec un repère du mois écoulé
  et un verdict sobre : « dans le rythme » / « en retard de N visites ». Sous la barre, répartition par ville
  (une ligne par ville : 4/10 Casablanca, 2/6 Rabat…).
- Liste de **ses** clients (portefeuille), groupés par ville, triés par urgence : visites restantes du mois,
  puis `daysUntilNext` (commande en retard d'abord), puis dernière visite la plus ancienne. Chaque ligne : nom, type,
  dernière visite, « à visiter encore N fois ce mois », retard de commande éventuel, segment, objectif client s'il existe
  (réalisé / objectif, en MAD).
- Bouton **Démarrer** sur le client → la visite passe EN_COURS (heure serveur) ; bouton **Terminer** → compte rendu court
  (résultat, prochaine action, prochaine visite) ; raccourcis « Prendre une commande » (ouvre la saisie de commande
  pré-remplie, la commande créée est rattachée) et « Relever le stock » (onglet existant, relevé rattaché).
  « Non effectuée » avec motif (fermé, absent, refus…).
- Hors connexion : même file IndexedDB que `/medical/journee` (route `/api/crm/visit-events`, idempotente).
- Clients « fréquence non définie » listés à part, avec « Définir une fréquence » (si droit Modifier).

### 5.2 Pour le manager / la direction — `/clients/suivi-visites`

- Sélecteur de mois. Un **tableau par commercial** : portefeuille (nb clients), visites attendues, effectuées,
  progression, clients non visités, commandes prises en visite, objectifs clients atteints / définis.
- Vue **par ville** (toutes commerciales) : même indicateurs, pour repérer une ville délaissée.
- Détail d'une commerciale : sa liste de clients avec dernière visite, visites du mois, retard ; export Excel.
- Lot 2 : carte Leaflet des points de vente (positions confirmées), visites vérifiées / à vérifier, comme `/medical/suivi`.

### 5.3 Fiche client — `/clients/[id]`

- Vue d'ensemble : bloc **CRM** : commercial attitré, fréquence, visites du mois (2/1 ✓), dernière visite, prochaine
  prévue, objectif du mois (réalisé / objectif ou « aucun objectif défini »).
- Nouvel onglet **Visites & chronologie** : `clientTimeline()` — visites (avec compte rendu), commandes, livraisons,
  factures, règlements, relevés de stock, animations, tâches ; filtre par type.
- Onglet « Identité & conditions » : champ fréquence + commercial attitré (déjà là) + objectifs du client (saisie
  mois par mois ou annuel).

### 5.4 Affectation en masse — `/parametres/utilisateurs/[id]` (existant) et `/clients`

- Sur la fiche utilisateur : section « Portefeuille » listant les clients dont il est responsable, avec « Affecter des
  clients » (recherche multi-sélection, filtre ville). Distinct de la portée des droits (qui reste ce qu'elle est).
- Sur la liste `/clients` : colonne « Commercial », filtre par commercial, action « Affecter à … » sur la sélection,
  action « Appliquer la fréquence par défaut du type » sur la sélection (explicite, jamais automatique).

### 5.5 Navigation

Sous **Clients** : « Ma tournée » (module `clients`, action `create`), « Suivi des visites » (module `clients`,
action `validate` ou manager). Pas de nouveau module de droits (voir §7).

---

## 6. Règles Action Center (catégorie CLIENTS, module `clients`)

| Règle | Déclencheur | Action proposée |
|---|---|---|
| `crm-client-non-visite` | Après `lateVisitDayOfMonth`, un client avec fréquence ≥ 1 n'a aucune visite EFFECTUEE ce mois | Tâche au commercial attitré « Visiter {client} avant la fin du mois » |
| `crm-portefeuille-en-retard` | Progression du portefeuille < avancement du mois − 25 points | Tâche au manager « Faire le point avec {commercial} » |
| `crm-objectif-client-en-retard` | Objectif mensuel saisi, réalisé < objectif × avancement du mois × 0,7 après le 15 | Tâche « Relancer {client} : {réalisé} / {objectif} MAD » |

Les seuils vivent dans `settings.crm`. Une visite effectuée chez un client en retard de commande est une corrélation
observée, jamais « la visite a généré la commande » — la commande prise **pendant** la visite est le seul lien mesuré
(`order_id`).

---

## 7. Droits et portée

- Aucun nouveau module : tout passe par **`clients`**. Voir = voir les visites des clients dans sa portée ;
  Créer = enregistrer une visite, un compte rendu ; Modifier = fréquence, objectifs, position du point de vente ;
  Valider = affecter un portefeuille, corriger une visite, suivi de toutes les commerciales.
- Portée **OWN** sur `clients` : aujourd'hui traitée comme ASSIGNED. Pour la tournée, « mes clients » = portefeuille
  (`account_manager_id = moi`), quelle que soit la portée ; le suivi des visites des autres exige Valider ou d'être
  `manager_id` de la personne (même logique que `field-access.ts`).
- GPS (lot 2) : heures et positions visibles par les administrateurs et le manager de la commerciale seulement ;
  aucune coordonnée dans le copilote.
- Toute écriture de fréquence, d'objectif ou d'affectation laisse une trace `audit_logs`.

---

## 8. Imports

- `CLIENTS` : deux colonnes facultatives, « Fréquence visites / mois » et « Commercial » (nom ou e-mail d'un compte ;
  inconnu = ligne signalée, fiche non modifiée). Anti-régression : une cellule vide n'efface jamais une valeur saisie.
- `OBJECTIVES` : colonne facultative « Client » (nom fonctionnel ou code) ; une ligne avec client devient un objectif
  client. Même moteur, même idempotence (`dedupe_key` intègre le client).
- Pas d'import de visites au lot 1 (l'historique viendra du CRM actuel si une seconde copie est fournie, comme pour
  les visites médicales : clé `crm:<réf>`, `timing_source = HISTORIQUE`).

---

## 9. Copilote et agent

Deux outils de lecture : `get_client_portfolio` (progression, clients en retard, par ville) et `get_client_visits`
(chronologie d'un client). Le brief du matin des commerciales (lot 3) : « 3 clients à voir aujourd'hui et pourquoi »
— rythme de commande, objectif en retard, stock en rayon bas — rédigé uniquement à partir des outils.

---

## 10. Lots

| Lot | Contenu | Estimation |
|---|---|---|
| **1 — Portefeuille, fréquence, objectifs, visites simples** | Migration 0044 ; `src/lib/crm/` ; `/clients/tournee` (mobile, Démarrer / Terminer sans GPS, hors connexion) ; `/clients/suivi-visites` (par commercial, par ville) ; bloc CRM et onglet chronologie sur la fiche ; affectation en masse ; imports ; 3 règles ; tests unitaires (progression plafonnée, mois écoulé, objectif) | 3 à 4 jours |
| **2 — Contrôle de présence** | Position du point de vente (proposée au premier Démarrer, confirmée par le manager sur la carte), `verifyVisit()` réutilisé, statut VERIFIEE / A_VERIFIER, carte de suivi, corrections tracées | 1 à 2 jours |
| **3 — Intelligence** | Outils copilote, brief de tournée du matin, « assortiment manquant » sur la fiche (produits achetés par les clients comparables), encours et échu du client sur la vue d'ensemble (déjà calculés par `receivables-shared.ts`) | 2 jours |

Le lot 1 répond intégralement à la demande de l'associé.

---

## 11. Questions, avec la décision par défaut

- **Q1 — Qu'est-ce qu'un « client affecté » ?** Par défaut : le commercial attitré de la fiche (`account_manager_id`),
  un seul par client. Alternative : les clients de la portée de droits (villes assignées), mais deux commerciales de la
  même ville compteraient alors les mêmes clients deux fois.
- **Q2 — Fréquence : saisie par client ou par type ?** Par défaut : par client, avec une valeur par défaut par type
  dans les réglages que l'on applique **à la demande** sur une sélection. Un client sans fréquence est « non défini » et
  hors progression.
- **Q3 — L'objectif par client est un CA HT mensuel ?** Par défaut : CA HT (sell-in, toutes sources), mensuel ou
  annuel, avec une marque facultative ; unités facultatives. Pas d'objectif en « nombre de commandes ».
- **Q4 — Un appel ou un message WhatsApp comptent-ils comme une visite ?** Par défaut : **non**. Ils sont enregistrés
  dans la chronologie (`kind` APPEL / MESSAGE) mais seules les visites physiques alimentent la barre. Réglable.
- **Q5 — Les visites doivent-elles être contrôlées par GPS dès le départ ?** Par défaut : lot 2, après quelques
  semaines d'usage du chrono simple. L'heure est toujours celle du serveur.
- **Q6 — Qui saisit les fréquences et les objectifs ?** Par défaut : Modifier sur `clients` (direction et managers) ;
  la commerciale voit, ne modifie pas.

Sans réponse, les décisions par défaut s'appliquent et le lot 1 peut démarrer.
