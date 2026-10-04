/**
 * Couche C — intelligence consommateur (logique PURE).
 *
 * Bibliothèque de tensions consommateur par catégorie (soin, dermo-cosmétique, solaire, complément) : problème,
 * frustration, désir, objection, croyance, idée reçue, question, émotion. `matchTensions()` les active à partir de la
 * fiche produit réelle (bénéfices, angle, actifs, nom, catégorie) : aucune tension n'est inventée hors de ce
 * catalogue par la logique déterministe ; la couche IA choisit la plus forte et l'affine, elle ne crée pas de bénéfice.
 */
import type { ConsumerTension, CreativeCategory, FunnelStage, ProductIntelligence } from "./types";

const SKIN: CreativeCategory[] = ["SKINCARE", "DERMOCOSMETIC"];
const SUPP: CreativeCategory[] = ["SUPPLEMENT"];
const MID: FunnelStage[] = ["CONSIDERATION", "CONVERSION"];
const TOP: FunnelStage[] = ["AWARENESS", "CONSIDERATION"];

export const TENSIONS: ConsumerTension[] = [
  /* ------------------------------ Peau ------------------------------ */
  {
    key: "SKIN_TIGHT", categories: SKIN, label: "Peau qui tiraille", funnelStages: MID,
    problem: "La peau tiraille, surtout après la douche ou en fin de journée.", frustration: "Les crèmes « hydratantes » n'apaisent que dix minutes.",
    desire: "Une peau confortable toute la journée, sans y repenser.", objection: "Encore une crème qui promet et qui colle.",
    belief: "Peau sèche = il faut une texture très riche.", misconception: "Boire plus d'eau suffit à hydrater la peau.",
    question: "Pourquoi ma peau tiraille alors que je mets de la crème ?", emotion: "Inconfort permanent, agacement.",
    keywords: ["hydrat", "sech", "sèch", "tiraill", "nourri", "confort", "répar", "repar", "baume", "déshydrat", "deshydrat"],
  },
  {
    key: "SKIN_DULL", categories: SKIN, label: "Teint terne", funnelStages: TOP,
    problem: "Le teint est gris, fatigué, même après une bonne nuit.", frustration: "Le fond de teint cache mais ne règle rien.",
    desire: "Un visage reposé et lumineux sans maquillage.", objection: "L'éclat, c'est du marketing.",
    belief: "L'éclat vient du sommeil, pas du soin.", misconception: "Un gommage quotidien donne de l'éclat.",
    question: "Comment retrouver de l'éclat quand on dort peu ?", emotion: "Lassitude devant le miroir.",
    keywords: ["éclat", "eclat", "lumin", "terne", "uniform", "radiance", "vitamine c", "fatigu", "défatig"],
  },
  {
    key: "SKIN_IMPERFECTIONS", categories: SKIN, label: "Imperfections à l'âge adulte", funnelStages: MID,
    problem: "Des boutons et des brillances à 30 ans passés.", frustration: "Les produits « anti-acné » décapent et empirent.",
    desire: "Une peau nette, mate, sans l'assécher.", objection: "Rien n'a marché depuis l'adolescence.",
    belief: "Peau grasse = il faut la dessécher.", misconception: "Une peau grasse n'a pas besoin d'hydratation.",
    question: "Pourquoi j'ai encore des boutons à mon âge ?", emotion: "Gêne, honte en réunion ou en photo.",
    keywords: ["imperfect", "acné", "acne", "sébum", "sebum", "bouton", "purif", "matif", "pore", "grasse", "mixte", "sebo", "brillance"],
  },
  {
    key: "SKIN_AGING", categories: SKIN, label: "Premiers signes de l'âge", funnelStages: MID,
    problem: "Ridules, perte de fermeté, visage qui « tombe » sur les photos.", frustration: "Les anti-âge chers ne se voient pas.",
    desire: "Une peau plus ferme, un visage reposé, naturellement.", objection: "À quoi bon, c'est l'âge.",
    belief: "Il faut commencer l'anti-âge à 50 ans.", misconception: "Plus c'est cher, plus c'est efficace.",
    question: "À quel âge commencer et par quoi ?", emotion: "Inquiétude discrète, envie de garder la main.",
    keywords: ["ride", "âge", "age", "ferme", "lift", "collag", "raffermi", "élast", "elast", "densit", "mature", "anti-âge", "anti-age"],
  },
  {
    key: "SKIN_SPOTS", categories: SKIN, label: "Taches et teint irrégulier", funnelStages: MID,
    problem: "Des taches qui s'installent et ne partent plus.", frustration: "Des mois de produits « éclaircissants » pour rien.",
    desire: "Un teint uniforme, sans fond de teint épais.", objection: "Ça prend des mois et je n'ai pas la patience.",
    belief: "Une tache part en deux semaines.", misconception: "Sans soleil visible, pas besoin de protection.",
    question: "Pourquoi mes taches reviennent chaque été ?", emotion: "Découragement.",
    keywords: ["tache", "pigment", "unifi", "éclaircis", "eclaircis", "dépigment", "melasma", "irrégul"],
  },
  {
    key: "SKIN_SENSITIVE", categories: SKIN, label: "Peau réactive", funnelStages: MID,
    problem: "Rougeurs, picotements, la peau réagit à tout.", frustration: "Chaque nouveau produit est un pari.",
    desire: "Un soin qui apaise sans surprise.", objection: "« Peaux sensibles » est écrit partout, ça ne veut rien dire.",
    belief: "Le naturel ne pique jamais.", misconception: "Sans parfum = sans risque.",
    question: "Comment tester un produit sans tout déclencher ?", emotion: "Méfiance, fatigue de chercher.",
    keywords: ["sensib", "rougeur", "apais", "réactiv", "reactiv", "intoléran", "intoleran", "atopi", "irrit", "calm", "tolér", "toler"],
  },
  {
    key: "SKIN_EYES", categories: SKIN, label: "Regard fatigué", funnelStages: MID,
    problem: "Cernes et poches dès le réveil.", frustration: "L'anticerne marque les ridules.",
    desire: "Un regard frais sans correcteur.", objection: "Un contour des yeux, c'est un petit pot très cher.",
    belief: "Les cernes sont génétiques, rien à faire.", misconception: "La crème visage suffit pour le contour des yeux.",
    question: "Est-ce qu'un soin peut vraiment agir sur les cernes ?", emotion: "Air fatigué qu'on vous fait remarquer.",
    keywords: ["cerne", "poche", "contour des yeux", "regard", "yeux"],
  },
  {
    key: "SKIN_CLEANSE", categories: SKIN, label: "Nettoyage qui agresse", funnelStages: TOP,
    problem: "La peau « crisse » après le nettoyage, puis brille à midi.", frustration: "Impossible de trouver un nettoyant doux et efficace.",
    desire: "Une peau propre et souple, sans tiraillement.", objection: "Un nettoyant, c'est de l'eau et du savon.",
    belief: "Une peau qui crisse est une peau propre.", misconception: "Plus ça mousse, plus ça nettoie.",
    question: "Dois-je nettoyer matin et soir ?", emotion: "Routine subie.",
    keywords: ["nettoy", "démaquill", "demaquill", "mousse", "gel lavant", "lavant", "micellaire"],
  },
  {
    key: "SKIN_BODY", categories: SKIN, label: "Peau du corps oubliée", funnelStages: TOP,
    problem: "Jambes qui grattent, coudes rêches, vergetures qui marquent.", frustration: "Le lait pour le corps colle et prend du temps.",
    desire: "Un corps doux sans rituel interminable.", objection: "Je n'ai pas le temps le matin.",
    belief: "Le corps n'a pas besoin de soin spécifique.", misconception: "Les vergetures se traitent une fois installées.",
    question: "Quand appliquer un soin corps pour qu'il serve ?", emotion: "Négligence coupable.",
    keywords: ["corps", "vergeture", "lait corp", "cellulit", "jambes", "mains"],
  },
  {
    key: "SKIN_NATURAL_DOUBT", categories: ["SKINCARE"], label: "Le naturel est-il efficace ?", funnelStages: TOP,
    problem: "Envie de naturel, peur de l'inefficacité.", frustration: "Les produits bio sentent bon mais « ne font rien ».",
    desire: "Le meilleur des deux : naturel ET résultat visible.", objection: "Le bio en pharmacie, c'est plus cher pour moins d'effet.",
    belief: "Chimique = efficace, naturel = doux mais faible.", misconception: "« Naturel » signifie sans actif.",
    question: "Un soin bio peut-il vraiment agir ?", emotion: "Envie de bien faire sans se faire avoir.",
    keywords: ["bio", "natur", "végétal", "vegetal", "certifi", "écocert", "ecocert", "cosmos", "plante", "huile"],
  },
  /* ------------------------------ Solaire ------------------------------ */
  {
    key: "SUN_TEXTURE", categories: ["SUN"], label: "Se protéger sans texture grasse", funnelStages: MID,
    problem: "Le solaire colle, blanchit, pique les yeux.", frustration: "On finit par ne pas le remettre.",
    desire: "Une protection quotidienne qu'on oublie sur la peau.", objection: "Je ne bronze pas avec un indice fort.",
    belief: "Le solaire, c'est pour la plage.", misconception: "Une peau foncée n'a pas besoin de protection.",
    question: "Faut-il un solaire en ville en hiver ?", emotion: "Corvée quotidienne qu'on finit par sauter.",
    keywords: ["solaire", "spf", "uv", "écran", "ecran", "protection", "fluide", "invisible"],
  },
  {
    key: "SUN_SPOTS", categories: ["SUN"], label: "Les taches qui reviennent avec le soleil", funnelStages: MID,
    problem: "Chaque été, les taches se réveillent.", frustration: "Les soins de l'hiver sont effacés en une semaine.",
    desire: "Garder un teint uniforme toute l'année.", objection: "Je mets déjà de la crème, ça ne change rien.",
    belief: "Les taches viennent de l'âge, pas du soleil.", misconception: "Un indice 30 suffit pour les taches.",
    question: "Quelle protection pour une peau à taches ?", emotion: "Frustration saisonnière.",
    keywords: ["tache", "pigment", "anti-tache", "après-soleil", "apres-soleil", "bronz"],
  },
  /* ------------------------------ Compléments ------------------------------ */
  {
    key: "SUPP_HAIR", categories: SUPP, label: "Cheveux qui tombent, ongles qui cassent", funnelStages: MID,
    problem: "Des cheveux plein la brosse, des ongles qui se dédoublent.", frustration: "Les shampooings « anti-chute » ne changent rien.",
    desire: "Des cheveux plus denses et des ongles solides.", objection: "Les gélules, j'oublie au bout d'une semaine.",
    belief: "La chute, c'est le stress, ça passera.", misconception: "Un complément agit en quinze jours.",
    question: "Combien de temps dure une cure cheveux ?", emotion: "Inquiétude en se coiffant.",
    keywords: ["cheveu", "chute", "ongle", "kératine", "keratine", "biotine", "zinc", "capillaire", "pousse"],
  },
  {
    key: "SUPP_SKIN_WITHIN", categories: SUPP, label: "La beauté de l'intérieur", funnelStages: MID,
    problem: "La peau perd de sa fermeté et de son rebond malgré les crèmes.", frustration: "On empile les soins sans agir sur la cause.",
    desire: "Agir de l'intérieur sur la fermeté et l'éclat.", objection: "Le collagène avalé ne va pas dans la peau.",
    belief: "Seule la crème agit sur la peau.", misconception: "Tous les collagènes se valent.",
    question: "Le collagène à boire, ça marche vraiment ?", emotion: "Curiosité sceptique.",
    keywords: ["collag", "peau", "fermet", "élastic", "elastic", "éclat", "eclat", "acide hyaluron", "beauté", "beaute", "in & out", "nutricosm"],
  },
  {
    key: "SUPP_FATIGUE", categories: SUPP, label: "Fatigue qui s'installe", funnelStages: MID,
    problem: "Coup de barre à 15 h, réveil déjà fatigué.", frustration: "Le café ne suffit plus.",
    desire: "De l'énergie stable sans excitant.", objection: "Les vitamines, c'est de l'urine chère.",
    belief: "La fatigue, c'est normal avec les enfants et le travail.", misconception: "Une cure d'une semaine remet d'aplomb.",
    question: "Quel complément quand on est épuisée ?", emotion: "Épuisement résigné.",
    keywords: ["fatigue", "énergie", "energie", "tonus", "vitalit", "magnés", "magnes", "fer", "vitamine", "forme"],
  },
  {
    key: "SUPP_SLEEP", categories: SUPP, label: "Sommeil et charge mentale", funnelStages: MID,
    problem: "Endormissement long, réveils à 3 h.", frustration: "Les tisanes ne font rien, les somnifères font peur.",
    desire: "S'endormir vite et se réveiller reposée.", objection: "J'ai peur de l'accoutumance.",
    belief: "Mal dormir, c'est dans la tête.", misconception: "Un complément sommeil assomme.",
    question: "Que prendre pour mieux dormir sans dépendance ?", emotion: "Anxiété du soir.",
    keywords: ["sommeil", "stress", "détente", "detente", "mélatonine", "melatonine", "relax", "sérénit", "serenit", "anxi", "nerv"],
  },
  {
    key: "SUPP_IMMUNITY", categories: SUPP, label: "Passer la saison sans tomber", funnelStages: TOP,
    problem: "Enrhumée tout l'hiver, les enfants ramènent tout.", frustration: "On réagit toujours trop tard.",
    desire: "Aborder la saison en forme.", objection: "Je mange des oranges, ça suffit.",
    belief: "Les défenses, c'est génétique.", misconception: "Plus la dose est forte, mieux c'est.",
    question: "Quand commencer une cure pour l'hiver ?", emotion: "Prévoyance.",
    keywords: ["immun", "défens", "defens", "hiver", "vitamine c", "vitamine d", "zinc", "saison", "résist"],
  },
  {
    key: "SUPP_DIGESTION", categories: SUPP, label: "Confort digestif", funnelStages: MID,
    problem: "Ballonnements après les repas, ventre gonflé le soir.", frustration: "On supprime des aliments sans savoir lesquels.",
    desire: "Un ventre léger et confortable.", objection: "Les probiotiques, c'est un mot à la mode.",
    belief: "Le ventre gonflé, c'est la nourriture.", misconception: "Tous les probiotiques se ressemblent.",
    question: "Quel probiotique pour les ballonnements ?", emotion: "Inconfort quotidien, gêne vestimentaire.",
    keywords: ["digest", "ballonn", "probiot", "transit", "intestin", "ventre", "flore", "microbiot"],
  },
  {
    key: "SUPP_SILHOUETTE", categories: SUPP, label: "Silhouette et rétention", funnelStages: MID,
    problem: "Jambes lourdes, sensation de gonflement.", frustration: "Régimes et sport sans effet visible.",
    desire: "Se sentir légère, affinée.", objection: "Les « brûle-graisses » sont des arnaques.",
    belief: "Seul le sport agit sur la silhouette.", misconception: "Un complément fait maigrir seul.",
    question: "Un complément peut-il aider la rétention d'eau ?", emotion: "Agacement devant le miroir.",
    keywords: ["minceur", "silhouette", "poids", "draina", "rétention", "retention", "jambes lourdes", "ventre plat"],
  },
  {
    key: "SUPP_JOINTS", categories: SUPP, label: "Mobilité et articulations", funnelStages: MID,
    problem: "Genoux qui craquent, raideur au réveil.", frustration: "On réduit le sport au lieu d'agir.",
    desire: "Bouger sans y penser.", objection: "C'est l'âge, pas un complément qui changera ça.",
    belief: "Les articulations s'usent, point.", misconception: "Un complément agit en quelques jours.",
    question: "Que prendre pour les articulations quand on fait du sport ?", emotion: "Frustration de ralentir.",
    keywords: ["articul", "mobilit", "glucosam", "chondro", "sport", "muscle", "récup", "recup"],
  },
  {
    key: "SUPP_ROUTINE", categories: SUPP, label: "Je commence et j'arrête", funnelStages: ["CONSIDERATION", "RETENTION"],
    problem: "Les cures commencent fort et s'arrêtent au bout de dix jours.", frustration: "Les boîtes à moitié pleines dans le tiroir.",
    desire: "Un geste facile à tenir tous les jours.", objection: "Je n'arrive jamais à aller au bout.",
    belief: "Si je ne vois rien en une semaine, ça ne marche pas.", misconception: "On peut doubler la dose pour rattraper.",
    question: "Comment tenir une cure de trois mois ?", emotion: "Culpabilité douce.",
    keywords: ["cure", "gummies", "gomme", "sachet", "gélule", "gelule", "comprimé", "comprime", "quotidien", "mois", "stick"],
  },
];

