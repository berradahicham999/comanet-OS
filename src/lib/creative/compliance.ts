/**
 * Conformité des allégations (logique PURE) — le contrôle déterministe qui précède et suit l'IA.
 *
 * Trois familles de contrôles, par catégorie de produit :
 *  1. formulations interdites (cosmétique : thérapeutique / médical ; complément : guérison, pathologie, perte de poids) ;
 *  2. éléments non vérifiés sur la fiche produit : ingrédient cité qui n'y figure pas, chiffre ou délai non sourcé ;
 *  3. mentions obligatoires de la catégorie (compléments, solaires).
 * Un BLOCK empêche l'envoi en production ; un WARN exige une relecture réglementaire ; un INFO est un rappel.
 */
import type { ComplianceFlag, ContentPackage, CreativeCategory, CreativeConcept, ProductIntelligence } from "./types";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Rule = { code: string; re: RegExp; severity: ComplianceFlag["severity"]; text: string; categories: CreativeCategory[] | "ALL" };

const COSMETIC: CreativeCategory[] = ["SKINCARE", "DERMOCOSMETIC", "SUN"];

const RULES: Rule[] = [
  { code: "THERAPEUTIC", severity: "BLOCK", categories: COSMETIC, re: /\b(gu[ée]ri[rt]|soign(e|er|é)|trait(e|er|ement)|cicatrise (une|la|les) (plaie|l[ée]sion|maladie)|anti-?inflammatoire|m[ée]dicament|th[ée]rapeutique|antibiotique|cortisone|infection)\b/i, text: "Allégation thérapeutique interdite en cosmétique" },
  { code: "PATHOLOGY", severity: "BLOCK", categories: COSMETIC, re: /\b(ecz[ée]ma|psoriasis|dermatite|rosac[ée]e|acn[ée] s[ée]v[èe]re|mycose|verrue|maladie)\b/i, text: "Nom de pathologie : la cosmétique ne traite pas une maladie" },
  { code: "LIFTING", severity: "WARN", categories: COSMETIC, re: /\b(comme un lifting|effet botox|efface (d[ée]finitivement|toutes) les rides|rajeunit de \d+ ans)\b/i, text: "Promesse de résultat médical ou définitif" },
  { code: "SUN_TOTAL", severity: "BLOCK", categories: ["SUN"], re: /\b([ée]cran total|protection totale|100 ?% des uv|bronzer sans risque|pr[ée]vient le cancer)\b/i, text: "Allégation solaire interdite (protection totale, cancer)" },
  { code: "DISEASE", severity: "BLOCK", categories: ["SUPPLEMENT"], re: /\b(gu[ée]ri[rt]|soign(e|er)|trait(e|er|ement)|pr[ée]vient (la|les|une) maladie|remplace (un |le |votre )?(repas|m[ée]dicament|traitement)|m[ée]dicament|diab[èe]te|cholest[ée]rol|hypertension|d[ée]pression|insomnie|anti-?cancer|anxi[ée]t[ée] (trait|gu[ée]ri))\b/i, text: "Allégation de santé interdite pour un complément alimentaire" },
  { code: "WEIGHT", severity: "BLOCK", categories: ["SUPPLEMENT"], re: /\b(perd(re|ez) \d+ ?kg|maigrir vite|perte de poids garantie|br[uû]le-? ?graisses?)\b/i, text: "Promesse de perte de poids chiffrée ou garantie" },
  { code: "MIRACLE", severity: "WARN", categories: "ALL", re: /\b(miracle|r[ée]sultats? garantis?|100 ?% (efficace|naturel et efficace)|sans (aucun )?effet secondaire|imm[ée]diat(ement)? visible|d[ée]tox)\b/i, text: "Formulation excessive ou non vérifiable" },
  { code: "CLINICAL", severity: "WARN", categories: "ALL", re: /\b(cliniquement (prouv[ée]|test[ée]|d[ée]montr[ée])|test[ée] (dermatologiquement|sous contr[ôo]le)|[ée]tude clinique|prouv[ée] scientifiquement)\b/i, text: "Preuve clinique citée : à vérifier sur la fiche produit et le dossier réglementaire" },
  { code: "COMPETITOR", severity: "WARN", categories: "ALL", re: /\b(meilleur que|contrairement [àa] (la marque|aux autres marques)|les autres marques)\b/i, text: "Comparaison dénigrante" },
  { code: "BEFORE_AFTER", severity: "INFO", categories: "ALL", re: /\b(avant\s*\/\s*apr[èe]s|before\s*\/\s*after|photo avant)\b/i, text: "Avant / après : photos réelles, non retouchées, même lumière ; préférer le ressenti" },
];

