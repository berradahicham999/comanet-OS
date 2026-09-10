/**
 * Ads Analysis Engine.
 *
 * Chaque campagne publicitaire est comparée à elle-même (30 j vs 30 j précédents, vs 90 j) et
 * aux autres campagnes de la même marque. Le verdict SCALE / MAINTAIN / OPTIMIZE / STOP n'est
 * jamais donné seul : le diagnostic dit QUEL maillon se dégrade (diffusion, accroche, post-clic)
 * et l'action porte sur ce maillon.
 *
 * `diagnose()` est le SEUL moteur de verdict de l'application : l'écran Digital Ads et la
 * règle `ads-performance` de l'Action Center l'appellent tous les deux. Aucun de ses seuils
 * n'est écrit ici — ils viennent tous de `settings.ads` (`AdThresholds`), passés en argument.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { AD_VERDICTS, type AdVerdict } from "./marketing-shared";
import type { AdThresholds } from "./settings";

export type Range = { start: string; end: string };

export type AdRow = {
  key: string;
  platform: string;
  campaignName: string;
  campaignId: string | null;
  brandId: string | null;
  brandName: string | null;
  brandColor: string | null;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  landingPageViews: number;
  leads: number;
  purchases: number;
  messagingStarted: number;
  revenue: number;
  days: number;
  /** Objectif Meta de la campagne (OUTCOME_TRAFFIC, OUTCOME_AWARENESS…), relevé au dernier passage. */
  objective: string | null;
  /** Vues vidéo et engagements : absents des exports fichier (0). */
  videoViews?: number;
  postEngagement?: number;
};

/**
 * LE RÉSULTAT d'une ligne publicitaire selon son objectif — la seule définition.
 *
 * Les comptes COMANET ne suivent aucun achat : juger une campagne « Messages » ou « Trafic »
 * au CPA d'achat la condamne à tort. Le résultat officiel est donc celui de l'objectif Meta ;
 * sans objectif connu (import fichier), on retient ce qui est mesuré, du plus engageant au
 * moins engageant : achat, lead, conversation, clic sur lien.
 */
export type ResultKind = "purchase" | "lead" | "message" | "landing" | "click" | "reach" | "video" | "engagement";
export const RESULT_LABELS: Record<ResultKind, { one: string; many: string; cost: string }> = {
  purchase: { one: "achat", many: "achats", cost: "CPA" },
  lead: { one: "lead", many: "leads", cost: "coût / lead" },
  message: { one: "conversation", many: "conversations", cost: "coût / conversation" },
  landing: { one: "vue de page", many: "vues de page", cost: "coût / vue de page" },
  click: { one: "clic", many: "clics", cost: "CPC" },
  reach: { one: "personne touchée", many: "personnes touchées", cost: "coût / 1 000 personnes" },
  video: { one: "vue vidéo", many: "vues vidéo", cost: "coût / vue" },
  engagement: { one: "engagement", many: "engagements", cost: "coût / engagement" },
};

export function resultKindOf(objective: string | null, r: Pick<AdRow, "purchases" | "leads" | "messagingStarted" | "landingPageViews" | "linkClicks" | "clicks" | "reach" | "videoViews" | "postEngagement">): ResultKind {
  const o = (objective ?? "").toUpperCase();
  if (o.includes("SALES") || o.includes("PURCHASE") || o.includes("CONVERSIONS")) return "purchase";
  if (o.includes("LEAD")) return "lead";
  if (o.includes("MESSAGE")) return "message";
  if (o.includes("AWARENESS") || o.includes("REACH")) return "reach";
  if (o.includes("VIDEO")) return "video";
  if (o.includes("ENGAGEMENT")) return r.messagingStarted > 0 ? "message" : (r.postEngagement ?? 0) > 0 ? "engagement" : "click";
  if (o.includes("TRAFFIC") || o.includes("LINK_CLICKS")) return r.landingPageViews > 0 ? "landing" : "click";
  // Objectif inconnu : ce qui est mesuré, du plus engageant au moins engageant.
  if (r.purchases > 0) return "purchase";
  if (r.leads > 0) return "lead";
  if (r.messagingStarted > 0) return "message";
  // Rien de mesuré et pas d'objectif : on reste sur l'achat, et le moteur dira « aucune conversion » plutôt
  // que de juger des clics dont on ignore s'ils étaient le but.
  return "purchase";
}

