# Guide — Studio créatif (Intelligence contenu)

Le Studio créatif prolonge le générateur d'actions : au lieu de « voici des idées de contenu », COMANET dit **quoi produire,
pourquoi, pour quel produit, sur quelle tension consommateur, par quelle mécanique créative, et exactement comment le
tourner**. Rien n'est reconstruit : le produit à pousser vient du moteur de décision marketing, le budget du générateur
d'actions, la fiche produit de `products`, la mémoire de performance des créatives Meta étiquetées, des contenus publiés et
des collaborations ; le contenu produit part dans le planning éditorial existant.

```
DONNÉE → PRIORITÉ (moteur marketing) → OBJECTIF → PRODUIT → TENSION CONSOMMATEUR → OPPORTUNITÉ CRÉATIVE
       → CONCEPT (3 à 5, territoires variés) → PACKAGE DE CONTENU → BRIEF DE PRODUCTION → PLANNING ÉDITORIAL
       → PERFORMANCE (Meta, portée / engagement, influence) → APPRENTISSAGE CRÉATIF → prochaines opportunités
```

## Écrans

| Écran | Question | Chemin |
|---|---|---|
| Opportunités créatives | Que produire maintenant, pour quel produit, quelle tension, quelle mécanique ? | `/marketing/studio` (onglet par marque) |
| Opportunité | Pourquoi maintenant, score détaillé, tension en huit facettes, mécanique ; génération des concepts | `/marketing/studio/opportunite/<clé>` |
| Content Studio | Stratégie, concept, accroches, script, découpage, plans, direction, variations, organique, payant, production | `/marketing/studio/concept/<id>` |
| Brief de production | Document imprimable pour l'équipe, la créatrice ou l'agence | `/marketing/studio/concept/<id>/brief` |
| Paramètres | Fenêtre de fatigue, seuil de doublon, nombre d'opportunités et de concepts, budget de test, modèles | `/parametres` → Studio créatif |

L'action principale est **« Explorer l'opportunité »**, pas un formulaire de préférences : COMANET connaît déjà la marque, le
produit, l'objectif, le budget, la saison, les contenus récents et la performance.

## Ce que lit le studio (jamais recalculé à la main)

| Donnée | Source officielle |
|---|---|
| Produit à pousser, priorité commerciale, « à ne pas pousser » | `buildRecommendations()` (moteur de décision marketing), produit prioritaire du plan du mois, premier contributeur sain |
| Budget disponible par levier (contenu, digital, influence), saison, coût par résultat Meta, convictions de la direction | `loadGeneratorData()` du générateur d'actions |
| Fiche produit (bénéfices, actifs, allégations, angle, cible, prix) | table `products`, telle quelle |
| Performance et stock du produit | `buildProductPerformance()` |
| Mémoire créative | créatives Meta (`perfByLevel("creative")` + `autoTags()`), contenus publiés du planning (portée, engagement, étiquetés par `autoTags()` ou par leur concept), collaborations d'influence |
| Concepts récents (non-répétition) | `creative_concepts` sur la fenêtre de fatigue |

## Les couches de raisonnement

1. **Contexte business** (`context.ts`) — marque, produit, objectif, priorité, étape du tunnel, audience, budget, saison.
2. **Intelligence produit** (`product-intel.ts`) — catégorie créative (soin, dermo-cosmétique, solaire, complément), rôle dans
   la routine, discipline des allégations, complétude de la fiche. Un champ absent est listé « à compléter », jamais estimé.
3. **Intelligence consommateur** (`consumer.ts`) — vingt-deux tensions par catégorie (problème, frustration, désir, objection,
   croyance, idée reçue, question, émotion), activées par les mots de la fiche produit ; l'IA choisit la plus forte et la
   reformule, elle n'en crée pas.
4. **Opportunité** (`opportunities.ts`) — meilleure mécanique par tension (objectif, tunnel, convictions de la direction,
   apprentissages, fatigue, garde-fous de fiche), score explicable, « pourquoi maintenant », territoires saturés, budget.
5. **Concepts** (`stages.ts` + `rules.ts`) — un par mécanique, territoires variés : grande idée, insight, message central
   (bénéfice de la fiche), rôle du produit, réaction attendue, structure, direction visuelle, versions organique et payante.
6. **Revue** — huit axes (stratégie, créativité, produit, audience, marque, production, conformité, répétition) ; un concept
   FAIL ou porteur d'une allégation bloquante est écarté s'il en reste assez.
7. **Package** — cinq accroches, deux scripts scène par scène, découpage, plans, direction visuelle et de jeu, versions
   organique et payante, trois accroches payantes, trois CTA, trois stories, miniature, légende, hashtags, livrables, notes.
8. **Variations** — accroche (5), ouverture (3), structure (3), persona, angle émotionnel, CTA, format : chaque variation dit
   ce qui change.
9. **Brief** (`brief.ts`) — vingt sections, imprimable, recopié dans le champ « brief » du contenu créé au planning.

