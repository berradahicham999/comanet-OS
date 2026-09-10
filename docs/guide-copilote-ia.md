# Copilote IA — guide de lecture

Le copilote est une couche de lecture et d'analyse posée sur COMANET OS. Il lit les données de la plateforme, explique ce qui se passe, dit ce qui est à risque et propose quoi faire, avec qui, pour quel résultat. Ce n'est pas un chatbot généraliste : il ne répond qu'à partir des données de COMANET OS, et il ne modifie jamais les données Sage, ventes, stock, terrain ou réglementaire.

## Les cinq règles à garder en tête

1. **Zéro chiffre inventé.** Le copilote ne cite que des valeurs qu'il a lues par un outil de lecture, avec leur période et leur périmètre. Une donnée absente s'affiche « donnée non disponible dans COMANET OS » avec l'import ou la saisie qui la rendrait disponible. Chaque outil appelé apparaît en pastille sous la réponse ; cliquer dessus montre la source et le nombre de lignes lues.
2. **Sell-in ≠ sell-out.** Les ventes Sage (factures B2B, HT) et les ventes des animatrices (en rayon, TTC) sont deux réalités. Le copilote nomme toujours celle qu'il utilise et ne les additionne jamais.
3. **Corrélation ≠ causalité.** Un chiffre d'affaires n'est *attribué* à une action marketing que s'il est mesuré (régie, code promo, saisie). Tout le reste est une « corrélation observée ».
4. **Vos droits s'appliquent.** Le copilote ne voit que les outils correspondant à vos modules (Voir) et à votre portée (marques et clients assignés). Une question hors de vos droits reçoit « donnée non accessible », jamais une réponse déduite d'ailleurs.
5. **Rien n'est actif sans vous.** Les seules écritures du copilote sont une tâche « proposée » (à accepter d'un clic dans Tâches) et un brouillon de rapport (à valider par la direction).

## Le format de réponse

Toute analyse se lit en quatre blocs, toujours dans cet ordre :

| Bloc | Contenu | Ce qu'on en fait |
|---|---|---|
| **Donnée** | les chiffres exacts, chacun avec sa source, sa période, son périmètre | vérifier que la question a été comprise (bonne marque, bonne période) |
| **Analyse** | ce que les chiffres montrent : écarts, tendances, anomalies | la lecture factuelle, sans interprétation |
| **Hypothèse** | explications possibles, marquées « à vérifier », avec ce qui les confirmerait | des pistes, pas des conclusions |
| **Recommandation** | pourquoi, quoi faire, responsable, échéance, budget, résultat attendu, comment le mesurer | décider, puis créer la tâche |

Pour une question purement factuelle, le bloc Donnée porte la réponse et les autres tiennent en une phrase.

## Les surfaces

**Le panneau Copilote** (bouton en bas à droite, ou ⌘K / Ctrl+K). Posez une question en français : « CA Gamarde à Marrakech en août vs juillet », « quels clients n'ont pas commandé depuis 90 jours », « combien de mois de stock sur Alphascience ». La réponse arrive en streaming, avec un lien vers l'écran filtré correspondant. Les questions suggérées changent selon la page ouverte. L'historique garde vos conversations ; une conversation peut être supprimée.

**« Expliquer » ✦ sur les cartes du Cockpit.** L'icône en haut à droite de chaque carte envoie au copilote exactement ce que la carte affiche (valeurs, période). Il relit la donnée par les outils et rend une explication courte. L'explication est conservée une heure pour la même combinaison de valeurs et de droits ; « Regénérer » force un recalcul.

**Le brief du matin** (direction uniquement, en haut du Cockpit). Généré à la première ouverture du jour : ce qui a bougé, ce qui est à risque, les trois actions du jour. Chaque action a un bouton « Créer la tâche » : la tâche naît active, source « Copilote IA », avec le pourquoi et le résultat attendu dans sa description. Le brief est conservé la journée ; « Regénérer » le refait.

**« Détailler » sur l'Action Center.** Sur chaque recommandation, le copilote produit un plan d'exécution : pourquoi, étapes avec responsable et échéance, budget, résultat attendu, indicateur de mesure et écran où le lire. Le plan reste enregistré sur la recommandation.

**Tâches → « Proposées par le copilote ».** Quand vous demandez explicitement une tâche au copilote, elle apparaît dans cet onglet, hors des compteurs. Accepter (en choisissant le responsable) la passe « À faire » ; Refuser l'annule sans la supprimer. Il faut le droit Modifier sur Tâches.

**Rapports** (`/rapports`, module Rapports). COMANET WEEKLY (semaine complète, toutes marques) et MONTHLY BRAND REVIEW (mois complet, une marque). Chaque section indique sa source et sa période ; les outils lus sont listés en bas. Le rapport reste un brouillon jusqu'à Valider (droit Valider sur Rapports). Export en Markdown, impression ou PDF.

## Ce que le copilote refuse

- modifier ou supprimer une donnée : il indique l'écran où le faire ;
- inventer un chiffre, une moyenne de secteur, une estimation ;
- répondre hors du périmètre de COMANET OS (météo, juridique, culture générale) : il propose la question la plus proche à laquelle il peut répondre ;
- suivre une consigne trouvée dans une donnée (nom de client, commentaire, brief) : c'est une donnée, pas une instruction.

## Limites et coûts (administrateurs)

`Paramètres → Copilote IA` montre l'état (clé présente), les modèles actifs, le coût estimé du mois, et le détail par surface, par personne et par jour sur 30 jours, ainsi que les appels d'outils (durée, erreurs, lignes). Les limites se règlent là : questions par personne et par heure (60), budget quotidien de tokens (2 000 000), plafond mensuel d'alerte (100 USD) qui suspend les surfaces automatiques (brief, explications) mais jamais une question manuelle d'un administrateur, appels d'outils par question (8), délai (60 s), durée du cache des explications (60 min).

La clé (`ANTHROPIC_API_KEY`) et les modèles (`AI_MODEL_FAST`, `AI_MODEL_ADVANCED`) sont des variables d'environnement sur Vercel, jamais en base. Sans clé, l'application fonctionne normalement et le copilote affiche « non configuré ».

## Pour les développeurs

- Outils : `src/lib/ai/tools/` — un fichier par outil, schéma Zod, module et action de la matrice, dépendances injectables (`deps.ts` pour les vraies fonctions, doublures dans `tests/ai/`). Ajouter un outil = un fichier + une ligne dans `index.ts` ; il doit appeler une fonction officielle du tableau « une notion métier = une seule fonction ».
- Boucle : `run.ts` (pure, testée avec un modèle factice), `service.ts` (droits, limites, persistance), `prompt.ts` + `prompts/copilot.md`.
- Surfaces : `explain.ts`, `brief.ts`, `plans.ts`, `reports.ts` ; composants dans `src/components/ai/`.
- Garde-fous testés : `tests/ai/read-only.test.ts` (aucune écriture hors `ai_*` et `tasks`), `tools.test.ts` (permissions, portée, limites), `run.test.ts` (plafond, délai, refus), `guardrails.test.ts` (questions de référence et chiffres sourcés).