export function resultCount(kind: ResultKind, r: Pick<AdRow, "purchases" | "leads" | "messagingStarted" | "landingPageViews" | "linkClicks" | "clicks" | "reach" | "videoViews" | "postEngagement">): number {
  switch (kind) {
    case "purchase": return r.purchases;
    case "lead": return r.leads;
    case "message": return r.messagingStarted;
    case "landing": return r.landingPageViews;
    case "reach": return r.reach;
    case "video": return r.videoViews ?? 0;
    case "engagement": return r.postEngagement ?? 0;
    default: return r.linkClicks || r.clicks;
  }
}

export type AdKpis = AdRow & {
  cpm: number | null;
  ctr: number | null;
  cpc: number | null;
  conversionRate: number | null;
  cpa: number | null;
  roas: number | null;
  frequency: number | null;
  costPerLead: number | null;
  costPerMessage: number | null;
  /** Résultat officiel de l'objectif (voir `resultKindOf`), son nombre, son coût et son taux par clic ou par mille. */
  resultKind: ResultKind;
  results: number;
  costPerResult: number | null;
  resultRate: number | null;
};

export function kpis(r: AdRow): AdKpis {
  const clicks = r.linkClicks || r.clicks;
  const resultKind = resultKindOf(r.objective, r);
  const results = resultCount(resultKind, r);
  // Un résultat « couverture » se paie aux mille personnes, pas à l'unité.
  const costPerResult = results > 0 ? (resultKind === "reach" ? (r.spend / results) * 1000 : r.spend / results) : null;
  const resultRate = resultKind === "reach" || resultKind === "click" || resultKind === "video" || resultKind === "engagement"
    ? (r.impressions > 0 ? (results / r.impressions) * 100 : null)
    : (clicks > 0 ? (results / clicks) * 100 : null);
  return {
    ...r,
    resultKind, results, costPerResult, resultRate,
    cpm: r.impressions > 0 ? (r.spend / r.impressions) * 1000 : null,
    ctr: r.impressions > 0 ? (clicks / r.impressions) * 100 : null,
    cpc: clicks > 0 ? r.spend / clicks : null,
    conversionRate: clicks > 0 ? (r.purchases / clicks) * 100 : null,
    cpa: r.purchases > 0 ? r.spend / r.purchases : null,
    // Sans valeur de conversion mesurée, le ROAS n'est pas « 0 » : il n'existe pas.
    roas: r.spend > 0 && r.revenue > 0 ? r.revenue / r.spend : null,
    frequency: r.reach > 0 ? r.impressions / r.reach : null,
    costPerLead: r.leads > 0 ? r.spend / r.leads : null,
    costPerMessage: r.messagingStarted > 0 ? r.spend / r.messagingStarted : null,
  };
}

/**
 * Le résultat qui compte pour CETTE campagne, selon son objectif Meta — pas systématiquement
 * l'achat. La plupart des campagnes ici visent le trafic ou la messagerie, jamais la vente en
 * ligne : leur afficher un CPA ou un ROAS qui ne sera jamais atteint masque ce qu'elles font
 * réellement. Objectif inconnu (import fichier, campagne non relevée) → clics par défaut, la
 * mesure la plus universelle.
 */
export type PrimaryResult = { label: string; value: number; formatted: string; sub: string | null };

export function primaryResult(objective: string | null, r: AdKpis): PrimaryResult {
  const o = (objective ?? "").toUpperCase();
  const clicks = r.linkClicks || r.clicks;

  if (o.includes("SALES") || o.includes("PURCHASE")) {
    return { label: "Achats", value: r.purchases, formatted: String(r.purchases), sub: r.cpa !== null ? `CPA ${Math.round(r.cpa)} MAD` : "aucun achat suivi" };
  }
  if (o.includes("LEAD")) {
    return { label: "Leads", value: r.leads, formatted: String(r.leads), sub: r.costPerLead !== null ? `${Math.round(r.costPerLead)} MAD / lead` : "aucun lead suivi" };
  }
  if (o.includes("AWARENESS")) {
    return { label: "Impressions", value: r.impressions, formatted: r.impressions.toLocaleString("fr-FR"), sub: r.cpm !== null ? `CPM ${Math.round(r.cpm)} MAD` : null };
  }
  if (o.includes("ENGAGEMENT")) {
    // Une campagne Messages (WhatsApp/Messenger) reste classée « Engagement » côté Meta : on ne
    // le sait qu'en constatant des conversations démarrées, Meta ne le dit pas autrement ici.
    if (r.messagingStarted > 0) {
      return { label: "Messages démarrés", value: r.messagingStarted, formatted: String(r.messagingStarted), sub: r.costPerMessage !== null ? `${Math.round(r.costPerMessage)} MAD / message` : null };
    }
    return { label: "Clics", value: clicks, formatted: clicks.toLocaleString("fr-FR"), sub: r.ctr !== null ? `CTR ${r.ctr.toFixed(2)} %` : null };
  }
  // TRAFFIC, LINK_CLICKS, et tout objectif non reconnu.
  return { label: "Clics", value: clicks, formatted: clicks.toLocaleString("fr-FR"), sub: r.ctr !== null ? `CTR ${r.ctr.toFixed(2)} %` : null };
}