## Taxonomie créative

Cinq territoires (éducation, UGC / témoignage, storytelling, performance, émotion), trente-huit mécaniques structurées
(`territories.ts`) : déclencheur psychologique, étapes du tunnel, objectifs, types de produit, accroches types, structures
narratives, patrons visuels, CTA, adéquation organique / payant, risque de fatigue, personas, formats. Chaque mécanique porte
l'étiquette d'angle Meta correspondante (`autoTags()`) : c'est le pont entre la mémoire publicitaire et la génération.

## Score, empreinte, fatigue, apprentissage

- **Score** (`scoring.ts`) : dix critères /10 pour un concept (accroche, pertinence consommateur, pertinence produit,
  adéquation marque, différenciation, arrêt du scroll, tension émotionnelle, conversion, faisabilité, historique), huit pour
  une opportunité ; chaque critère a ses points, sa raison et son étiquette CONFIRMED / CALCULATED / INFERRED / MISSING. Les
  parts estimées par l'IA sont INFERRED ; sans IA une heuristique prend le relais et le dit. **Aide à la décision, pas une mesure.**
- **Empreinte** (`fingerprint.ts`) : territoire | mécanique | tension | accroche | produit. Similarité pondérée, doublon au-delà
  de `settings.creative.duplicateThreshold`, pénalité de répétition, usage des territoires sur la fenêtre de fatigue,
  territoires saturés (« COMANET recommande un autre angle »).
- **Apprentissage** (`learning.ts`) : phrases du type « les créatives problème → solution coûtent 22 % de moins par conversation
  pour CygneLab » ou « l'éducation engage fort en organique mais coûte cher en payant : à garder en organique ». Volume
  minimal (`minLearningCreatives`, `adsIntel.winnerMinSpend`), toujours une **corrélation observée**, métrique absente
  jamais remplacée. Les apprentissages entrent dans le classement des mécaniques et le critère « adéquation historique ».

## Conformité (déterministe, avant et après l'IA)

`compliance.ts` : formulations interdites par catégorie (thérapeutique et pathologie en cosmétique ; guérison, pathologie,
perte de poids en complément ; protection totale en solaire), ingrédient cité absent de la fiche, chiffre ou délai non
sourcé, « cliniquement prouvé » hors fiche, mentions obligatoires (complément, solaire). Un **BLOCK** empêche l'envoi en
production ; un WARN exige la relecture réglementaire, qui reste obligatoire dans tous les cas.

## IA : étapes séparées, sortie structurée

Pas de prompt unique : cinq étapes (`consumer`, `concepts`, `review`, `builder`, `variations`), chacune avec son prompt
versionné (`src/lib/ai/prompts/creative-*.md`, règles communes dans `creative-shared.md`), un contexte JSON (données, jamais
des instructions) et une sortie validée par un schéma Zod (outil `rendre` forcé ; une non-conformité est renvoyée au modèle
une fois). Même client, mêmes limites (`settings.ai`), même suivi de coût que le copilote (surface « creative »). Modèles :
`settings.creative.conceptTier` (raisonnement) et `builderTier` (sortie longue). **Sans clé ou sur échec**, le squelette
déterministe (`rules.ts`) prend le relais et chaque écran l'indique (« squelette sans IA »).

## Écritures

Seul `store.ts` écrit `creative_concepts` et `creative_packages` ; l'envoi en production écrit un `content_items` complet
(brief, message, accroche, légende, hashtags, CTA, contraintes, mentions, livrables), son `content_products`, ouvre la tâche
du responsable (`syncBriefTask`) et marque le concept SENT, dans une transaction. Chaque décision laisse une trace `audit_logs`.
Aucune publication automatique, aucune écriture vers Meta.

## Droits

Voir : Marketing · Voir. Générer les concepts, construire, variations, envoyer au planning : Marketing · Créer. Approuver,
écarter (motif), archiver : Marketing · Modifier. L'outil du copilote `get_creative_opportunities` est en lecture seule.

## Tests

`tests/creative.test.ts` : taxonomie, tensions, intelligence produit, conformité, empreinte et fatigue, apprentissage,
notation, opportunités (dont budget, rupture, saturation, forçage), concepts et package déterministes sur trois catégories
(Gamarde, CygneLab, Auracos), variations, brief, et garde-fous d'écriture. Le registre d'outils du copilote compte le
nouvel outil.

## Limites connues

- La mémoire créative dépend de ce qui est mesuré : sans synchronisation Meta, sans portée / engagement saisis sur les
  contenus publiés, sans collaborations analysées, aucun apprentissage n'est énoncé (et le studio le dit).
- Les apprentissages sont des corrélations ; le lien contenu → vente n'est jamais présenté comme une attribution.
- Les textes déterministes (sans IA) sont des squelettes à rédiger ; les textes IA sont à relire avant tournage.
- Les durées, KPI et budgets de test sont des repères, pas des mesures.
