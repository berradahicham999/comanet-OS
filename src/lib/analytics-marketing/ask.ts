/**
 * Bloc « question » — copilote sans modèle de langage (logique PURE, testée sans base).
 *
 * Une phrase en français (« quel canal marche le mieux pour Gamarde à Marrakech ce trimestre ? »)
 * est lue par mots-clés : marque, canal, ville, période, produit, et le type de question
 * (meilleur canal, dépense, ROI, produit à pousser, budget). La page construit ensuite la
 * réponse à partir du dictionnaire de métriques, en séparant Donnée / Analyse / Hypothèse /
 * Recommandation. Ce qui n'est pas compris est dit tel quel — rien n'est deviné.
 */

export type Intent = "BEST_CHANNEL" | "WORST_CHANNEL" | "SPEND" | "ROI" | "PRODUCTS" | "BUDGET" | "SALES" | "OVERVIEW";
export type PeriodKey = "month" | "prevMonth" | "quarter" | "ytd" | "last30" | "last90" | "last12m";

export type ParsedQuestion = {
  intent: Intent;
  brandId: string | null;
  channelKey: string | null;
  city: string | null;
  productId: string | null;
  period: PeriodKey;
  /** Ce que la phrase contenait et qui n'a pas été reconnu comme marque, canal, ville ou produit. */
  unknown: string[];
  /** Ce qui a été reconnu, pour l'afficher (« j'ai compris : … »). */
  understood: string[];
};

export type Vocabulary = {
  brands: { id: string; name: string; aliases?: string[] }[];
  channels: { key: string; label: string; aliases?: string[] }[];
  cities: string[];
  products: { id: string; name: string }[];
};

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const INTENTS: [Intent, RegExp][] = [
  ["WORST_CHANNEL", /(pire|moins bien|marche le moins|plus mauvais|arreter|couper)/],
  ["BEST_CHANNEL", /(meilleur|marche le mieux|plus efficace|plus rentable|performe|rapporte le plus|quel canal|quels canaux)/],
  ["ROI", /\b(roi|retour|rentab|rapporte|ratio)\b/],
  ["BUDGET", /(budget|enveloppe|reste a depenser|restant|consomm)/],
  ["SPEND", /(depense|depens|combien on a mis|combien avons|investi|cout)/],
  ["PRODUCTS", /(produit|pousser|dormant|pepite|reference)/],
  ["SALES", /(vente|sell.?in|sell.?out|chiffre d affaires|\bca\b|objectif)/],
];

const PERIODS: [PeriodKey, RegExp][] = [
  ["prevMonth", /(mois dernier|mois precedent|le mois passe)/],
  ["last12m", /(12 derniers mois|douze derniers mois|un an|annee glissante)/],
  ["ytd", /(depuis le debut de l annee|cette annee|annee en cours|ytd)/],
  ["quarter", /(trimestre)/],
  ["last90", /(90 derniers jours|trois derniers mois|3 derniers mois)/],
  ["last30", /(30 derniers jours|dernier mois glissant|ces 30 jours)/],
  ["month", /(ce mois|mois en cours)/],
];

function findEntity<T extends { id?: string; key?: string }>(text: string, items: (T & { names: string[] })[]): T | null {
  let best: { item: T; len: number } | null = null;
  for (const it of items) for (const n of it.names) {
    const f = fold(n);
    if (f.length >= 3 && new RegExp(`(^| )${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(text) && (!best || f.length > best.len)) best = { item: it, len: f.length };
  }
  return best?.item ?? null;
}

const CHANNEL_SYNONYMS: Record<string, string[]> = {
  META_ADS: ["meta", "facebook ads", "instagram ads", "pub facebook", "pub instagram", "ads"],
  TIKTOK_ADS: ["tiktok ads", "pub tiktok"],
  GOOGLE_ADS: ["google", "google ads", "sea"],
  ANIMATION_POS: ["animation", "animations", "animatrice", "animatrices", "terrain", "point de vente"],
  INFLUENCE: ["influence", "influenceur", "influenceuse", "influenceurs"],
  ORGANIC_INSTAGRAM: ["instagram", "insta"],
  ORGANIC_FACEBOOK: ["facebook"],
  ORGANIC_TIKTOK: ["tiktok"],
  EVENT: ["evenement", "evenements", "event"],
  PLV: ["plv"],
  SAMPLING: ["sampling", "echantillon", "echantillons"],
  PRESCRIPTION: ["medecin", "medecins", "prescripteur", "prescripteurs", "delegue"],
};

export function parseQuestion(question: string, vocab: Vocabulary): ParsedQuestion {
  const text = ` ${fold(question)} `;
  const understood: string[] = [];
  const intent = INTENTS.find(([, re]) => re.test(text))?.[0] ?? "OVERVIEW";
  const period = PERIODS.find(([, re]) => re.test(text))?.[0] ?? "month";
  if (PERIODS.some(([, re]) => re.test(text))) understood.push(`période : ${period}`);

  const brand = findEntity(text, vocab.brands.map((b) => ({ ...b, names: [b.name, ...(b.aliases ?? [])] })));
  if (brand) understood.push(`marque : ${brand.name}`);
  const channel = findEntity(text, vocab.channels.map((c) => ({ ...c, names: [c.label, ...(c.aliases ?? []), ...(CHANNEL_SYNONYMS[c.key] ?? [])] })));
  if (channel) understood.push(`canal : ${channel.label}`);
  const city = findEntity(text, vocab.cities.map((c) => ({ id: c, names: [c] })));
  if (city) understood.push(`ville : ${city.id}`);
  const product = findEntity(text, vocab.products.map((p) => ({ ...p, names: [p.name] })));
  if (product) understood.push(`produit : ${product.name}`);

  // Mots restants, hors mots-outils et entités reconnues : signalés comme non compris.
  const STOP = new Set("quel quelle quels quelles est le la les de des du un une pour a au aux en et ou sur ce cette ces mois trimestre annee dernier derniere derniers jours canal canaux marche mieux meilleur pire combien on nous avons ont depense depenses roi retour budget produit produits vente ventes sell in out ca objectif qui que quoi comment plus moins bien mal marque ville chez avec dans par il elle y ai je tu vous notre nos notre depuis debut cours ce sont fait faut il faudrait doit devrait pousser arreter".split(" "));
  const recognized = new Set([brand?.name, channel?.label, city?.id, product?.name, ...(channel ? CHANNEL_SYNONYMS[channel.key] ?? [] : [])].filter(Boolean).flatMap((n) => fold(n as string).split(" ")));
  const unknown = text.trim().split(" ").filter((w) => w.length > 2 && !STOP.has(w) && !recognized.has(w) && !/^\d+$/.test(w));

  return { intent, brandId: brand?.id ?? null, channelKey: channel?.key ?? null, city: city?.id ?? null, productId: product?.id ?? null, period, unknown: [...new Set(unknown)], understood };
}

export const INTENT_LABELS: Record<Intent, string> = {
  BEST_CHANNEL: "Quel canal marche le mieux",
  WORST_CHANNEL: "Quel canal marche le moins bien",
  SPEND: "Combien a été dépensé",
  ROI: "Ce que ça rapporte",
  PRODUCTS: "Quels produits pousser",
  BUDGET: "Où en est le budget",
  SALES: "Où en sont les ventes",
  OVERVIEW: "Vue d'ensemble",
};