/**
 * Agrégat des métriques publicitaires sur une période, par campagne ou par publicité.
 *
 * La journée en cours est exclue par défaut : sa dépense est déjà enregistrée alors que ses
 * conversions arriveront plus tard, donc elle dégraderait mécaniquement tout CPA et tout ROAS
 * comparés. Elle s'affiche à part, jamais mélangée à des périodes closes.
 */
export async function adsByDim(dim: "campaign" | "ad" | "platform" | "brand", range: Range, filter?: { brandId?: string | null; platform?: string | null; includePartial?: boolean }): Promise<AdRow[]> {
  const where = sql`m.date >= ${range.start}::date and m.date < ${range.end}::date
    ${filter?.includePartial ? sql`` : sql`and m.is_partial = false`}
    ${filter?.brandId ? sql`and m.brand_id = ${filter.brandId}::uuid` : sql``}
    ${filter?.platform ? sql`and m.platform = ${filter.platform}` : sql``}`;
  const key =
    dim === "campaign" ? sql`m.platform || '|' || m.campaign_name`
      : dim === "ad" ? sql`m.platform || '|' || coalesce(m.ad_name, m.campaign_name)`
        : dim === "platform" ? sql`m.platform`
          : sql`coalesce(m.brand_id::text, 'none')`;
  const label =
    dim === "campaign" ? sql`max(m.campaign_name)`
      : dim === "ad" ? sql`max(coalesce(m.ad_name, m.campaign_name))`
        : dim === "platform" ? sql`max(m.platform)`
          : sql`max(coalesce(b.name, 'Sans marque'))`;
  const r = await db.execute(sql`
    select ${key} as key, max(m.platform) as platform, ${label} as campaign_name,
      max(m.campaign_id::text) as campaign_id, max(m.brand_id::text) as brand_id,
      max(b.name) as brand_name, max(b.color) as brand_color,
      coalesce(sum(m.spend), 0)::float8 as spend,
      coalesce(sum(m.impressions), 0)::float8 as impressions,
      coalesce(sum(m.reach), 0)::float8 as reach,
      coalesce(sum(m.clicks), 0)::float8 as clicks,
      coalesce(sum(m.link_clicks), 0)::float8 as link_clicks,
      coalesce(sum(m.landing_page_views), 0)::float8 as landing_page_views,
      coalesce(sum(m.leads), 0)::float8 as leads,
      coalesce(sum(m.purchases), 0)::float8 as purchases,
      coalesce(sum(m.messaging_started), 0)::float8 as messaging_started,
      coalesce(sum(m.revenue), 0)::float8 as revenue,
      count(distinct m.date)::int as days,
      -- Objectif : celui du dernier état de diffusion relevé pour cette campagne de régie.
      -- Une seule campagne par clé dans l'immense majorité des cas (dim = campaign/ad) ;
      -- max() départage les rares cas où le nom a été réutilisé.
      max(cs.objective) as objective
    from ad_metrics m
    left join brands b on b.id = m.brand_id
    left join ad_campaign_states cs on cs.platform = m.platform and cs.external_campaign_id = m.external_campaign_id
    where ${where}
    group by 1 order by spend desc`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    key: String(x.key), platform: String(x.platform), campaignName: String(x.campaign_name),
    campaignId: x.campaign_id ? String(x.campaign_id) : null,
    brandId: x.brand_id ? String(x.brand_id) : null,
    brandName: x.brand_name ? String(x.brand_name) : null,
    brandColor: x.brand_color ? String(x.brand_color) : null,
    spend: Number(x.spend), impressions: Number(x.impressions), reach: Number(x.reach),
    clicks: Number(x.clicks), linkClicks: Number(x.link_clicks), landingPageViews: Number(x.landing_page_views),
    leads: Number(x.leads), purchases: Number(x.purchases), messagingStarted: Number(x.messaging_started),
    revenue: Number(x.revenue), days: Number(x.days),
    objective: x.objective ? String(x.objective) : null,
  }));
}

