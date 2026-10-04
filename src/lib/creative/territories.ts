/**
 * Taxonomie créative COMANET — cinq territoires, trente-huit mécaniques structurées (déclencheur psychologique,
 * étapes du tunnel, objectifs, types de produit, accroches, structures narratives, patrons visuels, CTA,
 * adéquation organique / payant, risque de fatigue). Données pures, réutilisables par le moteur d'opportunités,
 * le générateur de concepts, les variations et l'apprentissage (`angleTag` relie une mécanique aux étiquettes des
 * créatives Meta de `src/lib/meta/entities.ts`).
 */
import type { CreativeCategory, CreativeMechanic, FunnelStage, HookType, TerritoryKey } from "./types";

export const TERRITORY_LABELS: Record<TerritoryKey, string> = {
  EDUCATION: "Éducation", UGC: "UGC / témoignage", STORYTELLING: "Storytelling", PERFORMANCE: "Performance", EMOTIONAL: "Émotion",
};
export const TERRITORY_KEYS = Object.keys(TERRITORY_LABELS) as TerritoryKey[];

export const FUNNEL_LABELS: Record<FunnelStage, string> = { AWARENESS: "Notoriété", CONSIDERATION: "Considération", CONVERSION: "Conversion", RETENTION: "Fidélisation" };

export const HOOK_LABELS: Record<HookType, string> = { CURIOSITY: "Curiosité", PROBLEM: "Problème", CONTRARIAN: "Contre-pied", PERSONAL: "Personnel / UGC", EXPERT: "Expert" };

export const CATEGORY_LABELS: Record<CreativeCategory, string> = { SKINCARE: "Soin de la peau", DERMOCOSMETIC: "Dermo-cosmétique", SUPPLEMENT: "Complément alimentaire", SUN: "Solaire" };

export const PERSONA_LABELS = { CLIENTE: "Cliente / utilisatrice", PHARMACIENNE: "Pharmacienne / conseillère", EXPERTE: "Experte (dermatologue, nutritionniste)", CREATRICE: "Créatrice de contenu", MARQUE: "Voix de la marque" } as const;

export const FORMAT_LABELS = { REEL: "Réel", UGC: "UGC", CARROUSEL: "Carrousel", POST: "Post", STORY: "Story", VIDEO: "Vidéo" } as const;

const ALL: CreativeCategory[] = ["SKINCARE", "DERMOCOSMETIC", "SUPPLEMENT", "SUN"];
const GP = ["Femmes 25-45 ans", "Femmes 45 ans et plus", "Jeunes 18-25 ans"];

type M = Omit<CreativeMechanic, "territory">;
const T = (territory: TerritoryKey, items: M[]): CreativeMechanic[] => items.map((m) => ({ ...m, territory }));