/** Ingrédients et actifs fréquents : s'ils apparaissent dans un texte sans figurer sur la fiche produit, c'est une invention. */
const INGREDIENTS: [string, RegExp][] = [
  ["acide hyaluronique", /acide hyaluron|hyaluronic/i], ["rétinol", /r[ée]tinol|retinal|bakuchiol/i], ["niacinamide", /niacinamide|vitamine b3/i], ["vitamine C", /vitamine c\b|ascorb/i],
  ["collagène", /collag[èe]ne|collagen/i], ["zinc", /\bzinc\b/i], ["biotine", /biotine|vitamine b8/i], ["céramides", /c[ée]ramide/i], ["AHA / BHA", /\b(aha|bha|acide glycolique|acide salicylique|acide lactique)\b/i],
  ["peptides", /peptide/i], ["magnésium", /magn[ée]sium/i], ["oméga 3", /om[ée]ga/i], ["probiotiques", /probiot|ferments? lactique/i], ["fer", /\bfer\b/i], ["kératine", /k[ée]ratine/i],
  ["squalane", /squalane/i], ["aloe vera", /aloe/i], ["beurre de karité", /karit[ée]/i], ["huile d'argan", /argan/i], ["centella", /centella|cica\b/i], ["vitamine D", /vitamine d\b/i], ["vitamine E", /vitamine e\b|tocoph[ée]rol/i],
  ["mélatonine", /m[ée]latonine/i], ["ashwagandha", /ashwagandha/i], ["curcuma", /curcuma|curcumine/i], ["spiruline", /spiruline/i], ["glucosamine", /glucosamine|chondro[ïi]tine/i], ["coenzyme Q10", /q10|coenzyme/i],
  ["eau thermale", /eau thermale/i], ["SPF", /\bspf ?\d+|indice ?\d+/i], ["acide azélaïque", /az[ée]la[ïi]que/i], ["sélénium", /s[ée]l[ée]nium/i], ["ginseng", /ginseng/i], ["safran", /safran/i],
];

export type ComplianceContext = { category: CreativeCategory; product: Pick<ProductIntelligence, "name" | "benefits" | "actives" | "claims" | "marketingAngle"> };

function sheetText(c: ComplianceContext): string {
  return norm([c.product.name, ...c.product.benefits, ...c.product.actives, ...c.product.claims, c.product.marketingAngle ?? ""].join(" \n "));
}

function excerpt(text: string, m: RegExpMatchArray): string {
  const i = m.index ?? 0;
  return text.slice(Math.max(0, i - 40), Math.min(text.length, i + (m[0]?.length ?? 0) + 40)).replace(/\s+/g, " ").trim();
}

/** Contrôle d'un texte libre (concept, script, légende). */
export function checkText(text: string, ctx: ComplianceContext, where = "texte"): ComplianceFlag[] {
  const flags: ComplianceFlag[] = [];
  if (!text?.trim()) return flags;
  const sheet = sheetText(ctx);
  for (const r of RULES) {
    if (r.categories !== "ALL" && !r.categories.includes(ctx.category)) continue;
    const m = text.match(r.re);
    if (m) flags.push({ severity: r.severity, code: r.code, text: `${r.text} (${where})`, excerpt: excerpt(text, m) });
  }
  for (const [label, re] of INGREDIENTS) {
    const m = text.match(re);
    if (m && !re.test(sheet)) flags.push({ severity: "WARN", code: "INGREDIENT_UNVERIFIED", text: `Ingrédient « ${label} » cité mais absent de la fiche produit (${where})`, excerpt: excerpt(text, m) });
  }
  // Chiffres et délais de résultat non présents sur la fiche : « en 7 jours », « 92 % », « 2 fois plus ».
  for (const m of text.matchAll(/(\d{1,3}\s?%|en\s\d{1,3}\s(jours?|semaines?|mois)|\d{1,3}\s(jours?|semaines?)\s(pour|suffisent)|\d+\s?(fois|x)\s(plus|moins))/gi)) {
    const token = norm(m[0]).replace(/\s+/g, " ");
    if (!sheet.replace(/\s+/g, " ").includes(token)) flags.push({ severity: "WARN", code: "UNSOURCED_FIGURE", text: `Chiffre ou délai non sourcé sur la fiche produit (${where})`, excerpt: excerpt(text, m) });
  }
  return dedupe(flags);
}