export type Diagnosis = {
  verdict: AdVerdict;
  headline: string;
  signals: { label: string; value: string; delta: number | null; good: boolean | null }[];
  diagnostic: string;
  actions: string[];
};

const pct = (cur: number | null, ref: number | null) =>
  cur === null || ref === null || ref === 0 ? null : ((cur - ref) / ref) * 100;

const fmtDelta = (v: number | null) => (v === null ? "n/a" : `${v > 0 ? "+" : ""}${Math.round(v)} %`);

/**
 * Diagnostic d'une campagne : compare la période à la référence (période précédente de même
 * longueur) et à la moyenne de la marque. Le verdict découle du coût par achat et du ROAS ;
 * le diagnostic isole le maillon responsable.
 */
export function diagnose(cur: AdKpis, ref: AdKpis | null, brandAvg: { cpa: number | null; roas: number | null; ctr: number | null; costPerResult?: number | null } | null, t: AdThresholds): Diagnosis {
  // Le « CPA » du moteur est le coût du résultat de l'objectif : l'achat quand il est suivi,
  // sinon la conversation, la vue de page, le lead… (`resultKindOf`). Même seuils, même logique.
  const isPurchase = cur.resultKind === "purchase";
  const cpaCur = isPurchase ? cur.cpa : cur.costPerResult;
  const cpaRef = ref ? (isPurchase ? ref.cpa : ref.costPerResult) : null;
  const cpaBrand = brandAvg ? (isPurchase ? brandAvg.cpa : (brandAvg.costPerResult ?? null)) : null;
  const convCur = isPurchase ? cur.conversionRate : cur.resultRate;
  const convRef = ref ? (isPurchase ? ref.conversionRate : ref.resultRate) : null;
  const costLabel = isPurchase ? "CPA" : RESULT_LABELS[cur.resultKind].cost;
  const resultsLabel = RESULT_LABELS[cur.resultKind].many;

  const dCpa = pct(cpaCur, cpaRef);
  const dCtr = pct(cur.ctr, ref?.ctr ?? null);
  const dCpm = pct(cur.cpm, ref?.cpm ?? null);
  const dConv = pct(convCur, convRef);
  const dRoas = pct(cur.roas, ref?.roas ?? null);

  const signals = [
    { label: "Dépense", value: `${Math.round(cur.spend).toLocaleString("fr-FR")} MAD`, delta: pct(cur.spend, ref?.spend ?? null), good: null },
    { label: costLabel, value: cpaCur === null ? "—" : `${(cpaCur >= 100 ? Math.round(cpaCur) : Number(cpaCur.toFixed(2))).toLocaleString("fr-FR")} MAD`, delta: dCpa, good: dCpa === null ? null : dCpa < 0 },
    { label: "ROAS", value: cur.roas === null ? "—" : `${cur.roas.toFixed(2)}×`, delta: dRoas, good: dRoas === null ? null : dRoas > 0 },
    { label: "CTR", value: cur.ctr === null ? "—" : `${cur.ctr.toFixed(2)} %`, delta: dCtr, good: dCtr === null ? null : dCtr > 0 },
    { label: "CPM", value: cur.cpm === null ? "—" : `${Math.round(cur.cpm)} MAD`, delta: dCpm, good: dCpm === null ? null : dCpm < 0 },
    { label: isPurchase ? "Taux de conversion" : `Taux de ${resultsLabel}`, value: convCur === null ? "—" : `${convCur.toFixed(2)} %`, delta: dConv, good: dConv === null ? null : dConv > 0 },
  ];

  // Données insuffisantes : on ne tranche pas, et on ne le déguise pas en « stable ».
  if (cur.spend < t.minSpend || cur.days < t.minDays) {
    return {
      verdict: "WATCH",
      headline: "Trop peu de données pour trancher",
      signals,
      diagnostic: `${Math.round(cur.spend).toLocaleString("fr-FR")} MAD sur ${cur.days} jour(s) : sous le seuil d'analyse (${t.minSpend} MAD et ${t.minDays} jours), l'échantillon ne permet pas de conclure.`,
      actions: ["Laisser tourner jusqu'à un volume significatif avant d'arbitrer."],
    };
  }

  // Où se situe la dégradation ?
  const diffusionIssue = dCpm !== null && dCpm > t.cpmRisePct;
  const hookIssue = dCtr !== null && dCtr < -t.ctrDropPct;
  const postClickIssue = dConv !== null && dConv < -t.convDropPct;
  const fatigue = cur.frequency !== null && cur.frequency > t.frequencyMax;

  let verdict: AdVerdict = "MAINTAIN";
  let headline = "Performance stable";
  const actions: string[] = [];
  let diagnostic = "";

  const noConversion = isPurchase ? cur.purchases === 0 && cur.leads === 0 : cur.results === 0;
  const roasRef = brandAvg?.roas ?? null;
  const fmtCost = (v: number) => `${(v >= 100 ? Math.round(v) : Number(v.toFixed(2))).toLocaleString("fr-FR")} MAD`;

  if (noConversion) {
    verdict = "STOP";
    headline = isPurchase ? "Aucune conversion sur la période" : `Aucun résultat (${resultsLabel}) sur la période`;
    diagnostic = isPurchase
      ? `${Math.round(cur.spend).toLocaleString("fr-FR")} MAD dépensés sans un seul achat ni lead enregistré.`
      : `${Math.round(cur.spend).toLocaleString("fr-FR")} MAD dépensés sans un seul résultat de type « ${resultsLabel} » remonté par la régie.`;
    actions.push("Vérifier d'abord le suivi des conversions (pixel, événements) avant de conclure à un échec.", "Si le suivi est bon : couper la campagne et réallouer le budget.");
  } else if (cpaCur !== null && cpaBrand && cpaCur > cpaBrand * t.cpaVsBrandFactor) {
    verdict = "STOP";
    headline = isPurchase ? "Coût par achat très au-dessus de la marque" : `${costLabel} très au-dessus de la marque`;
    diagnostic = `${costLabel} de ${fmtCost(cpaCur)} contre ${fmtCost(cpaBrand)} en moyenne sur la marque (${fmtDelta(pct(cpaCur, cpaBrand))}).`;
    actions.push("Couper cette campagne et basculer le budget sur celle qui convertit le mieux.");
  } else if ((dCpa !== null && dCpa > t.cpaRisePct) || (dRoas !== null && dRoas < -t.roasDropPct)) {
    verdict = "OPTIMIZE";
    headline = dCpa !== null && dCpa > t.cpaRisePct ? `${costLabel} en hausse de ${Math.round(dCpa)} %` : `ROAS en baisse de ${Math.abs(Math.round(dRoas!))} %`;
    if (postClickIssue && !hookIssue) {
      diagnostic = `CTR ${dCtr === null ? "stable" : fmtDelta(dCtr)}, CPM ${fmtDelta(dCpm)}, taux de ${isPurchase ? "conversion" : resultsLabel} ${fmtDelta(dConv)} : le problème est principalement post-clic — les gens cliquent mais ${isPurchase ? "n'achètent pas" : "ne vont pas jusqu'au résultat"}.`;
      actions.push("Analyser la page de destination : temps de chargement, prix affiché, disponibilité produit.", "Vérifier le stock du produit poussé.", "Tester une offre ou un argument de réassurance.");
    } else if (hookIssue) {
      diagnostic = `CTR ${fmtDelta(dCtr)} avec un CPM ${fmtDelta(dCpm)} : l'accroche ne capte plus.`;
      actions.push("Produire 2 à 3 nouvelles créatives avec une accroche différente.", "Tester un nouveau format (Reel vs image).");
    } else if (diffusionIssue) {
      diagnostic = `CPM ${fmtDelta(dCpm)} à CTR ${dCtr === null ? "stable" : fmtDelta(dCtr)} : la diffusion coûte plus cher (enchères ou audience saturée).`;
      actions.push("Élargir ou changer l'audience.", "Vérifier la pression concurrentielle sur la période.");
    } else {
      diagnostic = `${costLabel} ${fmtDelta(dCpa)} sans dégradation nette du CTR ni du CPM : la dérive vient du volume de ${isPurchase ? "conversions" : resultsLabel}.`;
      actions.push("Comparer avec les autres campagnes de la marque avant d'arbitrer.");
    }
    if (fatigue) actions.push(`Fréquence à ${cur.frequency!.toFixed(1)} : renouveler les créatives pour éviter la lassitude.`);
  } else if ((dRoas !== null && dRoas > t.roasRisePct && (cur.roas ?? 0) > t.roasMin) || (roasRef !== null && (cur.roas ?? 0) > roasRef * t.roasVsBrandFactor && (cur.roas ?? 0) > t.roasMin)) {
    verdict = "SCALE";
    headline = "Performance au-dessus de la référence";
    diagnostic = `ROAS de ${cur.roas?.toFixed(2)}× ${dRoas !== null ? `(${fmtDelta(dRoas)} vs période précédente)` : ""}${roasRef ? `, moyenne marque ${roasRef.toFixed(2)}×` : ""}.`;
    actions.push(`Augmenter le budget par paliers de ${t.scaleStepPct} % tous les ${t.scaleStepDays} jours.`, "Vérifier la couverture de stock du produit avant de scaler.");
    if (fatigue) actions.push(`Fréquence à ${cur.frequency!.toFixed(1)} : préparer des créatives de relève avant l'augmentation.`);
  } else if ((cur.roas === null || cur.revenue === 0) && cpaCur !== null && (
    (dCpa !== null && dCpa < -t.cpaRisePct) || (cpaBrand !== null && cpaCur < cpaBrand / t.roasVsBrandFactor)
  )) {
    // Sans CA mesuré, le ROAS n'existe pas : c'est le coût par résultat qui ouvre le SCALE,
    // avec les mêmes seuils lus en miroir (baisse du coût = hausse du rendement).
    verdict = "SCALE";
    headline = `${costLabel} nettement sous la référence`;
    diagnostic = `${costLabel} de ${fmtCost(cpaCur)}${dCpa !== null ? ` (${fmtDelta(dCpa)} vs période précédente)` : ""}${cpaBrand !== null ? `, moyenne marque ${fmtCost(cpaBrand)}` : ""}.`;
    actions.push(`Augmenter le budget par paliers de ${t.scaleStepPct} % tous les ${t.scaleStepDays} jours.`, "Vérifier la couverture de stock du produit avant de scaler.");
    if (fatigue) actions.push(`Fréquence à ${cur.frequency!.toFixed(1)} : préparer des créatives de relève avant l'augmentation.`);
  } else {
    diagnostic = `${costLabel} ${cpaCur === null ? "—" : fmtCost(cpaCur)}${dCpa !== null ? ` (${fmtDelta(dCpa)})` : ""}, ROAS ${cur.roas === null ? "—" : cur.roas.toFixed(2) + "×"}${dRoas !== null ? ` (${fmtDelta(dRoas)})` : ""} : pas de dérive significative.`;
    actions.push("Ne rien changer cette semaine ; surveiller la fréquence et le CPA.");
  }

  return { verdict, headline, signals, diagnostic, actions };
}

