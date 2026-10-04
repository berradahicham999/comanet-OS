/**
 * Couche B — intelligence produit (logique PURE).
 *
 * Lit la fiche produit de COMANET OS telle quelle (bénéfices, actifs, allégations, angle, cible, prix) et en déduit la
 * catégorie créative, le rôle dans la routine et la discipline des allégations. Rien n'est complété : un champ absent
 * est listé dans `missing` et le moteur le dit (« fiche marketing à compléter »), il ne l'estime jamais.
 */
import { heroWord, productKind } from "@/lib/action-generator/engine";
import { CATEGORY_LABELS } from "./territories";
import type { CreativeCategory, ProductIntelligence } from "./types";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Découpe un champ libre de la fiche (lignes, points-virgules, puces, phrases) en éléments courts. */
export function splitSheet(text: string | null | undefined): string[] {
  if (!text) return [];
  return text.split(/\n|;|•|\|/).map((x) => x.replace(/^[-–*\s]+/, "").trim()).filter((x) => x.length >= 3);
}

const DERMO_KW = ["dermato", "dermo", "pharmac", "clinique", "expert", "médical", "medical", "laboratoire", "science", "atopi", "peaux sensibles", "réactiv", "reactiv", "sebo", "cicatri", "dermatolog"];

/** Catégorie créative : type de produit (générateur) affiné par le positionnement de la marque et la fiche. */
export function creativeCategoryOf(p: { name: string; category: string | null; actives?: string | null }, brand: { name: string; positioning: string | null }): CreativeCategory {
  const kind = productKind(p);
  if (kind === "COMPLEMENT") return "SUPPLEMENT";
  if (kind === "SOLAIRE") return "SUN";
  const hay = norm(`${brand.name} ${brand.positioning ?? ""} ${p.category ?? ""} ${p.name}`);
  return DERMO_KW.some((k) => hay.includes(norm(k))) ? "DERMOCOSMETIC" : "SKINCARE";
}

/** Discipline des allégations par catégorie : ce qu'on peut dire, ce qu'on ne dit jamais. */
export function claimDisciplineOf(category: CreativeCategory): ProductIntelligence["claimDiscipline"] {
  if (category === "SUPPLEMENT") return {
    allowed: "Bénéfices nutritionnels ou physiologiques de la fiche produit, au conditionnel du ressenti (« contribue à », « aide à »), toujours avec la mention « ne se substitue pas à une alimentation variée et équilibrée ».",
    restricted: ["guérir, traiter, prévenir ou soigner une maladie", "remplacer un repas, un médicament ou un traitement", "promesse chiffrée de perte de poids", "effet garanti ou immédiat", "allusion à une pathologie (diabète, cholestérol, dépression, insomnie…)"],
  };
  if (category === "SUN") return {
    allowed: "Protection solaire selon l'indice et les mentions de l'étiquette ; confort, texture, usage quotidien ; rappel de ré-application.",
    restricted: ["protection totale ou « écran total »", "prévention du cancer de la peau", "bronzage sans risque", "résultat garanti"],
  };
  return {
    allowed: "Allégations cosmétiques de la fiche produit : hydrater, apaiser, nettoyer, matifier, unifier, confort, éclat, ressenti d'utilisation.",
    restricted: ["guérir, traiter, soigner ou cicatriser une maladie ou une lésion", "termes médicaux (eczéma, psoriasis, acné sévère, dermatite, infection, anti-inflammatoire, médicament)", "« cliniquement prouvé » ou « testé dermatologiquement » sans mention sur la fiche", "avant / après retouché ou chiffres non sourcés", "comparaison dénigrante avec une autre marque"],
  };
}

const ROLE_RULES: [RegExp, string][] = [
  [/nettoy|démaquill|demaquill|micell|mousse|gel lavant|lavant/i, "Étape 1 de la routine : nettoyage, matin et soir"],
  [/sérum|serum|concentr|ampoule|booster/i, "Étape 2 : soin ciblé, sur peau propre, avant la crème"],
  [/contour des yeux|regard|yeux/i, "Étape ciblée : contour des yeux, matin et soir, par tapotements"],
  [/masque/i, "Soin complémentaire : masque une à deux fois par semaine"],
  [/gommage|exfol|peeling/i, "Soin complémentaire : exfoliation une à deux fois par semaine"],
  [/solaire|spf|écran|ecran|uv/i, "Dernière étape du matin : protection solaire, à renouveler toutes les deux heures en exposition"],
  [/nuit/i, "Étape 3 du soir : soin de nuit, dernière étape"],
  [/corps|lait|vergeture|mains|pieds/i, "Soin du corps : après la douche, sur peau encore humide"],
  [/crème|creme|fluide|émulsion|emulsion|baume|hydrat/i, "Étape 3 : hydratation / protection, matin et soir, après le sérum"],
  [/gummies|gomme/i, "Prise quotidienne : 1 à 2 gommes par jour selon l'étiquette, en cure de plusieurs semaines"],
  [/sachet|stick|poudre/i, "Prise quotidienne : un sachet dilué, idéalement au même moment chaque jour, en cure"],
  [/gélule|gelule|capsule|comprimé|comprime|softgel/i, "Prise quotidienne au repas selon l'étiquette, en cure de plusieurs semaines"],
  [/ampoule|shot|sirop|solution buvable/i, "Prise quotidienne : une ampoule le matin, en cure"],
];

