/**
 * P&L DE GESTION — définition officielle et unique (partie pure, testée sans base).
 *
 * ── Chiffre d'affaires COMANET (HT) ──────────────────────────────────────────
 *  · Ventes directes : lignes de `sales` des sites DIRECTS (`settings.pnl.directSites`).
 *  · Ventes en bloc aux distributeurs : `pnl_bulk_sales` (stock Gamarde / Ainhoa facturé à Cospharma à l'arrivage).
 *  · Commissions de prestation : taux × CA HT remisé du prestataire (site PHARMAFIRST × 35 % par défaut).
 *  · Revente distributeur (sites COS, CAS…) : HORS CA — COMANET a déjà vendu ce stock en bloc. Montrée pour info.
 *  · Site inconnu : ni compté ni deviné, signalé dans la qualité des données.
 *
 * ── Coût des ventes ─────────────────────────────────────────────────────────
 *  · Direct : (quantité + UG) × prix d'achat de l'article. Sans prix d'achat, la ligne n'a pas de coût :
 *    son CA est signalé « coût manquant », jamais estimé avec une marge par défaut.
 *  · En bloc : coût d'achat saisi sur la vente ; vide = signalé.
 *  · Prestation : aucun (le prestataire achète la marchandise).
 *
 * ── Charges ─────────────────────────────────────────────────────────────────
 *  · Marketing : `budgetConsumptionByMonth()` (définition officielle du budget consommé).
 *  · Charges saisies : PONCTUELLE = son mois ; MENSUELLE = chaque mois de début à fin (ouverte si fin vide).
 *
 * ── Soldes ──────────────────────────────────────────────────────────────────
 *   Marge brute = CA − coût des ventes
 *   Contribution après marketing = marge brute − marketing − charges commerciales
 *   Résultat d'exploitation = contribution − personnel − structure
 *   Résultat net = résultat d'exploitation − financier − impôts
 */
import type { PnlSettings } from "@/lib/settings";

export type ChargeGroup = "COMMERCIAL" | "PERSONNEL" | "STRUCTURE" | "FINANCIER" | "IMPOTS";
export const CHARGE_GROUPS: Record<ChargeGroup, string> = {
  COMMERCIAL: "Charges commerciales",
  PERSONNEL: "Charges de personnel",
  STRUCTURE: "Charges de structure",
  FINANCIER: "Charges financières",
  IMPOTS: "Impôts",
};
export const RECURRENCES = { PONCTUELLE: "Ponctuelle (un mois)", MENSUELLE: "Mensuelle récurrente" } as const;
export type Recurrence = keyof typeof RECURRENCES;

export type SiteKind = { kind: "DIRECT" } | { kind: "DISTRIBUTEUR" } | { kind: "PRESTATION"; label: string; ratePct: number } | { kind: "INCONNU" };

export const normSite = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/** Nature d'un site de vente selon les règles du P&L. */
export function classifySite(site: string | null | undefined, rules: PnlSettings): SiteKind {
  const k = normSite(site);
  const p = rules.prestations.find((x) => normSite(x.site) === k);
  if (p) return { kind: "PRESTATION", label: p.label, ratePct: p.ratePct };
  if (rules.directSites.some((x) => normSite(x) === k)) return { kind: "DIRECT" };
  if (rules.distributorSites.some((x) => normSite(x) === k)) return { kind: "DISTRIBUTEUR" };
  return { kind: "INCONNU" };
}

/** Numéro de mois (1-12) d'une date « AAAA-MM-JJ » dans l'année donnée, sinon null. */
export function monthOf(isoDate: string, year: number): number | null {
  const y = Number(isoDate.slice(0, 4)), m = Number(isoDate.slice(5, 7));
  return y === year && m >= 1 && m <= 12 ? m : null;
}

/** Mois (1-12) de l'année où une charge s'applique. */
export function chargeMonths(c: { recurrence: string; startMonth: string; endMonth: string | null }, year: number): number[] {
  const sy = Number(c.startMonth.slice(0, 4)), sm = Number(c.startMonth.slice(5, 7));
  if (c.recurrence !== "MENSUELLE") return sy === year ? [sm] : [];
  const start = sy * 12 + sm;
  const end = c.endMonth ? Number(c.endMonth.slice(0, 4)) * 12 + Number(c.endMonth.slice(5, 7)) : Infinity;
  const out: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const k = year * 12 + m;
    if (k >= start && k <= end) out.push(m);
  }
  return out;
}

/* ------------------------------------------------------------------ entrées */