/* ------------------------------ ÉDUCATION ------------------------------ */
const EDUCATION = T("EDUCATION", [
  {
    key: "ED_MYTH_REALITY", name: "Mythe vs réalité", psychologicalTrigger: "Correction d'une croyance : on retient ce qui nous contredit", bestFor: "Idée reçue répandue sur une catégorie (« le collagène ne sert à rien », « peau grasse = pas d'hydratation »)",
    funnelStages: ["AWARENESS", "CONSIDERATION"], objectives: ["NOTORIETE", "ACQUISITION", "SELL_OUT", "LANCEMENT"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["« {mythe} » : faux. Voilà pourquoi.", "On vous a menti sur {sujet}.", "Mythe n° 1 sur {sujet} : {mythe}."],
    narrativeStructures: ["Mythe énoncé → ce que ça provoque → la réalité → ce que fait le produit → CTA"], visualPatterns: ["Face caméra avec texte « MYTHE » barré", "Carrousel 1 mythe par carte", "Split écran mythe / réalité"],
    ctaPatterns: ["Partagez à celle qui y croit encore", "Disponible en pharmacie : demandez {produit}"], organicFit: 0.9, paidFit: 0.5, fatigueRisk: "MEDIUM", defaultHook: "CONTRARIAN", formats: ["REEL", "CARROUSEL"], personas: ["EXPERTE", "PHARMACIENNE", "MARQUE"], complexity: "LOW", angleTag: "FAQ / éducatif",
  },
  {
    key: "ED_3_MISTAKES", name: "3 erreurs", psychologicalTrigger: "Peur de mal faire + liste finie, facile à retenir", bestFor: "Routine mal exécutée (application, dose, régularité)",
    funnelStages: ["AWARENESS", "CONSIDERATION"], objectives: ["NOTORIETE", "ACQUISITION", "SELL_OUT", "FIDELISATION"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["3 erreurs que vous faites avec {sujet}", "Erreur n° 2 : presque tout le monde la fait", "Si vous faites ça, {produit} ne servira à rien"],
    narrativeStructures: ["Erreur 1 → 2 → 3, chacune avec la correction, le produit en correction de la dernière"], visualPatterns: ["Compteur 1/2/3 à l'écran", "Démonstration de l'erreur puis du bon geste"],
    ctaPatterns: ["Enregistrez pour votre prochaine routine", "Demandez conseil à votre pharmacien"], organicFit: 0.9, paidFit: 0.55, fatigueRisk: "MEDIUM", defaultHook: "PROBLEM", formats: ["REEL", "CARROUSEL"], personas: ["EXPERTE", "PHARMACIENNE", "CREATRICE"], complexity: "LOW", angleTag: "FAQ / éducatif",
  },
  {
    key: "ED_EXPERT_EXPLAINS", name: "L'experte explique", psychologicalTrigger: "Autorité et crédibilité : on croit celle qui sait", bestFor: "Dermo-cosmétique et compléments où la preuve d'expertise compte",
    funnelStages: ["CONSIDERATION", "CONVERSION"], objectives: ["ACQUISITION", "SELL_OUT", "LANCEMENT", "SELL_IN"], productTypes: ["DERMOCOSMETIC", "SUPPLEMENT", "SKINCARE"], targetProfiles: [...GP, "Pharmaciens et équipes comptoir", "Médecins prescripteurs"],
    hookPatterns: ["Ce qu'une {experte} regarde en premier sur {sujet}", "En consultation, la question qui revient : {question}", "Pourquoi je recommande {actif|ce type de formule}"],
    narrativeStructures: ["Question fréquente → mécanisme simple → ce qu'il faut chercher → le produit → conseil d'usage"], visualPatterns: ["Blouse ou comptoir, cadrage buste", "Schéma simple en incrustation", "Produit tenu en main à l'explication"],
    ctaPatterns: ["Parlez-en à votre pharmacien", "Demandez {produit} en pharmacie"], organicFit: 0.75, paidFit: 0.75, fatigueRisk: "LOW", defaultHook: "EXPERT", formats: ["REEL", "VIDEO"], personas: ["EXPERTE", "PHARMACIENNE"], complexity: "MEDIUM", angleTag: "FAQ / éducatif",
  },
  {
    key: "ED_INGREDIENT", name: "Zoom actif", psychologicalTrigger: "Compréhension : savoir pourquoi ça marche rassure", bestFor: "Produit dont l'actif principal est renseigné sur la fiche",
    funnelStages: ["CONSIDERATION"], objectives: ["ACQUISITION", "LANCEMENT", "NOTORIETE", "SELL_OUT"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["{actif} : ce que ça fait vraiment", "Pourquoi tout le monde parle de {actif}", "{actif} dans {produit} : à quoi ça sert"],
    narrativeStructures: ["L'actif → son rôle (fiche produit) → comment l'utiliser → le produit"], visualPatterns: ["Macro texture / gélule", "Texte actif en gros", "Étiquette composition filmée"],
    ctaPatterns: ["Lisez l'étiquette, posez vos questions en commentaire", "Disponible en pharmacie"], organicFit: 0.8, paidFit: 0.6, fatigueRisk: "MEDIUM", defaultHook: "CURIOSITY", formats: ["REEL", "CARROUSEL", "POST"], personas: ["EXPERTE", "MARQUE", "PHARMACIENNE"], complexity: "LOW", angleTag: "FAQ / éducatif",
  },
  {
    key: "ED_FAQ", name: "FAQ", psychologicalTrigger: "Réponse à une question qu'on se pose déjà", bestFor: "Objections et questions récurrentes au comptoir",
    funnelStages: ["CONSIDERATION", "CONVERSION"], objectives: ["ACQUISITION", "SELL_OUT", "FIDELISATION"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["La question qu'on nous pose le plus sur {produit}", "Réponse à vos questions : {question}", "Combien de temps avant de voir un résultat ?"],
    narrativeStructures: ["3 à 5 questions courtes → réponses honnêtes (fiche produit) → où le trouver"], visualPatterns: ["Carrousel question / réponse", "Réel face caméra avec questions en incrustation"],
    ctaPatterns: ["Posez votre question en commentaire", "Demandez conseil en pharmacie"], organicFit: 0.85, paidFit: 0.6, fatigueRisk: "LOW", defaultHook: "CURIOSITY", formats: ["CARROUSEL", "REEL", "STORY"], personas: ["PHARMACIENNE", "MARQUE", "EXPERTE"], complexity: "LOW", angleTag: "FAQ / éducatif",
  },
  {
    key: "ED_DO_DONT", name: "À faire / à éviter", psychologicalTrigger: "Clarté binaire, zéro effort cognitif", bestFor: "Gestes de routine, cures, exposition solaire",
    funnelStages: ["AWARENESS", "CONSIDERATION"], objectives: ["NOTORIETE", "SELL_OUT", "FIDELISATION"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["À faire / à éviter avec {sujet}", "Stop : plus jamais ça avec {sujet}"],
    narrativeStructures: ["Alternance à éviter → à faire (3 paires), le produit dans le dernier « à faire »"], visualPatterns: ["Croix rouge / coche verte", "Split écran"],
    ctaPatterns: ["Enregistrez ce pense-bête", "Disponible chez votre pharmacien"], organicFit: 0.85, paidFit: 0.5, fatigueRisk: "MEDIUM", defaultHook: "PROBLEM", formats: ["REEL", "CARROUSEL"], personas: ["CREATRICE", "PHARMACIENNE", "MARQUE"], complexity: "LOW", angleTag: "FAQ / éducatif",
  },
  {
    key: "ED_HOW_TO", name: "Comment faire", psychologicalTrigger: "Utilité immédiate : un geste à reproduire", bestFor: "Application, dosage, moment de prise",
    funnelStages: ["CONSIDERATION", "RETENTION"], objectives: ["SELL_OUT", "FIDELISATION", "LANCEMENT"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["Comment appliquer {produit} pour que ça marche vraiment", "Le bon geste avec {produit} en 20 secondes"],
    narrativeStructures: ["Étape 1 → 2 → 3 filmées, résultat de texture, rappel de fréquence"], visualPatterns: ["Mains et produit en gros plan", "Texte étape par étape"],
    ctaPatterns: ["Montrez-nous votre routine", "Disponible en pharmacie"], organicFit: 0.8, paidFit: 0.6, fatigueRisk: "LOW", defaultHook: "CURIOSITY", formats: ["REEL", "UGC"], personas: ["CREATRICE", "CLIENTE", "PHARMACIENNE"], complexity: "LOW", angleTag: "Démonstration",
  },
  {
    key: "ED_ROUTINE", name: "Routine expliquée", psychologicalTrigger: "Ordre et rituel : la place du produit dans un ensemble", bestFor: "Gamme à plusieurs produits, soin matin / soir, cure",
    funnelStages: ["CONSIDERATION", "RETENTION"], objectives: ["SELL_OUT", "FIDELISATION", "SELL_IN"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["Ma routine {moment} avec {marque}, dans l'ordre", "Où placer {produit} dans votre routine"],
    narrativeStructures: ["Étapes de la routine → pourquoi cet ordre → le produit à sa place → fréquence"], visualPatterns: ["Produits alignés", "Plan séquence salle de bain / cuisine"],
    ctaPatterns: ["La routine complète est en pharmacie", "Enregistrez"], organicFit: 0.8, paidFit: 0.55, fatigueRisk: "MEDIUM", defaultHook: "PERSONAL", formats: ["REEL", "UGC", "CARROUSEL"], personas: ["CLIENTE", "CREATRICE"], complexity: "LOW", angleTag: "Démonstration",
  },
]);

/* ------------------------------ UGC ------------------------------ */
const UGC = T("UGC", [
  {
    key: "UGC_PERSONAL_TEST", name: "Je l'ai testé", psychologicalTrigger: "Preuve sociale incarnée : quelqu'un comme moi", bestFor: "Produit à résultat sensoriel immédiat (texture, confort, goût)",
    funnelStages: ["CONSIDERATION", "CONVERSION"], objectives: ["ACQUISITION", "SELL_OUT", "LANCEMENT"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["J'ai testé {produit} pendant {durée}, voilà ce que j'en pense", "Honnêtement, je ne m'attendais pas à ça"],
    narrativeStructures: ["Pourquoi j'ai essayé → premier contact → ce qui m'a plu / moins plu → verdict → où l'acheter"], visualPatterns: ["Selfie vidéo, lumière naturelle", "Produit en main, unboxing léger"],
    ctaPatterns: ["Dites-moi si vous voulez la suite", "Je l'ai trouvé en pharmacie"], organicFit: 0.9, paidFit: 0.8, fatigueRisk: "HIGH", defaultHook: "PERSONAL", formats: ["UGC", "REEL"], personas: ["CLIENTE", "CREATRICE"], complexity: "LOW", angleTag: "Témoignage",
  },
  {
    key: "UGC_7_DAYS", name: "Test 7 jours", psychologicalTrigger: "Suivi dans le temps : la preuve se construit sous nos yeux", bestFor: "Produit dont l'effet s'installe (hydratation, confort, énergie ressentie)",
    funnelStages: ["CONSIDERATION", "CONVERSION"], objectives: ["ACQUISITION", "SELL_OUT", "LANCEMENT"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["Jour 1 avec {produit}. Rendez-vous jour 7.", "7 jours, un seul produit, zéro filtre"],
    narrativeStructures: ["J1 attentes → J3 ressenti → J7 bilan honnête (ressenti, jamais une mesure)"], visualPatterns: ["Même cadrage chaque jour", "Compteur de jours"],
    ctaPatterns: ["Je continue, vous voulez le J30 ?", "Disponible en pharmacie"], organicFit: 0.9, paidFit: 0.75, fatigueRisk: "MEDIUM", defaultHook: "CURIOSITY", formats: ["UGC", "REEL", "STORY"], personas: ["CLIENTE", "CREATRICE"], complexity: "MEDIUM", angleTag: "Témoignage",
  },
  {
    key: "UGC_FIRST_IMPRESSION", name: "Première impression", psychologicalTrigger: "Spontanéité et nouveauté", bestFor: "Lancement, nouvelle texture, nouveau format",
    funnelStages: ["AWARENESS", "CONSIDERATION"], objectives: ["LANCEMENT", "NOTORIETE", "ACQUISITION"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["Première fois que j'ouvre {produit}", "Réaction à chaud : {produit}"],
    narrativeStructures: ["Ouverture → texture / odeur / goût → première application → première impression → à suivre"], visualPatterns: ["Plan unique, réaction en direct", "Gros plan texture"],
    ctaPatterns: ["Vous voulez le test complet ?", "Nouveau en pharmacie"], organicFit: 0.85, paidFit: 0.6, fatigueRisk: "HIGH", defaultHook: "CURIOSITY", formats: ["UGC", "STORY", "REEL"], personas: ["CREATRICE", "CLIENTE"], complexity: "LOW", angleTag: "Nouveauté / lancement",
  },
  {
    key: "UGC_HONEST_REVIEW", name: "Avis honnête", psychologicalTrigger: "Crédibilité par la nuance : un défaut avoué rend le reste crédible", bestFor: "Marque établie, produit avec un point de friction connu (prix, texture, goût)",
    funnelStages: ["CONSIDERATION", "CONVERSION"], objectives: ["ACQUISITION", "SELL_OUT", "FIDELISATION"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["Mon avis honnête sur {produit} (le bon et le moins bon)", "Ce que personne ne dit sur {produit}"],
    narrativeStructures: ["Ce que j'attendais → ce qui m'a convaincue → ce qui me gêne → pour qui c'est fait → verdict"], visualPatterns: ["Face caméra posée", "Produit visible en permanence"],
    ctaPatterns: ["Votre avis en commentaire", "En pharmacie et parapharmacie"], organicFit: 0.85, paidFit: 0.85, fatigueRisk: "MEDIUM", defaultHook: "CONTRARIAN", formats: ["UGC", "REEL"], personas: ["CLIENTE", "CREATRICE"], complexity: "LOW", angleTag: "Témoignage",
  },
  {
    key: "UGC_MORNING_ROUTINE", name: "Routine du matin", psychologicalTrigger: "Identification et projection dans un rituel", bestFor: "Produit quotidien (soin, complément du matin)",
    funnelStages: ["AWARENESS", "RETENTION"], objectives: ["NOTORIETE", "FIDELISATION", "SELL_OUT"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["Ma routine de 6 h 45 avant que la maison se réveille", "Routine matin réaliste (pas celle d'Instagram)"],
    narrativeStructures: ["Réveil → gestes dans l'ordre → le produit à son moment → sortie"], visualPatterns: ["Plans courts, musique douce", "Lumière du matin"],
    ctaPatterns: ["Et vous, le matin ?", "Disponible en pharmacie"], organicFit: 0.9, paidFit: 0.45, fatigueRisk: "HIGH", defaultHook: "PERSONAL", formats: ["UGC", "REEL"], personas: ["CREATRICE", "CLIENTE"], complexity: "LOW", angleTag: "Démonstration",
  },
  {
    key: "UGC_GRWM", name: "Je me prépare avec vous", psychologicalTrigger: "Compagnie et conversation : le produit arrive naturellement", bestFor: "Soin du visage avant maquillage, complément pris en parlant",
    funnelStages: ["AWARENESS", "CONSIDERATION"], objectives: ["NOTORIETE", "ACQUISITION"], productTypes: ["SKINCARE", "DERMOCOSMETIC", "SUN", "SUPPLEMENT"], targetProfiles: ["Femmes 25-45 ans", "Jeunes 18-25 ans"],
    hookPatterns: ["Préparez-vous avec moi, je vous raconte {sujet}", "GRWM : on parle de {tension}"],
    narrativeStructures: ["Préparation en continu → anecdote liée à la tension → le produit utilisé → conclusion"], visualPatterns: ["Miroir, plan fixe", "Produit en avant-plan"],
    ctaPatterns: ["À demain", "Disponible en pharmacie"], organicFit: 0.9, paidFit: 0.4, fatigueRisk: "HIGH", defaultHook: "PERSONAL", formats: ["UGC", "REEL"], personas: ["CREATRICE"], complexity: "LOW", angleTag: "Démonstration",
  },
  {
    key: "UGC_PROBLEM_SOLUTION", name: "Problème → solution", psychologicalTrigger: "Reconnaissance du problème puis soulagement", bestFor: "Tension consommateur forte et nommable",
    funnelStages: ["CONSIDERATION", "CONVERSION"], objectives: ["ACQUISITION", "SELL_OUT", "ECOULEMENT", "LANCEMENT"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["Si vous aussi : {problème}…", "J'en avais marre : {frustration}"],
    narrativeStructures: ["Le problème vécu → ce que j'ai essayé → ce qui a changé → le produit → conseil"], visualPatterns: ["Avant : contexte du problème (sans promesse visuelle)", "Après : usage et confort"],
    ctaPatterns: ["Si ça vous parle, partagez", "Demandez-le en pharmacie"], organicFit: 0.85, paidFit: 0.95, fatigueRisk: "MEDIUM", defaultHook: "PROBLEM", formats: ["UGC", "REEL"], personas: ["CLIENTE", "CREATRICE"], complexity: "LOW", angleTag: "Problème → solution",
  },
  {
    key: "UGC_WISH_KNEW", name: "J'aurais aimé le savoir plus tôt", psychologicalTrigger: "Regret évité : le conseil qu'on aurait voulu recevoir", bestFor: "Produit préventif ou d'entretien (solaire, soin anti-âge, cure)",
    funnelStages: ["AWARENESS", "CONSIDERATION"], objectives: ["NOTORIETE", "ACQUISITION", "SELL_OUT"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["Ce que j'aurais aimé savoir à 25 ans sur {sujet}", "Si j'avais su ça plus tôt…"],
    narrativeStructures: ["Ce que je faisais avant → ce que j'ai compris → ce que je fais maintenant → le produit"], visualPatterns: ["Face caméra confidence", "Photos d'archives (sans avant / après médical)"],
    ctaPatterns: ["Envoyez à celle qui en a besoin", "Disponible en pharmacie"], organicFit: 0.9, paidFit: 0.7, fatigueRisk: "MEDIUM", defaultHook: "PERSONAL", formats: ["UGC", "REEL"], personas: ["CLIENTE", "CREATRICE"], complexity: "LOW", angleTag: "Témoignage",
  },
]);

/* ------------------------------ STORYTELLING ------------------------------ */
const STORYTELLING = T("STORYTELLING", [
  {
    key: "ST_TRANSFORMATION", name: "Transformation (ressentie)", psychologicalTrigger: "Projection dans un changement", bestFor: "Résultat qui se raconte (confort, confiance, énergie) — jamais une promesse médicale ni un avant / après trompeur",
    funnelStages: ["CONSIDERATION", "CONVERSION"], objectives: ["ACQUISITION", "SELL_OUT", "FIDELISATION"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["Il y a 3 mois, je ne sortais pas sans {compensation}", "Ce qui a changé depuis que j'ai {geste}"],
    narrativeStructures: ["Situation de départ → déclic → nouvelle habitude (le produit) → ce que ça change au quotidien"], visualPatterns: ["Scènes de vie, pas de gros plan « avant » dévalorisant", "Produit en usage"],
    ctaPatterns: ["Racontez-nous votre déclic", "Disponible en pharmacie"], organicFit: 0.8, paidFit: 0.8, fatigueRisk: "MEDIUM", defaultHook: "PERSONAL", formats: ["REEL", "UGC", "VIDEO"], personas: ["CLIENTE", "CREATRICE"], complexity: "MEDIUM", angleTag: "Avant / après",
  },
  {
    key: "ST_CONFESSION", name: "Confession", psychologicalTrigger: "Intimité et vulnérabilité : on écoute un secret", bestFor: "Tension émotionnelle (gêne, insécurité) autour d'un problème de peau ou de forme",
    funnelStages: ["AWARENESS", "CONSIDERATION"], objectives: ["NOTORIETE", "ACQUISITION"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["Je n'en ai jamais parlé : {problème}", "Confession : {frustration}"],
    narrativeStructures: ["Ce que je cachais → ce que ça me coûtait → ce que j'ai changé → le produit comme allié → message à celles qui vivent ça"], visualPatterns: ["Plan serré, voix basse, sans musique forte", "Produit discret"],
    ctaPatterns: ["Vous n'êtes pas seule", "Parlez-en à votre pharmacien"], organicFit: 0.85, paidFit: 0.6, fatigueRisk: "MEDIUM", defaultHook: "PERSONAL", formats: ["REEL", "UGC"], personas: ["CLIENTE", "CREATRICE"], complexity: "MEDIUM", angleTag: "Témoignage",
  },
  {
    key: "ST_PERSONAL_STORY", name: "Histoire personnelle", psychologicalTrigger: "Narration : on suit un personnage jusqu'au bout", bestFor: "Marque avec une histoire (origine, fondateur, terroir) ou cliente fidèle",
    funnelStages: ["AWARENESS", "RETENTION"], objectives: ["NOTORIETE", "FIDELISATION"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["L'histoire derrière {marque}, en 45 secondes", "Pourquoi ma mère m'a offert {produit}"],
    narrativeStructures: ["Contexte → épreuve → rencontre avec le produit / la marque → aujourd'hui"], visualPatterns: ["Images d'archives, lieux, mains", "Voix off"],
    ctaPatterns: ["Partagez votre histoire avec {marque}", "Disponible en pharmacie"], organicFit: 0.85, paidFit: 0.5, fatigueRisk: "LOW", defaultHook: "CURIOSITY", formats: ["REEL", "VIDEO"], personas: ["MARQUE", "CLIENTE"], complexity: "HIGH", angleTag: null,
  },
  {
    key: "ST_DAY_IN_LIFE", name: "Une journée avec", psychologicalTrigger: "Immersion : le produit s'intègre à une vraie vie", bestFor: "Complément alimentaire (prise, régularité) et solaire (ré-application)",
    funnelStages: ["AWARENESS", "CONSIDERATION"], objectives: ["NOTORIETE", "FIDELISATION", "SELL_OUT"], productTypes: ["SUPPLEMENT", "SUN", "SKINCARE"], targetProfiles: [...GP, "Mamans", "Sportifs / sportives"],
    hookPatterns: ["Une journée dans ma vie de {persona} avec {produit}", "Comment je tiens ma cure quand je n'ai pas le temps"],
    narrativeStructures: ["Matin → journée → soir, le produit à ses moments clés, astuce de régularité"], visualPatterns: ["Montage rythmé, plans de transition", "Horodatage à l'écran"],
    ctaPatterns: ["Votre astuce régularité ?", "Disponible en pharmacie"], organicFit: 0.85, paidFit: 0.45, fatigueRisk: "HIGH", defaultHook: "PERSONAL", formats: ["REEL", "UGC"], personas: ["CREATRICE", "CLIENTE"], complexity: "MEDIUM", angleTag: "Démonstration",
  },
  {
    key: "ST_UNEXPECTED", name: "Découverte inattendue", psychologicalTrigger: "Surprise : un usage, un lieu, une personne qu'on n'attendait pas", bestFor: "Produit méconnu, usage secondaire renseigné sur la fiche, canal pharmacie",
    funnelStages: ["AWARENESS"], objectives: ["NOTORIETE", "ACQUISITION", "LANCEMENT"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["Je ne pensais pas trouver ça en pharmacie", "Ma pharmacienne m'a conseillé un truc inattendu"],
    narrativeStructures: ["Situation banale → découverte → essai → ce que ça change → où"], visualPatterns: ["Comptoir de pharmacie", "Réaction surprise"],
    ctaPatterns: ["Demandez à votre pharmacien", "Partagez votre découverte"], organicFit: 0.85, paidFit: 0.6, fatigueRisk: "MEDIUM", defaultHook: "CURIOSITY", formats: ["REEL", "UGC"], personas: ["CLIENTE", "CREATRICE", "PHARMACIENNE"], complexity: "LOW", angleTag: "Événement / point de vente",
  },
  {
    key: "ST_POV", name: "POV", psychologicalTrigger: "Identification instantanée par la situation", bestFor: "Micro-situations universelles (peau qui tiraille en hiver, coup de barre de 15 h)",
    funnelStages: ["AWARENESS"], objectives: ["NOTORIETE", "ACQUISITION"], productTypes: ALL, targetProfiles: ["Jeunes 18-25 ans", "Femmes 25-45 ans"],
    hookPatterns: ["POV : {situation}", "POV : tu découvres enfin {bénéfice}"],
    narrativeStructures: ["Situation en 2 s → tension → geste produit → soulagement, en moins de 15 s"], visualPatterns: ["Plan subjectif", "Texte POV en haut"],
    ctaPatterns: ["Tag celle qui vit ça", "En pharmacie"], organicFit: 0.95, paidFit: 0.5, fatigueRisk: "HIGH", defaultHook: "CURIOSITY", formats: ["REEL", "STORY"], personas: ["CREATRICE"], complexity: "LOW", angleTag: "Problème → solution",
  },
  {
    key: "ST_ESCALATION", name: "Escalade du problème", psychologicalTrigger: "Tension croissante puis résolution", bestFor: "Problème qui empire si on ne fait rien (sécheresse, taches, fatigue chronique)",
    funnelStages: ["CONSIDERATION", "CONVERSION"], objectives: ["ACQUISITION", "SELL_OUT", "ECOULEMENT"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["Ça a commencé par un détail : {détail}… puis tout a empiré", "Au début je n'y faisais pas attention"],
    narrativeStructures: ["Signal faible → aggravation → point de bascule → la bonne réponse (produit + conseil) → apaisement"], visualPatterns: ["Rythme qui accélère puis se pose", "Musique en montée"],
    ctaPatterns: ["N'attendez pas le point de bascule", "Demandez conseil en pharmacie"], organicFit: 0.75, paidFit: 0.85, fatigueRisk: "MEDIUM", defaultHook: "PROBLEM", formats: ["REEL", "VIDEO"], personas: ["CLIENTE", "CREATRICE"], complexity: "MEDIUM", angleTag: "Problème → solution",
  },
]);

/* ------------------------------ PERFORMANCE ------------------------------ */
const PERFORMANCE = T("PERFORMANCE", [
  {
    key: "PF_OBJECTION_KILLER", name: "Tueur d'objection", psychologicalTrigger: "Lever le frein exact qui bloque l'achat", bestFor: "Objection connue : prix, « ça ne marche pas », goût, temps avant résultat",
    funnelStages: ["CONVERSION"], objectives: ["SELL_OUT", "ACQUISITION", "ECOULEMENT"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["« {objection} » — on en parle ?", "Vous hésitez à cause de {objection}. Voilà la vraie réponse."],
    narrativeStructures: ["Objection dite telle quelle → reconnaissance → réponse factuelle (fiche produit, prix public) → preuve d'usage → CTA"], visualPatterns: ["Objection en texte plein écran", "Produit et prix visibles"],
    ctaPatterns: ["Demandez {produit} en pharmacie", "Écrivez-nous pour la pharmacie la plus proche"], organicFit: 0.5, paidFit: 1, fatigueRisk: "MEDIUM", defaultHook: "CONTRARIAN", formats: ["REEL", "UGC", "VIDEO"], personas: ["PHARMACIENNE", "CLIENTE", "MARQUE"], complexity: "LOW", angleTag: "Problème → solution",
  },
  {
    key: "PF_DEMO", name: "Démonstration produit", psychologicalTrigger: "Voir, c'est croire : texture, application, geste", bestFor: "Produit à geste visible (crème, sérum, solaire, gummies, sachet)",
    funnelStages: ["CONSIDERATION", "CONVERSION"], objectives: ["SELL_OUT", "LANCEMENT", "ACQUISITION", "ECOULEMENT"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["Regardez la texture de {produit}", "Ce que fait {produit} en 10 secondes sur la peau"],
    narrativeStructures: ["Produit → ouverture → texture macro → application → fini / ressenti → CTA"], visualPatterns: ["Macro texture", "Dos de main / joue", "Lumière rasante"],
    ctaPatterns: ["Disponible en pharmacie", "Demandez un échantillon à votre pharmacien"], organicFit: 0.7, paidFit: 0.95, fatigueRisk: "LOW", defaultHook: "CURIOSITY", formats: ["REEL", "VIDEO", "UGC"], personas: ["MARQUE", "CREATRICE", "PHARMACIENNE"], complexity: "LOW", angleTag: "Démonstration",
  },
  {
    key: "PF_COMPARISON", name: "Comparaison (interne)", psychologicalTrigger: "Choix guidé : lequel pour moi ?", bestFor: "Gamme avec plusieurs références proches (peau sèche / mixte, matin / soir)",
    funnelStages: ["CONSIDERATION", "CONVERSION"], objectives: ["SELL_OUT", "SELL_IN", "FIDELISATION"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["{produit A} ou {produit B} : lequel est fait pour vous ?", "On compare, vous choisissez"],
    narrativeStructures: ["Les deux produits → critère 1, 2, 3 → à qui va lequel → où les trouver"], visualPatterns: ["Split écran", "Tableau de critères à l'écran"],
    ctaPatterns: ["Demandez conseil au comptoir", "Les deux sont en pharmacie"], organicFit: 0.7, paidFit: 0.8, fatigueRisk: "LOW", defaultHook: "CURIOSITY", formats: ["CARROUSEL", "REEL"], personas: ["PHARMACIENNE", "MARQUE"], complexity: "LOW", angleTag: "FAQ / éducatif",
  },
  {
    key: "PF_PROOF", name: "Preuve (fiche produit)", psychologicalTrigger: "Rationnel : des faits vérifiables", bestFor: "Produit dont la fiche porte des allégations et actifs validés par le réglementaire",
    funnelStages: ["CONVERSION"], objectives: ["SELL_OUT", "ACQUISITION", "SELL_IN"], productTypes: ["DERMOCOSMETIC", "SUPPLEMENT", "SUN"], targetProfiles: [...GP, "Pharmaciens et équipes comptoir"],
    hookPatterns: ["Les faits sur {produit}, rien que les faits", "Ce qui est écrit sur l'étiquette de {produit}"],
    narrativeStructures: ["Actif → allégation autorisée → usage → prix public → où"], visualPatterns: ["Étiquette filmée", "Texte factuel sobre"],
    ctaPatterns: ["Disponible en pharmacie", "Demandez conseil"], organicFit: 0.5, paidFit: 0.85, fatigueRisk: "LOW", defaultHook: "EXPERT", formats: ["CARROUSEL", "REEL", "POST"], personas: ["MARQUE", "EXPERTE"], complexity: "LOW", angleTag: "FAQ / éducatif",
  },
  {
    key: "PF_SOCIAL_PROOF", name: "Preuve sociale", psychologicalTrigger: "Conformité : les autres l'ont adopté", bestFor: "Produit avec avis clients, pharmaciens qui recommandent, volumes de vente réels",
    funnelStages: ["CONSIDERATION", "CONVERSION"], objectives: ["SELL_OUT", "ACQUISITION"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["Pourquoi les pharmaciennes le recommandent", "Ce que nos clientes nous écrivent sur {produit}"],
    narrativeStructures: ["Verbatims (réels, autorisés) → point commun → le produit → CTA"], visualPatterns: ["Captures de messages anonymisés", "Comptoir, visages"],
    ctaPatterns: ["Demandez-le en pharmacie", "Partagez votre avis"], organicFit: 0.7, paidFit: 0.85, fatigueRisk: "MEDIUM", defaultHook: "CURIOSITY", formats: ["CARROUSEL", "REEL"], personas: ["MARQUE", "PHARMACIENNE"], complexity: "MEDIUM", angleTag: "Témoignage",
  },
  {
    key: "PF_OFFER", name: "Offre", psychologicalTrigger: "Urgence et gain immédiat", bestFor: "Surstock à écouler, offre pharmacien ou pack réel et daté",
    funnelStages: ["CONVERSION"], objectives: ["ECOULEMENT", "SELL_OUT", "SELL_IN"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["Jusqu'au {date} : {offre}", "{offre} sur {produit}, en pharmacie"],
    narrativeStructures: ["Offre → produit → pour qui → où et jusqu'à quand"], visualPatterns: ["Prix / offre en gros", "Produit packshot propre"],
    ctaPatterns: ["Dans votre pharmacie jusqu'au {date}", "Écrivez-nous pour les pharmacies participantes"], organicFit: 0.4, paidFit: 0.9, fatigueRisk: "HIGH", defaultHook: "CURIOSITY", formats: ["POST", "STORY", "REEL"], personas: ["MARQUE"], complexity: "LOW", angleTag: "Promo / offre",
  },
  {
    key: "PF_PROBLEM_FIRST", name: "Problème d'abord", psychologicalTrigger: "Qualification : seules les concernées s'arrêtent", bestFor: "Acquisition payante sur une tension précise",
    funnelStages: ["CONVERSION", "CONSIDERATION"], objectives: ["ACQUISITION", "SELL_OUT"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["{problème} ? Lisez ça.", "Pour celles qui {problème}"],
    narrativeStructures: ["Problème nommé en 2 s → pourquoi ça arrive (simple) → la réponse → le produit → CTA"], visualPatterns: ["Texte problème plein écran", "Produit après 5 s"],
    ctaPatterns: ["Demandez {produit} en pharmacie", "Envoyez-nous un message"], organicFit: 0.6, paidFit: 1, fatigueRisk: "MEDIUM", defaultHook: "PROBLEM", formats: ["REEL", "UGC", "VIDEO"], personas: ["CLIENTE", "CREATRICE", "MARQUE"], complexity: "LOW", angleTag: "Problème → solution",
  },
  {
    key: "PF_BENEFIT_FIRST", name: "Bénéfice d'abord", psychologicalTrigger: "Désir : l'issue souhaitée en premier", bestFor: "Bénéfice clair et autorisé sur la fiche produit",
    funnelStages: ["CONVERSION", "CONSIDERATION"], objectives: ["SELL_OUT", "ACQUISITION", "LANCEMENT"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["{bénéfice}, sans {contrainte}", "Et si {désir} ?"],
    narrativeStructures: ["Bénéfice (fiche) → comment → le produit → preuve d'usage → CTA"], visualPatterns: ["Résultat sensoriel montré (texture, confort)", "Produit en héros"],
    ctaPatterns: ["Disponible en pharmacie", "Demandez conseil"], organicFit: 0.6, paidFit: 0.9, fatigueRisk: "MEDIUM", defaultHook: "CURIOSITY", formats: ["REEL", "VIDEO", "POST"], personas: ["MARQUE", "CREATRICE"], complexity: "LOW", angleTag: null,
  },
]);

/* ------------------------------ ÉMOTION ------------------------------ */
const EMOTIONAL = T("EMOTIONAL", [
  {
    key: "EM_CURIOSITY", name: "Curiosité", psychologicalTrigger: "Boucle ouverte : il faut savoir la suite", bestFor: "Notoriété d'un produit méconnu", funnelStages: ["AWARENESS"], objectives: ["NOTORIETE", "LANCEMENT", "ACQUISITION"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["Personne ne m'avait dit ça sur {sujet}", "Le détail que tout le monde rate avec {sujet}"], narrativeStructures: ["Question ouverte → indices → révélation → produit → CTA"], visualPatterns: ["Objet caché puis révélé", "Zoom progressif"],
    ctaPatterns: ["La suite en commentaire", "En pharmacie"], organicFit: 0.9, paidFit: 0.6, fatigueRisk: "HIGH", defaultHook: "CURIOSITY", formats: ["REEL", "STORY"], personas: ["CREATRICE", "MARQUE"], complexity: "LOW", angleTag: null,
  },
  {
    key: "EM_ASPIRATION", name: "Aspiration", psychologicalTrigger: "Désir d'être cette personne, ce moment", bestFor: "Marque premium, rituel beauté, lumière", funnelStages: ["AWARENESS"], objectives: ["NOTORIETE", "FIDELISATION"], productTypes: ["SKINCARE", "DERMOCOSMETIC", "SUPPLEMENT"], targetProfiles: GP,
    hookPatterns: ["Le moment de la journée qui n'appartient qu'à moi", "Prendre soin de soi n'est pas un luxe"], narrativeStructures: ["Ambiance → geste → sensation → produit en signature"], visualPatterns: ["Lumière chaude, ralenti", "Matières, eau, textile"],
    ctaPatterns: ["Offrez-vous ce moment", "En pharmacie"], organicFit: 0.8, paidFit: 0.5, fatigueRisk: "MEDIUM", defaultHook: "CURIOSITY", formats: ["REEL", "VIDEO", "POST"], personas: ["MARQUE", "CREATRICE"], complexity: "MEDIUM", angleTag: null,
  },
  {
    key: "EM_CONFIDENCE", name: "Confiance en soi", psychologicalTrigger: "Estime de soi retrouvée", bestFor: "Problème visible (peau, cheveux) vécu comme une gêne sociale", funnelStages: ["AWARENESS", "CONSIDERATION"], objectives: ["NOTORIETE", "ACQUISITION", "FIDELISATION"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["Le jour où j'ai arrêté de me cacher", "Ce n'est pas qu'une crème, c'est un rendez-vous que j'accepte"], narrativeStructures: ["Gêne → geste de soin → petite victoire quotidienne → produit"], visualPatterns: ["Regard caméra", "Scènes sociales"],
    ctaPatterns: ["Partagez votre petite victoire", "Disponible en pharmacie"], organicFit: 0.85, paidFit: 0.6, fatigueRisk: "MEDIUM", defaultHook: "PERSONAL", formats: ["REEL", "UGC"], personas: ["CLIENTE", "CREATRICE"], complexity: "MEDIUM", angleTag: "Témoignage",
  },
  {
    key: "EM_SURPRISE", name: "Surprise", psychologicalTrigger: "Rupture d'attente : humour, décalage", bestFor: "Marque qui peut sourire d'elle-même, format court", funnelStages: ["AWARENESS"], objectives: ["NOTORIETE"], productTypes: ALL, targetProfiles: ["Jeunes 18-25 ans", "Femmes 25-45 ans"],
    hookPatterns: ["Attendez la fin", "Ce n'est pas ce que vous croyez"], narrativeStructures: ["Attente installée → retournement → produit → chute"], visualPatterns: ["Cut sec", "Son signature"],
    ctaPatterns: ["Taguez quelqu'un", "En pharmacie"], organicFit: 0.9, paidFit: 0.4, fatigueRisk: "HIGH", defaultHook: "CURIOSITY", formats: ["REEL"], personas: ["CREATRICE", "MARQUE"], complexity: "MEDIUM", angleTag: null,
  },
  {
    key: "EM_RELIEF", name: "Soulagement", psychologicalTrigger: "Fin d'un inconfort", bestFor: "Tiraillements, démangeaisons, inconfort digestif, fatigue : ressenti, jamais pathologie", funnelStages: ["CONSIDERATION", "CONVERSION"], objectives: ["ACQUISITION", "SELL_OUT"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["Enfin.", "Le soulagement de {moment}"], narrativeStructures: ["Inconfort (ressenti) → geste → soulagement → produit → CTA"], visualPatterns: ["Respiration, épaules qui tombent", "Macro application"],
    ctaPatterns: ["Demandez conseil en pharmacie", "Disponible en pharmacie"], organicFit: 0.75, paidFit: 0.8, fatigueRisk: "MEDIUM", defaultHook: "PROBLEM", formats: ["REEL", "UGC"], personas: ["CLIENTE", "CREATRICE"], complexity: "LOW", angleTag: "Problème → solution",
  },
  {
    key: "EM_INSECURITY", name: "Insécurité (avec soin)", psychologicalTrigger: "Nommer une insécurité pour la désamorcer, sans la nourrir", bestFor: "Sujets sensibles (acné adulte, chute de cheveux, âge) traités avec bienveillance", funnelStages: ["AWARENESS", "CONSIDERATION"], objectives: ["NOTORIETE", "ACQUISITION"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["On ne devrait pas avoir honte de {sujet}", "Parlons de {sujet}, sans filtre"], narrativeStructures: ["Nommer → normaliser → agir (produit + conseil) → message positif"], visualPatterns: ["Lumière douce, pas de retouche", "Texte sobre"],
    ctaPatterns: ["Vous n'êtes pas seule", "Parlez-en à votre pharmacien"], organicFit: 0.85, paidFit: 0.55, fatigueRisk: "MEDIUM", defaultHook: "CONTRARIAN", formats: ["REEL", "UGC", "CARROUSEL"], personas: ["CLIENTE", "EXPERTE", "CREATRICE"], complexity: "MEDIUM", angleTag: null,
  },
  {
    key: "EM_DISCOVERY", name: "Découverte", psychologicalTrigger: "Plaisir de la nouveauté", bestFor: "Lancement, nouvel actif, nouvelle gamme", funnelStages: ["AWARENESS"], objectives: ["LANCEMENT", "NOTORIETE"], productTypes: ALL, targetProfiles: GP,
    hookPatterns: ["Nouveau en pharmacie : {produit}", "On vous présente {produit}"], narrativeStructures: ["Teasing → révélation → 3 raisons (fiche) → où"], visualPatterns: ["Packshot animé", "Mains qui découvrent"],
    ctaPatterns: ["Demandez-le en pharmacie dès {date}", "Dites-nous ce que vous voulez savoir"], organicFit: 0.8, paidFit: 0.7, fatigueRisk: "LOW", defaultHook: "CURIOSITY", formats: ["REEL", "POST", "STORY"], personas: ["MARQUE", "CREATRICE"], complexity: "LOW", angleTag: "Nouveauté / lancement",
  },
]);

export const MECHANICS: CreativeMechanic[] = [...EDUCATION, ...UGC, ...STORYTELLING, ...PERFORMANCE, ...EMOTIONAL];
export const MECHANIC_BY_KEY = new Map(MECHANICS.map((m) => [m.key, m]));

export function mechanicOf(key: string): CreativeMechanic | null {
  return MECHANIC_BY_KEY.get(key) ?? null;
}

/** Mécaniques d'un territoire. */
export function mechanicsOf(territory: TerritoryKey): CreativeMechanic[] {
  return MECHANICS.filter((m) => m.territory === territory);
}

/** Mécaniques qui correspondent à une étiquette d'angle Meta (apprentissage ← créatives étiquetées). */
export function mechanicsForAngleTag(angleTag: string): CreativeMechanic[] {
  return MECHANICS.filter((m) => m.angleTag === angleTag);
}

/** Territoire le plus probable d'une étiquette d'angle Meta (première mécanique qui la porte). */
export function territoryForAngleTag(angleTag: string | null | undefined): TerritoryKey | null {
  if (!angleTag) return null;
  return mechanicsForAngleTag(angleTag)[0]?.territory ?? null;
}
