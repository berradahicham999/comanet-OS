# Générateur d'actions marketing — architecture fonctionnelle et UX (04/10/2026)

> **État** : livré sur `feat/action-generator` (migration 0046). Vérifié sur la base locale : génération Auracos /
> Procollagenium / événementiel / 20 000 MAD (5 options), fiche, ajout au plan (activation + 11 tâches + 3 contenus,
> budget 40 000 → 25 200 MAD), non-répétition, opportunités variées par marque, chemin campagne (dépenses prévues), mobile.

Refonte de « Priorités & actions » (`/marketing/priorites`) en **Marketing Opportunity Center**. Problème constaté : le
plan mensuel générait une action par canal au prorata de l'allocation (« Événement — Procollagenium », « Trade —
Procollagenium »…). Ce sont des postes budgétaires, pas des actions. Règle du module :

> COMANET ne donne pas quelque chose à réfléchir, il donne quelque chose à **choisir → approuver → exécuter**.

## 1. Ce qui existe et ce qu'on en fait

| Existant | Rôle | Décision |
|---|---|---|
| `marketing_actions` + tâche 1:1 (`src/lib/marketing-plan/actions.ts`) | ligne du plan, qui / quand / statut | **conservé**, enrichi : `template_key`, `spec` (fiche complète figée), `activation_id`, `event_date`, source `GENERATOR` |
| `tasks` | exécution | **conservé** : une tâche par étape du rétroplanning (J-30 … J+7), rattachée à l'action, responsable proposé par rôle |
| `activations` + `activation_budget_lines` | conteneur d'exécution événementiel / trade, budget prévu → engagé → facturé, reflet unique dans `marketing_expenses` | **réutilisé** : une action événementielle ou trade crée son activation (lignes budgétaires par poste) ; aucun reflet budgétaire écrit à la main |
| `campaigns` + `campaign_products` | conteneur d'exécution digital / influence / contenu | **réutilisé** : une action digitale crée sa campagne (planifiée) ; ses postes deviennent des dépenses **prévues** (`marketing_expenses` PLANNED, `action_id`) |
| `content_items` | planning éditorial | **réutilisé** : les contenus nécessaires naissent au statut initial, datés sur le rétroplanning, rattachés à l'activation ou à la campagne |
| `budgets`, `budget_lines`, `budgetConsumption()`, `budgetByCategory()` | budget planifié, alloué, engagé | **réutilisés** pour le budget disponible par levier (aucune nouvelle somme) |
| `buildProductPerformance()`, `stockRiskOf()`, `decide()` | croissance, stock, décision produit | **réutilisés** : potentiel, rupture (= ne pas pousser), opportunités |
| `categoryVerdicts()` (analytics) | verdict SCALE / OPTIMIZE / STOP par canal | **réutilisé** : historique de performance du levier |
| `settings.forecast.events` | saisonnalité (Ramadan, solaire, rentrée) | **réutilisé** : score saisonnier |
| `generateMonthActionsAction` (répartition par canal) | source des actions génériques | **supprimé** ; le plan mensuel ouvre le générateur pré-rempli (marque, mois, produit, budget du mois) |
| Liste « Priorités de l'équipe » | liste de tâches | **remplacée** par « Opportunités du moment » + « Actions au plan » ; les signaux des moteurs restent accessibles, repliés |

## 2. Nouveaux composants

```
src/lib/action-generator/
  catalog.ts   bibliothèque d'actions : 30 modèles sur 5 leviers (événementiel, trade, digital, influence, contenu)
  engine.ts    PUR : budget disponible, budget proposé, détail poste par poste, rétroplanning, KPI, estimation,
               score de pertinence, non-répétition, classement → 3 à 5 options
  context.ts   SERVEUR : lit les données COMANET (produit, ventes, stock, budget, historique, influenceuses, points
               de vente, villes, coût par résultat Meta, verdicts de canal, saisonnalité, équipe)
  persist.ts   SERVEUR : « Ajouter au plan » → plan (créé s'il manque), action, tâches, activation ou campagne,
               contenus, dépenses prévues — une transaction
  opportunities.ts  SERVEUR : opportunités du moment par marque (produit à pousser × levier le mieux financé)
```

Un **modèle** n'est pas une idée : il porte un nom paramétré (« {Produit} Padel Challenge »), un concept, des cibles et
objectifs compatibles, une fourchette de budget, une structure de coûts par poste, un modèle de portée (coût par contact,
taux d'essai, taux d'achat — hypothèses affichées comme telles), un rétroplanning avec rôles, des KPI, les contenus
nécessaires, un conteneur d'exécution (activation ou campagne), un délai de préparation, une complexité, un délai de
non-répétition et des affinités saisonnières. Le moteur l'**adapte** : produit (mot-héros, prix public réel), budget
disponible, ville des meilleurs clients, influenceuses déjà connues de la marque, pharmacies à cibler, coût par résultat
Meta réel, saison de la période.

## 3. Budget-aware

