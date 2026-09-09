# Analytics marketing — guide de lecture

Ce guide explique, sans jargon, comment lire chaque page de **Marketing → Analytics marketing**, ce que veut dire chaque chiffre, et quoi décider à partir de quoi. Tout ce qui est décrit ici se règle dans **Paramètres → Analytics marketing** : rien n'est figé dans le code.

## Les deux règles à garder en tête

1. **Un chiffre absent n'est jamais un zéro.** Quand une donnée manque, la page écrit « données insuffisantes », la raison, le responsable et un lien pour corriger. Un ROI n'est jamais calculé sur une dépense sans montant ou sans CA mesuré.
2. **Mesuré ≠ observé.** « Mesuré » (badge vert) vient de la régie, d'un code promo ou d'une saisie : c'est de l'argent réellement relié à une action. « Corrélation observée » (badge jaune) compare deux périodes : ça ne prouve pas que le marketing a causé la vente. La complétude affichée à côté (« basé sur 82 % des dépenses ») dit sur quelle part de la dépense le chiffre repose.

## D'où viennent les chiffres

La couche de faits est recalculée après chaque import, synchronisation ou saisie, et chaque matin à 6h30. Elle lit :

| Source | Ce qui devient une dépense | Ce qui devient un résultat |
|---|---|---|
| Régie (Meta, TikTok, Google) | dépense des journées closes, en MAD | impressions, portée, clics, conversations, leads, achats |
| Dépenses marketing (Command Center), y compris le reflet des activations | prévu / engagé / dépensé selon le statut | conversions saisies |
| Influence | cachet + valeur produit, selon l'étape du pipeline | portée, vues, engagement, code promo |
| Planning éditorial | budget du contenu (s'il y en a un) | contenu publié, portée, engagement saisis |
| Animations terrain | coût saisi, sinon **coût journalier** (coût mensuel chargé ÷ jours attendus) | jours, clients conseillés, échantillons, **sell-out TTC** par produit |
| Échantillons médicaux | prix d'achat (sinon prix COMANET) | échantillons remis |

Une dépense saisie à la main sur Meta / TikTok / Google est **écartée** si la régie couvre le même mois pour la même marque : sinon la campagne serait comptée deux fois. Une dépense liée à plusieurs produits est **répartie** au prorata du sell-in récent (ou à parts égales, au choix dans Paramètres). Une animation prend sa marque et ses produits sur ses lignes de vente.

## Page Synthèse

**Les six chiffres du mois** : dépense (et part de l'enveloppe annuelle consommée), CA sell-in (et atteinte d'objectif), ROI mesuré avec sa complétude, meilleur et pire couple marque × canal, actions ouvertes. Le meilleur et le pire couple sont classés par **coût par résultat relatif à la médiane de leur canal** : un canal ne se compare qu'à lui-même (on ne compare pas une conversation Meta à un dirham de sell-out), il faut au moins deux marques mesurées sur le canal.

**Tendance 13 mois** : dépense, complétude, sell-in, sell-out et intensité par mois. Un mois « pas d'import » n'a pas de ventes Sage : les comparaisons qui le touchent affichent « pas comparable ».

**Poser une question** : une phrase en français. La page reconnaît la marque, le canal, la ville, le produit et la période par mots-clés et répond en quatre parties : Donnée, Analyse, Hypothèse, Recommandation. Ce qu'elle n'a pas compris est listé ; elle ne devine pas.

Décider : si la dépense monte et que le CA ne suit pas, aller sur Par canal ; si une marque décroche de son objectif, aller sur Par marque ; si l'Action Center propose une réallocation, la lire d'abord ici.

## Page Par marque

| Colonne | Signification | Quoi décider |
|---|---|---|
| Sell-in HT | ventes Sage de la période | — |
| Sell-out TTC | ventes en rayon constatées par les animatrices | un sell-out qui monte sans sell-in annonce des commandes |
| Dépense | dépense marketing mesurable | — |
| Intensité | dépense ÷ sell-in, en % | au-dessus de la moyenne du portefeuille sans CA en face : à questionner |
| Part budget / part CA | poids de la marque dans les dépenses et dans le CA | l'écart en points classe la marque : **sur-investie** (plus de budget que de CA), **sous-investie**, **alignée** (tolérance ± N points) |
| ROI mesuré / retour observé | voir les deux règles | ne jamais arbitrer sur un retour observé seul |
| Objectif | sell-in ÷ objectif proratisé | sous 100 % sans dépense : la règle « marque sans marketing » alerte |
| Santé | score 0-100 pondéré (objectif, retour, intensité, stock, données) ; les composantes non mesurables sortent du dénominateur, le score dit sur combien il repose | comparer les marques entre elles, pas dans l'absolu |

**Matrice part du budget × part du CA** : au-dessus de la diagonale, la marque fait plus de CA que sa part de budget (sous-investie) ; en dessous, l'inverse. **Mix de canaux** : la barre noire marque la part moyenne du portefeuille.

Le bouton **Revue mensuelle** ouvre la page imprimable d'une marque pour un mois donné.

## Page Par canal

Pour chaque canal : dépense, part, **résultat propre** (la métrique choisie pour ce canal dans Paramètres : conversations pour Meta tant qu'il n'y a pas d'achats, sell-out pour l'animation, portée pour l'influence…), coût par résultat, tendance vs période précédente, CA mesuré.

**Verdict par canal × marque**, toujours « pourquoi » puis « quoi faire » :

- **Régie** : le moteur Digital Ads existant (seuils dans Paramètres → Publicité). Les campagnes « Messages » (ni achat ni lead) sont jugées au coût par conversation, pas mises en STOP faute d'achats.
- **Animation** : sell-out TTC ÷ coût. Rentable (SCALE) au-dessus de l'objectif journalier (ex. 1 700 MAD TTC par jour, soit 5,3 fois un coût de 318 MAD), STOP sous le plancher, OPTIMIZE entre les deux.
- **Autres canaux** : coût par résultat vs période précédente (hausse → OPTIMIZE, baisse → SCALE) et vs les autres marques sur le même canal (très au-dessus → STOP). Sous la dépense minimale : À SURVEILLER, jamais « stable » par défaut.
- **Véto stock** : un SCALE devient MAINTAIN si un produit poussé est en rupture ou sous un mois de couverture.

Décider : STOP et OPTIMIZE d'abord, dans l'ordre de la dépense. Un SCALE n'augmente que par paliers (part maximale par mois dans Paramètres).

## Page Par produit

Quatre cas, croisés avec le stock :

| Cas | Définition | Décision |
|---|---|---|
| Poussé et qui se vend | dépense ≥ seuil ou ≥ N actions, et croissance ≥ N % ou au-dessus de la médiane de la marque | continuer, surveiller la couverture |
| Poussé et qui ne se vend pas | poussé, sans croissance | arrêter ou changer d'angle (message, canal, cible) |
| Pas poussé et qui se vend | pépite | amplifier **si le stock suit** |
| Pas poussé et qui ne se vend pas | dormant | traiter avec le stock : déstockage, retrait, offre ciblée |

La colonne Stock interdit de pousser un produit en **rupture** ou en **tension** (moins d'un mois), et signale le **surstock** que le marketing peut écouler. Sans instantané de stock, aucune recommandation de pousser n'est faite. Attention : un pic exceptionnel le mois précédent fait passer un bon produit en « ne se vend pas » ; lire la croissance avec la tendance de la marque.

## Page Qualité des données

Chaque manque a un compteur, un responsable et un bouton Corriger : dépenses sans produit, campagnes de régie non rattachées, animations sans ligne produit, contenus publiés sans performance, activations terminées sans résultats, mois sans import Sage, marques sans enveloppe ou sans objectif, produits sans prix d'achat, instantané de stock ancien. La **complétude** globale est la moyenne des contrôles pondérables ; elle s'affiche sur chaque page.

## Action Center et cockpit

Cinq règles alimentent l'Action Center, chacune transformable en tâche en un clic : réallocation (« déplacer X MAD du canal A vers le canal B pour la marque M », avec résultat attendu et niveau de confiance), dérive budget (engagé au-delà du plan par catégorie), coût par résultat en hausse N semaines de suite, marque sans dépense alors que l'objectif décroche, produit poussé sans effet après la fenêtre d'attribution. Le cockpit reprend dépense, ROI mesuré, meilleur et pire couple, nombre de réallocations et complétude sur 30 jours.

## Revue mensuelle de marque

`/marketing/analytics/revue/<marque>?mois=AAAA-MM` : chiffres du mois comparés au mois précédent et à N-1, canaux et verdicts, décisions proposées, produits du mois, tendance 12 mois, et ce qui manque pour fiabiliser la revue. Le bouton « Imprimer / enregistrer en PDF » produit la version à partager.

## Paramètres

Tout est dans **Paramètres → Analytics marketing** : fenêtres avant / après, mode de répartition, coût de l'animatrice (mensuel chargé, jours par mois, objectif de sell-out par jour), poids du score de santé, seuils des quatre cas et du surstock, seuils de verdict par canal, réallocation, alertes ; puis les canaux (résultat propre et repli), les correspondances source → canal, et le dictionnaire de métriques (libellés, sens, seuils).
