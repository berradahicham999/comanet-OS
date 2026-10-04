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
5. **Plan mensuel** : produit prioritaire, objectif et budget du mois. « Générer les actions » crée une action par canal au
   prorata de l'allocation, chacune avec sa tâche (échéance fin du mois). Les montants restent modifiables.
6. **Activer** le plan (droit Valider) : il devient la référence du Command Center et des règles de l'Action Center.

## Priorités & actions

Une action = un budget prévu, un canal, un produit, un objectif, une justification, un résultat attendu, **et une tâche**
(responsable, échéance, priorité, statut : À faire / En cours / Bloquée / Terminée / Annulée). Le statut est le même dans
Tâches, dans le plan et dans l'Action Center. Les dépenses saisies dans Budget & dépenses se rattachent à l'action
(engagé de l'action = dépenses COMMITTED + SPENT rattachées).

La page classe les actions ouvertes : retards d'abord, puis priorité, puis échéance. Dessous, les **décisions à prendre**
(règles de l'Action Center, intelligence Ads, intelligence marketing) dans une structure commune : POURQUOI, DONNÉES
étiquetées, IMPACT, CONFIANCE, ACTION. Approuver crée l'action ; refuser garde la raison (et écarte la recommandation de
l'Action Center 30 jours) ; une décision approuvée dont la tâche est terminée devient « exécutée », puis « mesurée » quand
on note le résultat observé ; passée sa date de revue sans exécution, elle expire.

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