Budget disponible d'un levier = alloué (`budget_lines` des catégories du levier) − engagé (`budgetByCategory`, ou la régie
pour le digital quand elle fait foi) − réservé (budget prévu des actions ouvertes du levier, non encore engagé). Sans
allocation sur le levier : enveloppe de la marque − consommé − réservé. Sans budget : non défini, la personne saisit son
budget. Ajouter une action de 15 000 MAD réserve 15 000 MAD : « 45 000 → 30 000 MAD » s'affiche après l'ajout et partout.

## 4. Score de pertinence (0 à 100)

| Critère | Poids | Donnée |
|---|---|---|
| Cohérence avec l'objectif | 15 | affinité du modèle |
| Budget | 10 | budget proposé vs budget idéal du modèle, dans le disponible |
| Ce qui marche pour la marque | 10 | conviction de la direction (favori 10, levier jusqu'à 7, non retenu 3, sans conviction 5) — INFERRED |
| Potentiel commercial | 15 | profil du produit (STAR, croissance…) — CALCULATED |
| Historique de performance | 10 | verdict du canal (analytics) — sinon « non mesurable », neutre |
| Saisonnalité | 10 | événements de la période (Paramètres → Prévision) |
| Potentiel de sell-out | 10 | stock (sain, surstock = opportunité, rupture = exclu) |
| Adéquation marque / cible / produit | 10 | cibles et types de produit du modèle |
| Faisabilité | 10 | délai de préparation vs date de la période, complexité |
| Non-répétition | malus | même modèle au plan = exclu ; même modèle ou même type d'activation récent = malus, raison affichée |

Classement : score, puis favori de la marque, puis impact commercial estimé. Chaque option affiche impact, complexité, ROI potentiel, budget.

## 5. UX

- **Priorités & actions** devient : bouton **+ Générer une action** · **Opportunités du moment** (cartes : ACTION, OBJECTIF,
  BUDGET, IMPACT, POURQUOI MAINTENANT, STATUT · Voir le plan · Ajouter au plan) · **Actions au plan** (tableau : action,
  objectif, budget prévu / engagé, impact attendu, avancement des tâches, échéance, statut) · signaux des moteurs et
  décisions repliés.
- **Assistant** `/marketing/priorites/generer` : marque, objectif, levier, budget (pré-rempli avec le disponible), période,
  cible, produit → « Il vous reste X MAD » → 3 à 5 options lisibles en 5 secondes → écartées (avec la raison).
- **Fiche d'option** : concept, cible, produits, canaux, budget détaillé, rétroplanning, tâches et responsables, KPI,
  résultat attendu (hypothèses explicites), score détaillé, justification, données utilisées étiquetées → **Ajouter au plan**.
- **Fiche d'action** : la même fiche figée + avancement des tâches + liens activation / campagne / contenus + dépenses.

## 6. Garde-fous

- Estimations = **hypothèses** (étiquette INFERRED, hypothèses listées) ; un CA n'est jamais « attribué » sans mesure.
- Produit en risque de rupture : aucune option, recommandation « réapprovisionner d'abord ».
- Messages : étape de validation réglementaire sur les modèles à allégations (avant / après, expert, éducation).
- Rien n'est créé sans clic « Ajouter au plan » ; tout est annulable (action annulée = tâches annulées, activation et
  campagne restent dans leurs modules).

## 7. Bibliothèque éditable (phase 3, migration 0047)

- **Plus riche** : 60 modèles livrés (30 de plus) sur 7 leviers. Nouveaux leviers Médical / prescripteurs (staff
  hospitalier, congrès, échantillons, leader d'opinion, dépistage, webinaire) et Partenariats (salles de sport, spas,
  maternités, entreprises). Familles propres à COMANET : formation comptoir, conseil du mois, ventes croisées, grossistes,
  fidélité officine, WhatsApp pharmaciens, animatrice dédiée ; calendrier marocain (ftour, coffrets de l'Aïd, fête des
  mères, 8 mars, Beach Tour, Black Friday, hiver) réservé à sa période ; grosse influenceuse, live shopping, vidéo
  médicale, conseil du pharmacien, drive-to-pharmacie.
- **Moins basique** : nom et concept sont des textes à variables nourris par la fiche marketing du produit (bénéfice,
  actif, angle) ; les actions prescripteurs citent le nombre de médecins A et B de la base médicale liés à la marque.
- **Éditable** : `action_templates` (modifier, désactiver, revenir à la version livrée, créer, dupliquer, importer /
  exporter Excel, enregistrer une action ou une activation réalisée comme modèle). Seule écriture : `library.ts`.
- **Ce qui marche par marque** : `brand_marketing_playbooks`, critère de score de 10 points, affiché comme hypothèse.
- **Plus tard** : variantes d'un modèle (format court / long, budget bas / haut), apprentissage à partir des résultats
  mesurés (activations mesurées, ventes avant / après), suggestions de nouveaux modèles par le copilote.
