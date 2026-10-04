# Guide — Marketing Operating System

Le module Marketing de COMANET OS pilote la boucle complète :

```
OBJECTIFS COMMERCIAUX → PLAN MARKETING → BUDGET → ALLOCATION → ACTIONS → EXÉCUTION → DÉPENSES → RÉSULTATS → ANALYSE → RÉALLOCATION
```

Chaque page répond à une question précise :

| Page | Question | Chemin |
|---|---|---|
| Command Center | Que faut-il pousser maintenant, avec quel budget, où en est l'objectif ? | `/marketing` |
| Plan marketing | Pour quel objectif et avec quel budget ? | `/marketing/plan` |
| Priorités & actions | Qui doit faire quoi et pour quand ? | `/marketing/priorites` |
| Campagnes, Influence, Digital Ads, Contenu, Activations, Matériel | Comment l'exécuter ? | modules existants |
| Budget & dépenses | Planifié → alloué → engagé → dépensé → reste | `/marketing/budgets` |
| Analytics → Plan vs réel | Le plan tient-il ? Quels produits pousser, maintenir, restocker ? | `/marketing/analytics/plan` |
| Agent marketing | Pourquoi ? | `/marketing/agent`, ⌘K |
| Action Center | Toutes les recommandations, toutes catégories | `/actions` |

## Principes

- **Aucune donnée saisie deux fois.** Le budget du plan est l'enveloppe annuelle de la marque (`budgets`), son CA objectif
  l'objectif de vente annuel (`objectives`), son allocation par canal les lignes de budget (`budget_lines`). Modifier l'un
  depuis le plan met à jour l'autre écran. La consommation est la définition officielle (`budgetConsumption()` : engagé =
  dépenses COMMITTED + SPENT + régie Meta ; dépensé = SPENT).
- **Corrélation ≠ attribution.** Un CA n'est « attribué » que s'il est mesuré (conversion régie, code promo, montant saisi).
  Le reste est une corrélation observée.
- **Donnée manquante = non mesurable.** Aucune valeur n'est estimée. Chaque donnée d'une décision porte son étiquette :
  CONFIRMED (lue telle quelle), CALCULATED (formule officielle), INFERRED (interprétation), MISSING (absente).
- **Le système recommande, la personne décide.** Une recommandation devient une action (et sa tâche) seulement quand
  quelqu'un clique « Approuver ». Une réallocation de budget est une recommandation calculée, jamais appliquée seule.

## Plan marketing

1. **Créer le plan** : marque, nom, période, CA objectif, budget. Le taux marketing (budget ÷ CA) s'affiche aussitôt.
   Le CA objectif et le budget exigent le droit « Valider une dépense » (ou Administration) ; ils peuvent être remplis plus tard.
2. **Objectifs** : CA, sell-out, volume, acquisition, notoriété, lancement, gamme, canal ; chiffré ou qualitatif.
3. **Allocation par canal** : « Proposer une allocation » part de la répartition **réelle** de l'année précédente
   (dépenses engagées + régie, confirmé) et l'ajuste selon le verdict de chaque canal dans Analytics marketing
   (SCALE +20 %, OPTIMIZE −10 %, STOP −30 %, réglables dans Paramètres → Plan marketing). Une réserve de tests peut être
   gardée. Sans historique suffisant, la proposition est « NON MESURABLE » : on saisit à la main. Rien n'est enregistré
   avant « Enregistrer l'allocation ».
4. **Axes stratégiques** : « Développer Sebo Control », « Digital acquisition », « Sell-out / trade »… Chaque axe porte un
   budget ; campagnes, contenus, collaborations et activations s'y rattachent depuis leur fiche (champ « Axe du plan »).
5. **Plan mensuel** : produit prioritaire, objectif et budget du mois. « Générer une action » ouvre le générateur
   pré-rempli (marque, mois, produit, budget restant du mois).
6. **Activer** le plan (droit Valider) : il devient la référence du Command Center et des règles de l'Action Center.

## Opportunités & actions (Priorités & actions)

La page ne liste plus des tâches : elle propose des **actions prêtes à exécuter**.

- **Opportunités du moment** : pour chaque marque, le produit que les données désignent (moteur de décision, sinon produit
  prioritaire du plan, sinon premier contributeur sain) et la meilleure action que le budget disponible permet de
  financer. Chaque carte : ACTION, OBJECTIF, BUDGET, IMPACT, POURQUOI MAINTENANT, STATUT · Voir le plan · Ajouter au plan.
- **+ Générer une action** : marque, objectif, levier, budget (pré-rempli avec le disponible), période, cible, produit →
  « Il vous reste X MAD » → 3 à 5 options classées (budget, impact, ROI potentiel, complexité, score) → fiche complète :
  concept, cible, produits, canaux, budget poste par poste, rétroplanning J-30 → J+7 avec responsables, KPI, résultat
  attendu (hypothèses affichées), score détaillé, données utilisées.