export function verdictMeta(v: AdVerdict) {
  return AD_VERDICTS[v];
}

/** Moyennes de référence d'une marque sur la période (pour situer chaque campagne). */
export function brandAverages(rows: AdKpis[]) {
  const spend = rows.reduce((s, r) => s + r.spend, 0);
  const purchases = rows.reduce((s, r) => s + r.purchases, 0);
  const revenue = rows.reduce((s, r) => s + r.revenue, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const clicks = rows.reduce((s, r) => s + (r.linkClicks || r.clicks), 0);
  // Coût par résultat de référence : sur les lignes qui partagent le résultat majoritaire (en dépense).
  const byKind = new Map<string, { spend: number; results: number }>();
  for (const r of rows) {
    const k = byKind.get(r.resultKind) ?? { spend: 0, results: 0 };
    k.spend += r.spend; k.results += r.resultKind === "reach" ? r.results / 1000 : r.results;
    byKind.set(r.resultKind, k);
  }
  const main = [...byKind.entries()].sort((a, b) => b[1].spend - a[1].spend)[0]?.[1];
  return {
    cpa: purchases > 0 ? spend / purchases : null,
    roas: spend > 0 ? revenue / spend : null,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
    costPerResult: main && main.results > 0 ? main.spend / main.results : null,
  };
}