export type SalesAgg = { month: number; brandId: string | null; site: string; amount: number; cogs: number; missingCostAmount: number };
export type BulkAgg = { month: number; brandId: string; amount: number; cost: number | null };
export type ChargeInput = { id: string; categoryKey: string; amount: number; recurrence: string; startMonth: string; endMonth: string | null; brandId: string | null };
export type CategoryInput = { key: string; label: string; grp: ChargeGroup; sort: number };
export type MarketingAgg = { month: number; brandId: string; consumed: number };
export type BrandInput = { id: string; name: string; color: string };

export type PnlInput = {
  year: number;
  /** Dernier mois affiché (1-12) : mois en cours pour l'année en cours, 12 pour une année close. */
  lastMonth: number;
  rules: PnlSettings;
  sales: SalesAgg[];
  bulk: BulkAgg[];
  charges: ChargeInput[];
  categories: CategoryInput[];
  marketing: MarketingAgg[];
  brands: BrandInput[];
  /** Filtre marque : ne garde que le CA, le coût, le marketing et les charges affectées à la marque. */
  brandId?: string | null;
};

/* ------------------------------------------------------------------ sorties */

export type LineKind = "revenue" | "cost" | "subtotal" | "total" | "info";
export type PnlLine = {
  key: string;
  label: string;
  kind: LineKind;
  /** 0 = famille / solde, 1 = détail repliable. */
  depth: 0 | 1;
  parent?: string;
  /** Valeurs mensuelles, index 0 = janvier ; seuls les `lastMonth` premiers mois sont remplis. */
  months: number[];
  total: number;
  /** Ligne en pourcentage du CA (taux de marge) : `months` et `total` sont déjà des %. */
  pct?: boolean;
};

export type BrandContribution = {
  brandId: string; name: string; color: string;
  revenue: number; direct: number; bulk: number; commission: number;
  cogs: number; grossMargin: number; marketing: number; charges: number; contribution: number;
  missingCostAmount: number;
};

export type PnlQuality = {
  missingCost: { brandId: string | null; amount: number }[];
  bulkWithoutCost: number;
  unknownSites: { site: string; amount: number }[];
  monthsWithoutCharges: number[];
  distributorResale: number;
};

export type PnlStatement = {
  year: number;
  lastMonth: number;
  lines: PnlLine[];
  brands: BrandContribution[];
  quality: PnlQuality;
  kpis: {
    revenue: number; grossMargin: number; grossMarginPct: number | null; marketing: number;
    operatingResult: number; netResult: number; netMarginPct: number | null;
    /** Charges fixes du dernier mois (personnel + structure + financier récurrents). */
    monthlyFixed: number;
    /** Taux de contribution (contribution ÷ CA) sur la période. */
    contributionPct: number | null;
    /** CA mensuel qui couvre les charges fixes au taux de contribution observé ; null si non calculable. */
    breakEvenMonthly: number | null;
  };
};

const zeros = () => Array.from({ length: 12 }, () => 0);
const add = (a: number[], b: number[]) => a.map((v, i) => v + b[i]);
const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);