- **Ajouter au plan** crée en une fois : l'action dans le plan de l'année (créé en brouillon s'il manque), l'activation
  (événementiel, trade : budget par poste) ou la campagne (digital, influence, contenu : dépenses prévues), une tâche par
  étape, les contenus au planning éditorial. Le budget disponible du levier baisse aussitôt (« 45 000 → 30 000 MAD »).
- **Actions au plan** : objectif, budget prévu / engagé, impact attendu, avancement des tâches, échéance, statut.
- La bibliothèque livre 60 modèles sur 7 leviers (événementiel, trade, médical / prescripteurs, partenariats, digital,
  influence, contenu). Une action au plan n'est plus reproposée ; une action réalisée récemment est pénalisée ; un produit
  en rupture n'a aucune option ; un modèle saisonnier (Ramadan, Aïd, fête des mères, 8 mars, été, Black Friday, hiver)
  n'est proposé que pendant sa période.
- Les signaux des moteurs (règles, Ads, intelligence marketing) restent accessibles, repliés, avec approuver / refuser.

## Bibliothèque d'actions

Marketing → **Bibliothèque d'actions** (`/marketing/bibliotheque`).

- **Modèles** : liste par levier, filtres (levier, origine, statut, recherche). Un modèle livré se modifie (la version
  d'origine reste récupérable : « Revenir à la version livrée »), se désactive ou se duplique. « + Nouveau modèle » part
  d'un modèle générique du levier choisi.
- **Textes à variables** : `{heros}` (produit vedette), `{produit}`, `{marque}`, `{ville}`, `{cible}`, `{benefice}`,
  `{actif}`, `{angle}` (fiche marketing du produit), `{saison}` ; `{variable|texte}` donne un repli quand la donnée manque.
  Remplir les fiches marketing des produits (bénéfices, actifs, angle) rend les concepts plus précis.
- **Excel** : « Exporter » donne toute la bibliothèque, une ligne par modèle ; compléter ou ajouter des lignes, puis
  « Importer ». Même clé = remplace le modèle ; sans clé = nouveau modèle. Les lignes invalides sont refusées une par
  une, avec la raison.
- **Enregistrer comme modèle** : sur une action générée (Priorités & actions → l'action) ou une activation, le bouton
  ajoute ce qui a été réellement fait à la bibliothèque (budget par poste, calendrier, textes avec le produit, la marque
  et la ville remplacés par des variables). Relire le concept, les objectifs et la portée, puis enregistrer.
- **Ce qui marche par marque** : poids de chaque levier (0 à 100 %), modèles favoris, modèles à écarter, note. Le
  générateur en fait un critère de 10 points sur 100 (favori 10, levier pondéré jusqu'à 7, écarté = jamais proposé) et
  l'affiche comme une **hypothèse de la direction**, jamais comme une mesure. Rempli au départ : Auracos = grosse
  influenceuse ; Gamarde = conseil sell-out au comptoir, vidéo médicale à tester ; CygneLab = point de vente et digital ;
  Alphascience = médecins et un peu de point de vente.
- Droits : Marketing **Modifier** pour créer, modifier, dupliquer, importer et enregistrer comme modèle ; **Valider**
  pour désactiver, revenir à la version livrée, supprimer et pour « ce qui marche par marque ».

## Command Center

Par marque : décision n°1 (quoi pousser), « à ne pas pousser », budget consommé / restant, objectif du mois et projection,
actions ouvertes et en retard, alertes stock. Une marque choisie affiche toutes ses décisions, son plan, ses alertes et
ses retards. En bas : alertes budget, performance Ads, stock, opportunités d'accélération.

## Analytics → Plan vs réel

Par plan : alloué vs engagé vs dépensé par canal (écart signalé), axes (budget vs engagé), plan mensuel (budget vs actions).
Avec une marque : lecture produit du moteur de décision — à pousser, à maintenir, à optimiser, à réduire, à arrêter, à
restocker, à ne pas promouvoir — avec ses raisons.

## Agent marketing

Trois outils de plus : `get_marketing_plan` (cadrage, chaîne budgétaire, axes, plan mensuel), `get_marketing_actions`
(qui fait quoi, retards), `get_unified_decisions` (toutes les recommandations, canal suggéré, montant de réallocation,
statut). L'agent part toujours de l'allocation du plan et du reste disponible pour parler budget ; sans plan, il répond
« non mesurable » et propose de le créer.

## Réglages

Paramètres → **Plan marketing** : historique minimal pour proposer une allocation, réserve de tests, ajustements SCALE /
OPTIMIZE / STOP, délai de revue d'une décision, nombre de décisions affichées. Les seuils de stock, de croissance et de
marge restent ceux de l'Agent marketing et de l'Analytics.

## Droits

- Plan, axes, objectifs, actions : module **Marketing** (Créer / Modifier ; Valider pour activer ou clôturer un plan,
  supprimer un axe ou un objectif).
- Allocation par canal : **Budgets → Modifier** (comme les lignes de budget).
- Enveloppe annuelle et CA objectif : « **Valider une dépense** » ou Administration.
- Rattacher une dépense à une action : **Budgets → Modifier**.

## Migration

`0044_marketing_os` : statut `BLOCKED` sur les tâches, six tables, cinq colonnes de rattachement (NULL sur l'historique).
Aucune ligne existante n'est modifiée ; un plan créé sur une année déjà budgétée reprend le budget, l'objectif et les
lignes existants.

`0047_bibliotheque_actions` : tables `action_templates` (modifications et modèles de l'équipe) et `brand_marketing_playbooks`
(ce qui marche par marque, rempli pour Auracos, Gamarde, CygneLab et Alphascience). Aucune ligne existante n'est modifiée.