function dedupe(flags: ComplianceFlag[]): ComplianceFlag[] {
  const seen = new Set<string>();
  return flags.filter((f) => { const k = `${f.code}|${f.text}|${f.excerpt}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Mentions obligatoires à faire figurer (légende, carte de fin, description). */
export function mandatoryMentions(category: CreativeCategory): string[] {
  if (category === "SUPPLEMENT") return ["Complément alimentaire : ne se substitue pas à une alimentation variée et équilibrée ni à un mode de vie sain.", "Respecter la dose journalière indiquée ; tenir hors de portée des enfants."];
  if (category === "SUN") return ["Ne pas s'exposer trop longtemps, même avec une protection solaire ; renouveler l'application fréquemment."];
  return ["Produit cosmétique : usage externe. Disponible en pharmacie et parapharmacie."];
}

export function checkConcept(c: Pick<CreativeConcept, "title" | "bigIdea" | "coreMessage" | "insight" | "organicVersion" | "paidVersion" | "productRole">, ctx: ComplianceContext): ComplianceFlag[] {
  return dedupe([
    ...checkText(c.title, ctx, "titre"), ...checkText(c.bigIdea, ctx, "idée"), ...checkText(c.coreMessage, ctx, "message"),
    ...checkText(c.insight, ctx, "insight"), ...checkText(c.productRole, ctx, "rôle du produit"), ...checkText(c.organicVersion, ctx, "version organique"), ...checkText(c.paidVersion, ctx, "version payante"),
  ]);
}

export function checkPackage(p: Omit<ContentPackage, "compliance" | "claims" | "generatedBy">, ctx: ComplianceContext): ComplianceFlag[] {
  const flags: ComplianceFlag[] = [];
  p.hooks.forEach((h, i) => flags.push(...checkText(h.text, ctx, `accroche ${i + 1}`)));
  p.scripts.forEach((s) => s.scenes.forEach((sc) => { flags.push(...checkText(sc.dialogue ?? "", ctx, `${s.label} scène ${sc.n}`)); flags.push(...checkText(sc.voiceOver ?? "", ctx, `${s.label} voix off ${sc.n}`)); flags.push(...checkText(sc.onScreenText ?? "", ctx, `${s.label} texte ${sc.n}`)); }));
  flags.push(...checkText(p.caption, ctx, "légende"), ...checkText(p.cta, ctx, "CTA"), ...checkText(p.thumbnail, ctx, "miniature"));
  p.paidHookVariants.forEach((h, i) => flags.push(...checkText(h, ctx, `accroche payante ${i + 1}`)));
  p.ctaVariants.forEach((h, i) => flags.push(...checkText(h, ctx, `CTA ${i + 1}`)));
  p.onScreenTexts.forEach((h, i) => flags.push(...checkText(h, ctx, `texte à l'écran ${i + 1}`)));
  flags.push(...checkText(p.organic.hook, ctx, "accroche organique"), ...checkText(p.paid.hook, ctx, "accroche payante"));
  return dedupe(flags);
}

export const hasBlock = (flags: ComplianceFlag[]) => flags.some((f) => f.severity === "BLOCK");
export const SEVERITY_LABELS: Record<ComplianceFlag["severity"], string> = { BLOCK: "bloquant", WARN: "à vérifier", INFO: "rappel" };
