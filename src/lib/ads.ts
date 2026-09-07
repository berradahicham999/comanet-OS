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
};

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
};

export function kpis(r: AdRow): AdKpis {
  const clicks = r.linkClicks || r.clicks;
  return {
    ...r,
    cpm: r.impressions > 0 ? (r.spend / r.impressions) * 1000 : null,
    ctr: r.impressions > 0 ? (clicks / r.impressions) * 100 : null,
    cpc: clicks > 0 ? r.spend / clicks : null,
    conversionRate: clicks > 0 ? (r.purchases / clicks) * 100 : null,
    cpa: r.purchases > 0 ? r.spend / r.purchases : null,
    roas: r.spend > 0 ? r.revenue / r.spend : null,
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
export function diagnose(cur: AdKpis, ref: AdKpis | null, brandAvg: { cpa: number | null; roas: number | null; ctr: number | null } | null, t: AdThresholds): Diagnosis {
  const dCpa = pct(cur.cpa, ref?.cpa ?? null);
  const dCtr = pct(cur.ctr, ref?.ctr ?? null);
  const dCpm = pct(cur.cpm, ref?.cpm ?? null);
  const dConv = pct(cur.conversionRate, ref?.conversionRate ?? null);
  const dRoas = pct(cur.roas, ref?.roas ?? null);

  const signals = [
    { label: "Dépense", value: `${Math.round(cur.spend).toLocaleString("fr-FR")} MAD`, delta: pct(cur.spend, ref?.spend ?? null), good: null },
    { label: "CPA", value: cur.cpa === null ? "—" : `${Math.round(cur.cpa).toLocaleString("fr-FR")} MAD`, delta: dCpa, good: dCpa === null ? null : dCpa < 0 },
    { label: "ROAS", value: cur.roas === null ? "—" : `${cur.roas.toFixed(2)}×`, delta: dRoas, good: dRoas === null ? null : dRoas > 0 },
    { label: "CTR", value: cur.ctr === null ? "—" : `${cur.ctr.toFixed(2)} %`, delta: dCtr, good: dCtr === null ? null : dCtr > 0 },
    { label: "CPM", value: cur.cpm === null ? "—" : `${Math.round(cur.cpm)} MAD`, delta: dCpm, good: dCpm === null ? null : dCpm < 0 },
    { label: "Taux de conversion", value: cur.conversionRate === null ? "—" : `${cur.conversionRate.toFixed(2)} %`, delta: dConv, good: dConv === null ? null : dConv > 0 },
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

  const noConversion = cur.purchases === 0 && cur.leads === 0;
  const roasRef = brandAvg?.roas ?? null;

  if (noConversion) {
    verdict = "STOP";
    headline = "Aucune conversion sur la période";
    diagnostic = `${Math.round(cur.spend).toLocaleString("fr-FR")} MAD dépensés sans un seul achat ni lead enregistré.`;
    actions.push("Vérifier d'abord le suivi des conversions (pixel, événements) avant de conclure à un échec.", "Si le suivi est bon : couper la campagne et réallouer le budget.");
  } else if (cur.cpa !== null && brandAvg?.cpa && cur.cpa > brandAvg.cpa * t.cpaVsBrandFactor) {
    verdict = "STOP";
    headline = "Coût par achat très au-dessus de la marque";
    diagnostic = `CPA de ${Math.round(cur.cpa)} MAD contre ${Math.round(brandAvg.cpa)} MAD en moyenne sur la marque (${fmtDelta(pct(cur.cpa, brandAvg.cpa))}).`;
    actions.push("Couper cette campagne et basculer le budget sur celle qui convertit le mieux.");
  } else if ((dCpa !== null && dCpa > t.cpaRisePct) || (dRoas !== null && dRoas < -t.roasDropPct)) {
    verdict = "OPTIMIZE";
    headline = dCpa !== null && dCpa > t.cpaRisePct ? `CPA en hausse de ${Math.round(dCpa)} %` : `ROAS en baisse de ${Math.abs(Math.round(dRoas!))} %`;
    if (postClickIssue && !hookIssue) {
      diagnostic = `CTR ${dCtr === null ? "stable" : fmtDelta(dCtr)}, CPM ${fmtDelta(dCpm)}, taux de conversion ${fmtDelta(dConv)} : le problème est principalement post-clic — les gens cliquent mais n'achètent pas.`;
      actions.push("Analyser la page de destination : temps de chargement, prix affiché, disponibilité produit.", "Vérifier le stock du produit poussé.", "Tester une offre ou un argument de réassurance.");
    } else if (hookIssue) {
      diagnostic = `CTR ${fmtDelta(dCtr)} avec un CPM ${fmtDelta(dCpm)} : l'accroche ne capte plus.`;
      actions.push("Produire 2 à 3 nouvelles créatives avec une accroche différente.", "Tester un nouveau format (Reel vs image).");
    } else if (diffusionIssue) {
      diagnostic = `CPM ${fmtDelta(dCpm)} à CTR ${dCtr === null ? "stable" : fmtDelta(dCtr)} : la diffusion coûte plus cher (enchères ou audience saturée).`;
      actions.push("Élargir ou changer l'audience.", "Vérifier la pression concurrentielle sur la période.");
    } else {
      diagnostic = `CPA ${fmtDelta(dCpa)} sans dégradation nette du CTR ni du CPM : la dérive vient du volume de conversions.`;
      actions.push("Comparer avec les autres campagnes de la marque avant d'arbitrer.");
    }
    if (fatigue) actions.push(`Fréquence à ${cur.frequency!.toFixed(1)} : renouveler les créatives pour éviter la lassitude.`);
  } else if ((dRoas !== null && dRoas > t.roasRisePct && (cur.roas ?? 0) > t.roasMin) || (roasRef !== null && (cur.roas ?? 0) > roasRef * t.roasVsBrandFactor && (cur.roas ?? 0) > t.roasMin)) {
    verdict = "SCALE";
    headline = "Performance au-dessus de la référence";
    diagnostic = `ROAS de ${cur.roas?.toFixed(2)}× ${dRoas !== null ? `(${fmtDelta(dRoas)} vs période précédente)` : ""}${roasRef ? `, moyenne marque ${roasRef.toFixed(2)}×` : ""}.`;
    actions.push(`Augmenter le budget par paliers de ${t.scaleStepPct} % tous les ${t.scaleStepDays} jours.`, "Vérifier la couverture de stock du produit avant de scaler.");
    if (fatigue) actions.push(`Fréquence à ${cur.frequency!.toFixed(1)} : préparer des créatives de relève avant l'augmentation.`);
  } else {
    diagnostic = `CPA ${cur.cpa === null ? "—" : Math.round(cur.cpa) + " MAD"}${dCpa !== null ? ` (${fmtDelta(dCpa)})` : ""}, ROAS ${cur.roas === null ? "—" : cur.roas.toFixed(2) + "×"}${dRoas !== null ? ` (${fmtDelta(dRoas)})` : ""} : pas de dérive significative.`;
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
  return {
    cpa: purchases > 0 ? spend / purchases : null,
    roas: spend > 0 ? revenue / spend : null,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
  };
}