/** Construit le compte de résultat. Aucun accès base : tout vient de `PnlInput`. */
export function buildPnl(input: PnlInput): PnlStatement {
  const { year, lastMonth, rules, brandId } = input;
  const keep = (b: string | null) => !brandId || b === brandId;
  const idx = (m: number) => (m >= 1 && m <= lastMonth ? m - 1 : -1);

  const direct = zeros(), directCogs = zeros(), resale = zeros();
  const bulk = zeros(), bulkCogs = zeros();
  const commissions = new Map<string, number[]>();
  const unknown = new Map<string, number>();
  const missing = new Map<string | null, number>();
  const brandAcc = new Map<string, BrandContribution>();
  const brandMeta = new Map(input.brands.map((b) => [b.id, b]));
  const acc = (id: string | null) => {
    const key = id ?? "__none__";
    let r = brandAcc.get(key);
    if (!r) {
      const b = id ? brandMeta.get(id) : undefined;
      r = { brandId: key, name: b?.name ?? "Sans marque", color: b?.color ?? "#9ca3af", revenue: 0, direct: 0, bulk: 0, commission: 0, cogs: 0, grossMargin: 0, marketing: 0, charges: 0, contribution: 0, missingCostAmount: 0 };
      brandAcc.set(key, r);
    }
    return r;
  };

  for (const s of input.sales) {
    const i = idx(s.month);
    if (i < 0 || !keep(s.brandId)) continue;
    const k = classifySite(s.site, rules);
    if (k.kind === "DIRECT") {
      direct[i] += s.amount; directCogs[i] += s.cogs;
      const a = acc(s.brandId); a.direct += s.amount; a.cogs += s.cogs; a.missingCostAmount += s.missingCostAmount;
      if (s.missingCostAmount) missing.set(s.brandId, (missing.get(s.brandId) ?? 0) + s.missingCostAmount);
    } else if (k.kind === "PRESTATION") {
      const c = (s.amount * k.ratePct) / 100;
      const arr = commissions.get(k.label) ?? zeros();
      arr[i] += c; commissions.set(k.label, arr);
      acc(s.brandId).commission += c;
    } else if (k.kind === "DISTRIBUTEUR") {
      resale[i] += s.amount;
    } else if (s.amount) {
      const site = normSite(s.site) || "(site vide)";
      unknown.set(site, (unknown.get(site) ?? 0) + s.amount);
    }
  }

  let bulkWithoutCost = 0;
  for (const b of input.bulk) {
    const i = idx(b.month);
    if (i < 0 || !keep(b.brandId)) continue;
    bulk[i] += b.amount;
    const a = acc(b.brandId); a.bulk += b.amount;
    if (b.cost === null) bulkWithoutCost += b.amount;
    else { bulkCogs[i] += b.cost; a.cogs += b.cost; }
  }

  const marketing = zeros();
  for (const m of input.marketing) {
    const i = idx(m.month);
    if (i < 0 || !keep(m.brandId)) continue;
    marketing[i] += m.consumed;
    acc(m.brandId).marketing += m.consumed;
  }

  const cats = [...input.categories].sort((a, b) => a.sort - b.sort);
  const catOf = new Map(cats.map((c) => [c.key, c]));
  const byCat = new Map<string, number[]>();
  const monthHasCharge = new Set<number>();
  for (const c of input.charges) {
    // Filtre marque : seules les charges affectées à la marque (les frais communs ne se répartissent pas d'office).
    if (!keep(c.brandId)) continue;
    const cat = catOf.get(c.categoryKey);
    if (!cat) continue;
    const arr = byCat.get(c.categoryKey) ?? zeros();
    for (const m of chargeMonths(c, year)) {
      const i = idx(m);
      if (i < 0) continue;
      arr[i] += c.amount;
      monthHasCharge.add(m);
      if (c.brandId) acc(c.brandId).charges += c.amount;
    }
    byCat.set(c.categoryKey, arr);
  }

  const lines: PnlLine[] = [];
  const push = (l: Omit<PnlLine, "total"> & { total?: number }) => {
    const total = l.total ?? l.months.reduce((a, v) => a + v, 0);
    lines.push({ ...l, total });
    return l.months;
  };

  // Chiffre d'affaires
  const commissionTotal = [...commissions.values()].reduce(add, zeros());
  const revenue = add(add(direct, bulk), commissionTotal);
  push({ key: "ca", label: "Chiffre d'affaires HT", kind: "revenue", depth: 0, months: revenue });
  push({ key: "ca_direct", label: "Ventes directes COMANET", kind: "revenue", depth: 1, parent: "ca", months: direct });
  push({ key: "ca_bulk", label: "Ventes en bloc aux distributeurs", kind: "revenue", depth: 1, parent: "ca", months: bulk });
  for (const p of rules.prestations) {
    const arr = commissions.get(p.label);
    if (arr) push({ key: `ca_presta_${normSite(p.site)}`, label: `${p.label} (${p.ratePct} %)`, kind: "revenue", depth: 1, parent: "ca", months: arr });
  }

  // Coût des ventes et marge brute
  const cogs = add(directCogs, bulkCogs);
  push({ key: "cogs", label: "Coût d'achat des marchandises vendues", kind: "cost", depth: 0, months: cogs });
  push({ key: "cogs_direct", label: "Sur ventes directes", kind: "cost", depth: 1, parent: "cogs", months: directCogs });
  push({ key: "cogs_bulk", label: "Sur ventes en bloc", kind: "cost", depth: 1, parent: "cogs", months: bulkCogs });
  const gross = sub(revenue, cogs);
  push({ key: "marge_brute", label: "Marge brute", kind: "subtotal", depth: 0, months: gross });
  const rate = (num: number[], den: number[]) => num.map((v, i) => (den[i] ? (v / den[i]) * 100 : 0));
  const sum = (a: number[]) => a.reduce((x, v) => x + v, 0);
  const pctTotal = (num: number[], den: number[]) => (sum(den) ? (sum(num) / sum(den)) * 100 : 0);
  push({ key: "taux_marge", label: "Taux de marge brute", kind: "info", depth: 1, parent: "marge_brute", months: rate(gross, revenue), total: pctTotal(gross, revenue), pct: true });

  // Familles de charges
  const groupTotal = (g: ChargeGroup) => cats.filter((c) => c.grp === g).map((c) => byCat.get(c.key) ?? zeros()).reduce(add, zeros());
  const pushGroup = (g: ChargeGroup) => {
    const tot = push({ key: `grp_${g}`, label: CHARGE_GROUPS[g], kind: "cost", depth: 0, months: groupTotal(g) });
    for (const c of cats.filter((x) => x.grp === g)) {
      const arr = byCat.get(c.key);
      if (arr && arr.some((v) => v !== 0)) push({ key: `cat_${c.key}`, label: c.label, kind: "cost", depth: 1, parent: `grp_${g}`, months: arr });
    }
    return tot;
  };

  push({ key: "marketing", label: "Marketing (engagé + publicité + échantillons)", kind: "cost", depth: 0, months: marketing });
  const commercial = pushGroup("COMMERCIAL");
  const contribution = sub(sub(gross, marketing), commercial);
  push({ key: "contribution", label: "Contribution après marketing", kind: "subtotal", depth: 0, months: contribution });
  const personnel = pushGroup("PERSONNEL");
  const structure = pushGroup("STRUCTURE");
  const operating = sub(sub(contribution, personnel), structure);
  push({ key: "resultat_exploitation", label: "Résultat d'exploitation (EBE)", kind: "subtotal", depth: 0, months: operating });
  const financial = pushGroup("FINANCIER");
  const taxes = pushGroup("IMPOTS");
  const net = sub(sub(operating, financial), taxes);
  push({ key: "resultat_net", label: "Résultat net", kind: "total", depth: 0, months: net });
  push({ key: "marge_nette", label: "Marge nette", kind: "info", depth: 1, parent: "resultat_net", months: rate(net, revenue), total: pctTotal(net, revenue), pct: true });
  push({ key: "revente_distributeur", label: "Pour info — revente des distributeurs (hors CA COMANET)", kind: "info", depth: 0, months: resale });

  // Contribution par marque
  const brandRows = [...brandAcc.values()].map((b) => {
    const revenueB = b.direct + b.bulk + b.commission;
    const grossB = revenueB - b.cogs;
    return { ...b, revenue: revenueB, grossMargin: grossB, contribution: grossB - b.marketing - b.charges };
  }).filter((b) => b.revenue || b.marketing || b.charges || b.cogs).sort((a, b) => b.revenue - a.revenue);

  // Point mort : charges fixes récurrentes du dernier mois affiché, au taux de contribution observé.
  const fixedGroups = new Set<ChargeGroup>(["PERSONNEL", "STRUCTURE", "FINANCIER"]);
  const monthlyFixed = input.charges
    .filter((c) => c.recurrence === "MENSUELLE" && keep(c.brandId) && fixedGroups.has(catOf.get(c.categoryKey)?.grp as ChargeGroup) && chargeMonths(c, year).includes(lastMonth))
    .reduce((a, c) => a + c.amount, 0);
  const revT = sum(revenue);
  const contributionPct = revT ? (sum(contribution) / revT) * 100 : null;
  const breakEvenMonthly = contributionPct && contributionPct > 0 && monthlyFixed > 0 ? monthlyFixed / (contributionPct / 100) : null;

  const monthsWithoutCharges: number[] = [];
  for (let m = 1; m <= lastMonth; m++) if (!monthHasCharge.has(m)) monthsWithoutCharges.push(m);

  return {
    year, lastMonth, lines, brands: brandRows,
    quality: {
      missingCost: [...missing.entries()].map(([b, amount]) => ({ brandId: b, amount })).sort((a, b) => b.amount - a.amount),
      bulkWithoutCost,
      unknownSites: [...unknown.entries()].map(([site, amount]) => ({ site, amount })).sort((a, b) => b.amount - a.amount),
      monthsWithoutCharges,
      distributorResale: sum(resale),
    },
    kpis: {
      revenue: revT, grossMargin: sum(gross), grossMarginPct: revT ? (sum(gross) / revT) * 100 : null,
      marketing: sum(marketing), operatingResult: sum(operating), netResult: sum(net), netMarginPct: revT ? (sum(net) / revT) * 100 : null,
      monthlyFixed, contributionPct, breakEvenMonthly,
    },
  };
}

/** Mois de début (1er du mois) à partir d'une saisie « AAAA-MM » ou « AAAA-MM-JJ ». */
export function firstOfMonth(v: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(v ?? "");
  if (!m) return null;
  const mm = Number(m[2]);
  return mm >= 1 && mm <= 12 ? `${m[1]}-${m[2]}-01` : null;
}

/** Mois précédent (1er du mois) : sert à clore une charge récurrente avant sa révision. */
export function previousMonth(first: string): string {
  let y = Number(first.slice(0, 4)), m = Number(first.slice(5, 7)) - 1;
  if (m === 0) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

export const MONTHS_SHORT = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