/** Rôle du produit dans la routine ou occasion d'usage : déduit du nom et de la catégorie (INFERRED). */
export function routineRoleOf(category: CreativeCategory, name: string, productCategory: string | null): string {
  const hay = `${name} ${productCategory ?? ""}`;
  for (const [re, role] of ROLE_RULES) if (re.test(hay)) return role;
  return category === "SUPPLEMENT" ? "Prise quotidienne en cure (voir l'étiquette pour la posologie)" : category === "SUN" ? "Protection solaire quotidienne, à renouveler" : "Soin quotidien, matin et / ou soir (voir la fiche produit)";
}

export type ProductSheetRow = {
  id: string | null; name: string; shortName: string | null; category: string | null; priceRetail: number | null;
  actives: string | null; marketingAngle: string | null; benefits: string | null; claims: string | null; target: string | null;
};

export type ProductPerfLite = { profile: string | null; growthPct: number | null; contributionPct: number | null; revenue90: number | null; stockRisk: string | null; daysOfStock: number | null };

export function buildProductIntelligence(row: ProductSheetRow, brand: { name: string; positioning: string | null }, perf: ProductPerfLite | null): ProductIntelligence {
  const category = creativeCategoryOf({ name: row.name, category: row.category, actives: row.actives }, brand);
  const benefits = splitSheet(row.benefits), actives = splitSheet(row.actives), claims = splitSheet(row.claims);
  const fields: [string, boolean][] = [["bénéfices", benefits.length > 0], ["actifs", actives.length > 0], ["allégations autorisées", claims.length > 0], ["angle marketing", !!row.marketingAngle?.trim()], ["cible", !!row.target?.trim()], ["prix public", row.priceRetail !== null && row.priceRetail > 0]];
  const missing = fields.filter(([, ok]) => !ok).map(([f]) => f);
  return {
    productId: row.id, name: row.name, hero: heroWord({ name: row.name, shortName: row.shortName }, brand.name), brandName: brand.name,
    category, categoryLabel: CATEGORY_LABELS[category], priceRetail: row.priceRetail,
    benefits, actives, claims, marketingAngle: row.marketingAngle?.trim() || null, target: row.target?.trim() || null,
    routineRole: routineRoleOf(category, row.name, row.category), claimDiscipline: claimDisciplineOf(category),
    profile: perf?.profile ?? null, growthPct: perf?.growthPct ?? null, contributionPct: perf?.contributionPct ?? null, revenue90: perf?.revenue90 ?? null,
    stockRisk: perf?.stockRisk ?? null, daysOfStock: perf?.daysOfStock ?? null,
    sheetCompleteness: (fields.length - missing.length) / fields.length, missing,
  };
}

/** Intelligence « marque » quand aucun produit n'est désigné : la marque est le héros, la fiche est vide. */
export function brandAsProduct(brand: { name: string; positioning: string | null; target: string | null }, category: CreativeCategory): ProductIntelligence {
  return {
    productId: null, name: brand.name, hero: brand.name, brandName: brand.name, category, categoryLabel: CATEGORY_LABELS[category], priceRetail: null,
    benefits: [], actives: [], claims: [], marketingAngle: brand.positioning, target: brand.target, routineRole: "Gamme complète : routine de la marque",
    claimDiscipline: claimDisciplineOf(category), profile: null, growthPct: null, contributionPct: null, revenue90: null, stockRisk: null, daysOfStock: null,
    sheetCompleteness: 0, missing: ["produit non désigné : fiche produit non lue"],
  };
}

/** Audience : cible de la fiche produit, sinon cible de la marque, sinon la cible par défaut du générateur. */
export function audienceOf(product: { target: string | null }, brand: { target: string | null }, fallback: string): string {
  return product.target?.trim() || brand.target?.trim() || fallback;
}