export const TENSION_BY_KEY = new Map(TENSIONS.map((t) => [t.key, t]));

export function tensionOf(key: string): ConsumerTension | null {
  return TENSION_BY_KEY.get(key) ?? null;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Tension par défaut d'une catégorie quand la fiche produit n'active rien (jamais inventée : la plus générique). */
const DEFAULT_BY_CATEGORY: Record<CreativeCategory, string> = { SKINCARE: "SKIN_NATURAL_DOUBT", DERMOCOSMETIC: "SKIN_SENSITIVE", SUN: "SUN_TEXTURE", SUPPLEMENT: "SUPP_ROUTINE" };

export type TensionMatch = { tension: ConsumerTension; score: number; hits: string[] };

/**
 * Tensions activées par la fiche produit, classées : chaque mot-clé trouvé dans les bénéfices ou l'angle vaut 3,
 * dans les actifs ou les allégations 2, dans le nom ou la catégorie 1. Sans aucune activation : la tension par
 * défaut de la catégorie, marquée comme telle (score 0).
 */
export function matchTensions(p: Pick<ProductIntelligence, "category" | "name" | "benefits" | "actives" | "claims" | "marketingAngle" | "target">, extraCategoryText: string | null = null): TensionMatch[] {
  const strong = norm([...p.benefits, p.marketingAngle ?? ""].join(" \n "));
  const medium = norm([...p.actives, ...p.claims].join(" \n "));
  const weak = norm(`${p.name} ${extraCategoryText ?? ""} ${p.target ?? ""}`);
  const out: TensionMatch[] = [];
  for (const t of TENSIONS) {
    if (!t.categories.includes(p.category)) continue;
    let score = 0;
    const hits: string[] = [];
    for (const kw of t.keywords) {
      const k = norm(kw);
      // Un mot-clé court (« fer », « uv », « age ») n'est reconnu qu'en mot entier : « référence » n'active pas « fer ».
      const has = k.length <= 4 ? (hay: string) => new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(hay) : (hay: string) => hay.includes(k);
      if (has(strong)) { score += 3; hits.push(kw); }
      else if (has(medium)) { score += 2; hits.push(kw); }
      else if (has(weak)) { score += 1; hits.push(kw); }
    }
    if (score > 0) out.push({ tension: t, score, hits });
  }
  out.sort((a, b) => b.score - a.score || a.tension.label.localeCompare(b.tension.label));
  if (!out.length) { const d = TENSION_BY_KEY.get(DEFAULT_BY_CATEGORY[p.category])!; out.push({ tension: d, score: 0, hits: [] }); }
  return out;
}

/** Texte « tension » d'une opportunité : problème + désir en une phrase. */
export function tensionHeadline(t: ConsumerTension): string {
  return `${t.problem} → ${t.desire}`;
}
