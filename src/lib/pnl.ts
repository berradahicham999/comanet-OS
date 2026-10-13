import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { pnlCharges } from "@/db/schema";
import { audit, changedFields, type AuditActor } from "@/lib/audit";
import { BULK_CLIENT_SQL, isCommercialClientSql } from "@/lib/analytics";
import { budgetConsumptionByMonth, engagedSql, SAMPLES_VALUED_UNTIL } from "@/lib/budget";
import { pgArray } from "@/lib/sql-array";
import { outputNatures } from "@/lib/gestion/refs";
import { marketingBucketOf } from "@/lib/budget-categories";
import { getSettings, saveSettings, type PnlSettings } from "@/lib/settings";
import {
  buildPnl, chargeMonths, firstOfMonth, previousMonth, RECURRENCES,
  type BulkAgg, type CategoryInput, type ChargeGroup, type ChargeInput, type MarketingAgg, type PnlStatement, type Recurrence, type SalesAgg,
} from "./pnl-shared";

/**
 * P&L de gestion — lecture des sources et écritures des saisies (charges ; l'ancienne saisie des ventes en bloc
 * reste lisible mais n'entre plus dans le calcul : le CA en bloc vient des factures et avoirs).
 * Les calculs sont dans `pnl-shared.ts` (`buildPnl()`), seule définition du compte de résultat.
 */

/* ------------------------------------------------------------------ lecture */

/**
 * Ventes de l'année agrégées mois × marque × site, avec coût d'achat et CA sans prix d'achat. Les clients non
 * commerciaux (`isCommercialClientSql()` : clients internes, client « vente en bloc ») n'en font pas partie.
 */
async function salesAgg(year: number): Promise<SalesAgg[]> {
  const r = await db.execute<{ m: number; brand_id: string | null; site: string; amount: number; cogs: number; missing: number }>(sql`
    select extract(month from s.date)::int as m,
      coalesce(b.merged_into_id, b.id) as brand_id,
      upper(trim(coalesce(s.site, ''))) as site,
      coalesce(sum(s.amount), 0)::float8 as amount,
      coalesce(sum(case when p.cost_price is not null then (coalesce(s.quantity, 0) + coalesce(s.free_quantity, 0)) * p.cost_price else 0 end), 0)::float8 as cogs,
      coalesce(sum(case when p.cost_price is null then s.amount else 0 end), 0)::float8 as missing
    from sales s
    left join products p on p.id = s.product_id
    left join brands b on b.id = p.brand_id
    where s.date >= ${`${year}-01-01`}::date and s.date < ${`${year + 1}-01-01`}::date and ${isCommercialClientSql(sql`s.client_id`)}
    group by 1, 2, 3`);
  return r.rows.map((x) => ({ month: Number(x.m), brandId: x.brand_id, site: x.site, amount: Number(x.amount), cogs: Number(x.cogs), missingCostAmount: Number(x.missing) }));
}

/**
 * Lignes des pièces de vente en bloc : FACTURES (+) et AVOIRS (−) réels du client `gestion.bulkSales`, ni brouillon,
 * ni annulés, ni en simulation. Coût = (quantité + UG) × prix d'achat de la fiche ; un avoir ne retire le coût que
 * s'il fait revenir la marchandise (motif avec retour). Le BL n'est jamais lu : seule la facture fait le CA.
 */
const BULK_LINES = (from: string, to: string) => sql`
  from sales_documents d join sales_document_lines l on l.document_id = d.id
  left join products p on p.id = l.product_id left join brands b on b.id = p.brand_id left join credit_reasons cr on cr.key = d.reason_key
  where d.client_id = ${BULK_CLIENT_SQL} and d.type in ('FACTURE', 'AVOIR') and d.status not in ('BROUILLON', 'ANNULE') and not d.is_simulation
    and d.date >= ${from}::date and d.date < ${to}::date`;
const BULK_SIGN = sql`(case when d.type = 'AVOIR' then -1 else 1 end)`;
const BULK_COSTED = sql`(l.product_id is not null and (d.type = 'FACTURE' or coalesce(cr.with_return, false)))`;

async function bulkAgg(year: number): Promise<BulkAgg[]> {
  const r = await db.execute<{ m: number; brand_id: string | null; amount: number; cogs: number; missing: number }>(sql`
    select extract(month from d.date)::int as m, coalesce(b.merged_into_id, b.id) as brand_id,
      coalesce(sum(${BULK_SIGN} * l.net_ht), 0)::float8 as amount,
      coalesce(sum(case when ${BULK_COSTED} and p.cost_price is not null then ${BULK_SIGN} * (l.quantity + l.free_quantity) * p.cost_price else 0 end), 0)::float8 as cogs,
      coalesce(sum(case when ${BULK_COSTED} and p.cost_price is null then ${BULK_SIGN} * l.net_ht else 0 end), 0)::float8 as missing
    ${BULK_LINES(`${year}-01-01`, `${year + 1}-01-01`)}
    group by 1, 2`);
  return r.rows.map((x) => ({ month: Number(x.m), brandId: x.brand_id, amount: Number(x.amount), cogs: Number(x.cogs), missingCostAmount: Number(x.missing) }));
}

async function chargeInputs(year: number): Promise<ChargeInput[]> {
  const r = await db.execute<{ id: string; category_key: string; amount: number; recurrence: string; start_month: string; end_month: string | null; brand_id: string | null }>(sql`
    select c.id, c.category_key, c.amount::float8 as amount, c.recurrence, c.start_month::text, c.end_month::text, coalesce(b.merged_into_id, b.id) as brand_id
    from pnl_charges c left join brands b on b.id = c.brand_id
    where c.start_month < ${`${year + 1}-01-01`}::date and (c.end_month is null or c.end_month >= ${`${year}-01-01`}::date or c.recurrence = 'PONCTUELLE')`);
  return r.rows.map((x) => ({ id: x.id, categoryKey: x.category_key, amount: Number(x.amount), recurrence: x.recurrence, startMonth: x.start_month, endMonth: x.end_month, brandId: x.brand_id }));
}

export async function listChargeCategories(opts: { includeInactive?: boolean } = {}): Promise<(CategoryInput & { active: boolean })[]> {
  const r = await db.execute<{ key: string; label: string; grp: ChargeGroup; sort: number; active: boolean }>(sql`
    select key, label, grp, sort, active from pnl_charge_categories ${opts.includeInactive ? sql`` : sql`where active`} order by grp, sort, label`);
  return r.rows.map((x) => ({ key: x.key, label: x.label, grp: x.grp, sort: Number(x.sort), active: x.active }));
}

async function marketingAgg(year: number): Promise<MarketingAgg[]> {
  const [rows, merged] = await Promise.all([
    budgetConsumptionByMonth(year),
    db.execute<{ id: string; target: string }>(sql`select id, merged_into_id as target from brands where merged_into_id is not null`),
  ]);
  const map = new Map(merged.rows.map((m) => [m.id, m.target]));
  return rows.map((r) => ({ month: r.month, brandId: map.get(r.brandId) ?? r.brandId, consumed: r.consumed, breakdown: r.breakdown }));
}


async function pnlBrands() {
  const r = await db.execute<{ id: string; name: string; color: string }>(sql`select id, name, color from brands where merged_into_id is null order by name`);
  return r.rows;
}

/** Dernière date de vente par nature de site : sert à dire « données à jour au … ». */
async function freshness(year: number, rules: PnlSettings) {
  const r = await db.execute<{ site: string; last: string }>(sql`
    select upper(trim(coalesce(site, ''))) as site, max(date)::text as last from sales
    where date >= ${`${year}-01-01`}::date and date < ${`${year + 1}-01-01`}::date group by 1`);
  const norm = (s: string) => s.trim().toUpperCase();
  const lastOf = (sites: string[]) => r.rows.filter((x) => sites.map(norm).includes(x.site)).map((x) => x.last).sort().at(-1) ?? null;
  return {
    direct: lastOf(rules.directSites),
    prestations: rules.prestations.map((p) => ({ label: p.label, last: lastOf([p.site]) })),
    distributor: lastOf(rules.distributorSites),
  };
}

export type PnlView = PnlStatement & {
  previous: PnlStatement;
  rules: PnlSettings;
  freshness: Awaited<ReturnType<typeof freshness>>;
  brandList: { id: string; name: string; color: string }[];
};

/**
 * Compte de résultat d'une année jusqu'au mois `lastMonth` (inclus), et la même période de l'année
 * précédente pour comparaison. `brandId` restreint à une marque.
 */
export async function pnlStatement(year: number, lastMonth: number, brandId?: string | null): Promise<PnlView> {
  const settings = await getSettings();
  const rules = settings.pnl;
  const load = async (y: number) => {
    const [sales, bulk, charges, marketing] = await Promise.all([salesAgg(y), bulkAgg(y), chargeInputs(y), marketingAgg(y)]);
    return { sales, bulk, charges, marketing };
  };
  const [cur, prev, categories, brands, fresh, natures] = await Promise.all([load(year), load(year - 1), listChargeCategories({ includeInactive: true }), pnlBrands(), freshness(year, rules), outputNatures({ includeInactive: true })]);
  const natureLabels = Object.fromEntries(natures.map((n) => [n.key, n.label.toLowerCase()]));
  const base = { rules, categories, brands, brandId: brandId ?? null, lastMonth, natureLabels };
  return {
    ...buildPnl({ ...base, year, ...cur }),
    previous: buildPnl({ ...base, year: year - 1, ...prev }),
    rules,
    freshness: fresh,
    brandList: brands,
  };
}

/* ------------------------------------------------- détail jusqu'aux pièces */

export type PnlSourceRow = {
  date: string; label: string; detail: string | null; ref: string | null; href: string | null;
  /** Montant qui entre dans la ligne du P&L (signé : un avoir est négatif). */
  amount: number;
  /** Coût d'achat associé (lignes de CA), null si sans objet. */
  cost: number | null;
};
export type PnlSources = { title: string; note: string | null; rows: PnlSourceRow[]; total: number; truncated: boolean };

const LIMIT = 500;
const brandCond = (brandId: string | null, col = sql`coalesce(b.merged_into_id, b.id)`) => (brandId ? sql`and ${col} = ${brandId}::uuid` : sql``);
const docHref = (id: string | null) => (id ? `/gestion/pieces/${id}` : null);

/**
 * Pièces et écritures qui composent une ligne du P&L (`PnlLine.drill`) sur un mois (ou l'année), pour une marque ou
 * toute la société. Mêmes filtres que le calcul : la somme des lignes rendues égale la cellule du P&L (hors troncature).
 */
export async function pnlLineSources(drill: string, year: number, month: number | null, brandId: string | null): Promise<PnlSources> {
  const from = month ? `${year}-${String(month).padStart(2, "0")}-01` : `${year}-01-01`;
  const to = month ? (month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`) : `${year + 1}-01-01`;
  const rules = (await getSettings()).pnl;
  const finish = (title: string, note: string | null, rows: PnlSourceRow[]): PnlSources =>
    ({ title, note, rows: rows.slice(0, LIMIT), total: rows.reduce((a, r) => a + r.amount, 0), truncated: rows.length > LIMIT });

  // Ventes (directes ou d'un prestataire) : regroupées par pièce COMANET OS, sinon par facture importée.
  const salesRows = async (sites: string[], rate: number | null) => {
    const r = await db.execute<{ date: string; doc_id: string | null; number: string | null; invoice_ref: string | null; client: string; amount: number; cost: number; missing: number }>(sql`
      select min(s.date)::text as date, max(d.id::text) as doc_id, max(d.number) as number, max(s.invoice_ref) as invoice_ref, max(c.name) as client,
        sum(s.amount)::float8 as amount,
        sum(case when p.cost_price is not null then (coalesce(s.quantity, 0) + coalesce(s.free_quantity, 0)) * p.cost_price else 0 end)::float8 as cost,
        sum(case when p.cost_price is null then s.amount else 0 end)::float8 as missing
      from sales s join clients c on c.id = s.client_id left join products p on p.id = s.product_id left join brands b on b.id = p.brand_id
        left join sales_document_lines dl on dl.id = s.document_line_id left join sales_documents d on d.id = dl.document_id
      where s.date >= ${from}::date and s.date < ${to}::date and upper(trim(coalesce(s.site, ''))) = any(${pgArray(sites.map((x) => x.trim().toUpperCase()), "text")})
        and ${isCommercialClientSql(sql`s.client_id`)} ${brandCond(brandId)}
      group by coalesce(d.id::text, s.invoice_ref, s.client_id::text || ':' || s.date::text)
      order by 1, 3`);
    return r.rows.map((x): PnlSourceRow => ({
      date: x.date, label: x.client, ref: x.number ?? x.invoice_ref ?? null, href: docHref(x.doc_id),
      detail: rate === null ? (x.missing ? `dont ${Math.round(x.missing).toLocaleString("fr-FR")} MAD sans prix d'achat` : x.doc_id ? "Pièce COMANET OS" : "Import") : `CA du prestataire ${Math.round(x.amount).toLocaleString("fr-FR")} MAD × ${rate} %`,
      amount: rate === null ? Number(x.amount) : (Number(x.amount) * rate) / 100, cost: rate === null ? Number(x.cost) : null,
    }));
  };

  if (drill === "ca_direct") return finish("Ventes directes COMANET", "Coût = (quantité + UG) × prix d'achat de la fiche ; une vente sans prix d'achat n'a pas de coût (signalée).", await salesRows(rules.directSites, null));
  if (drill.startsWith("presta:")) {
    const site = drill.slice(7);
    const p = rules.prestations.find((x) => x.site.trim().toUpperCase() === site);
    return finish(p ? `${p.label} (${p.ratePct} %)` : site, "Commission = taux × CA HT remisé du prestataire.", await salesRows([site], p?.ratePct ?? 0));
  }
  if (drill === "ca_bulk") {
    const r = await db.execute<{ id: string; number: string; date: string; type: string; client: string; source: string; amount: number; cost: number; missing: number }>(sql`
      select d.id, d.number, d.date::text as date, d.type, coalesce(d.client_snapshot->>'legalName', '') as client, d.source,
        coalesce(sum(${BULK_SIGN} * l.net_ht), 0)::float8 as amount,
        coalesce(sum(case when ${BULK_COSTED} and p.cost_price is not null then ${BULK_SIGN} * (l.quantity + l.free_quantity) * p.cost_price else 0 end), 0)::float8 as cost,
        coalesce(sum(case when ${BULK_COSTED} and p.cost_price is null then ${BULK_SIGN} * l.net_ht else 0 end), 0)::float8 as missing
      ${BULK_LINES(from, to)} ${brandCond(brandId)}
      group by d.id order by d.date, d.number`);
    return finish("Ventes en bloc (factures − avoirs)", "Factures et avoirs réels du client « vente en bloc » (Paramètres → Gestion) ; les pièces en simulation n'y entrent pas.", r.rows.map((x) => ({
      date: x.date, label: x.client, ref: x.number, href: docHref(x.id), amount: Number(x.amount), cost: Number(x.cost),
      detail: `${x.type === "AVOIR" ? "Avoir" : "Facture"}${x.source === "SAGE_REPRISE" ? " reprise de Sage" : ""}${x.missing ? ` · dont ${Math.round(x.missing).toLocaleString("fr-FR")} MAD sans prix d'achat` : ""}`,
    })));
  }
  if (drill.startsWith("cat:")) {
    const key = drill.slice(4);
    const r = await db.execute<{ id: string; label: string; amount: number; recurrence: string; start_month: string; end_month: string | null; brand: string | null; brand_id: string | null }>(sql`
      select c.id, c.label, c.amount::float8 as amount, c.recurrence, c.start_month::text, c.end_month::text, b.name as brand, coalesce(b.merged_into_id, b.id) as brand_id
      from pnl_charges c left join brands b on b.id = c.brand_id where c.category_key = ${key} ${brandCond(brandId)} order by c.start_month`);
    const rows: PnlSourceRow[] = [];
    for (const c of r.rows) {
      const months = chargeMonths({ recurrence: c.recurrence, startMonth: c.start_month, endMonth: c.end_month }, year).filter((m) => !month || m === month);
      if (!months.length) continue;
      rows.push({ date: c.start_month, label: c.label, detail: `${c.recurrence === "MENSUELLE" ? `${months.length} mois × ${Math.round(c.amount).toLocaleString("fr-FR")} MAD` : "Ponctuelle"}${c.brand ? ` · ${c.brand}` : ""}`, ref: null, href: `/gestion/pnl/charges?year=${year}&edit=${c.id}`, amount: months.length * c.amount, cost: null });
    }
    return finish("Charges saisies", null, rows);
  }
  if (drill.startsWith("mkt:")) {
    const bucket = drill.slice(4);
    const rows: PnlSourceRow[] = [];
    if (bucket === "ADS") {
      const ads = await db.execute<{ date: string; campaign: string; campaign_id: string | null; spend: number }>(sql`
        select min(m.date)::text as date, m.campaign_name as campaign, max(m.campaign_id::text) as campaign_id, sum(m.spend)::float8 as spend
        from ad_metrics m left join brands b on b.id = m.brand_id
        where m.date >= ${from}::date and m.date < ${to}::date and not m.is_partial and m.brand_id is not null ${brandCond(brandId)}
        group by m.campaign_name order by 1`);
      for (const a of ads.rows) rows.push({ date: a.date, label: a.campaign, detail: "Dépense régie (Meta)", ref: null, href: a.campaign_id ? `/marketing/campagnes/${a.campaign_id}` : null, amount: Number(a.spend), cost: null });
    }
    const exp = await db.execute<{ id: string; date: string; label: string; category: string; output_nature: string | null; activation_id: string | null; activation: string | null; campaign_id: string | null; collaboration_id: string | null; doc_id: string | null; number: string | null; client: string | null; amount: number }>(sql`
      select e.id, e.date::text as date, e.label, e.category::text as category, e.output_nature, e.activation_id, a.name as activation, e.campaign_id, e.collaboration_id,
        d.id as doc_id, d.number, c.name as client, e.amount::float8 as amount
      from marketing_expenses e left join brands b on b.id = e.brand_id left join activations a on a.id = e.activation_id
        left join sales_document_lines dl on dl.id = e.document_line_id left join sales_documents d on d.id = dl.document_id left join clients c on c.id = e.client_id
      where e.date >= ${from}::date and e.date < ${to}::date and ${engagedSql("e")} ${brandCond(brandId)}
      order by e.date`);
    for (const e of exp.rows) {
      if (marketingBucketOf({ category: e.category, outputNature: e.output_nature, activationId: e.activation_id }) !== bucket) continue;
      const href = e.doc_id ? docHref(e.doc_id) : e.activation_id ? `/marketing/activations/${e.activation_id}` : e.collaboration_id ? `/marketing/influence/${e.collaboration_id}` : e.campaign_id ? `/marketing/campagnes/${e.campaign_id}` : null;
      const detail = e.doc_id ? `Sortie par BL${e.client ? ` · ${e.client}` : ""}` : e.activation ? `Activation « ${e.activation} »` : null;
      rows.push({ date: e.date, label: e.label, detail: bucket === "ADS" ? `${detail ?? "Média saisi"} — compté seulement sans donnée de régie sur l'année de la marque` : detail, ref: e.number, href, amount: Number(e.amount), cost: null });
    }
    if (bucket === "ECH:MEDICAL") {
      const sm = await db.execute<{ date: string; delegate: string; product: string; qty: number; value: number }>(sql`
        select min(sm.date)::text as date, u.name as delegate, p.name as product, -sum(sm.quantity)::float8 as qty,
          -sum(sm.quantity * coalesce(p.cost_price, p.price_wholesale))::float8 as value
        from sample_movements sm join products p on p.id = sm.product_id join users u on u.id = sm.delegate_id left join brands b on b.id = p.brand_id
        where sm.type = 'SORTIE_VISITE' and sm.date >= ${from}::date and sm.date < ${to}::date and coalesce(p.cost_price, p.price_wholesale) is not null
          and sm.date < ${SAMPLES_VALUED_UNTIL}
          ${brandCond(brandId)}
        group by u.name, p.name order by 1`);
      for (const x of sm.rows) rows.push({ date: x.date, label: `${x.product} — ${x.qty} remis en visite`, detail: `Déléguée : ${x.delegate}`, ref: null, href: "/medical", amount: Number(x.value), cost: null });
    }
    const note = bucket === "ADS" ? "La régie fait foi dès qu'elle a des données sur l'année de la marque ; sinon, le média saisi à la main." : bucket.startsWith("ECH:") ? "Échantillons sortis par BL au coût de revient figé, et dépenses d'échantillons saisies." : null;
    return finish("Marketing réel", note, rows.sort((a, b) => a.date.localeCompare(b.date)));
  }
  return finish("Ligne inconnue", null, []);
}

/* ---------------------------------------------------------------- charges */

export type ChargeRow = {
  id: string; categoryKey: string; categoryLabel: string; grp: ChargeGroup; label: string; amount: number;
  recurrence: Recurrence; startMonth: string; endMonth: string | null; brandId: string | null; brandName: string | null; notes: string | null;
  /** Montant qui tombe dans l'année demandée. */
  yearAmount: number;
};

export async function listCharges(year: number): Promise<ChargeRow[]> {
  const r = await db.execute<{ id: string; category_key: string; category_label: string; grp: ChargeGroup; label: string; amount: number; recurrence: Recurrence; start_month: string; end_month: string | null; brand_id: string | null; brand_name: string | null; notes: string | null }>(sql`
    select c.id, c.category_key, k.label as category_label, k.grp, c.label, c.amount::float8 as amount, c.recurrence, c.start_month::text, c.end_month::text,
      c.brand_id, b.name as brand_name, c.notes
    from pnl_charges c join pnl_charge_categories k on k.key = c.category_key left join brands b on b.id = c.brand_id
    order by k.grp, k.sort, c.start_month desc, c.label`);
  return r.rows
    .map((x) => {
      const months = chargeMonths({ recurrence: x.recurrence, startMonth: x.start_month, endMonth: x.end_month }, year);
      return {
        id: x.id, categoryKey: x.category_key, categoryLabel: x.category_label, grp: x.grp, label: x.label, amount: Number(x.amount),
        recurrence: x.recurrence, startMonth: x.start_month, endMonth: x.end_month, brandId: x.brand_id, brandName: x.brand_name, notes: x.notes,
        yearAmount: months.length * Number(x.amount),
      };
    });
}

export async function getCharge(id: string) {
  const [c] = await db.select().from(pnlCharges).where(eq(pnlCharges.id, id));
  return c ?? null;
}

export type ChargeInputForm = {
  categoryKey: string; label: string; amount: string; recurrence: Recurrence; startMonth: string; endMonth: string | null; brandId: string | null; notes: string | null;
};

function checkCharge(i: ChargeInputForm) {
  if (!i.label.trim()) throw new Error("Le libellé est obligatoire.");
  if (!(i.recurrence in RECURRENCES)) throw new Error("Récurrence inconnue.");
  const start = firstOfMonth(i.startMonth);
  if (!start) throw new Error("Mois de début invalide (AAAA-MM).");
  const end = i.recurrence === "MENSUELLE" && i.endMonth ? firstOfMonth(i.endMonth) : null;
  if (i.recurrence === "MENSUELLE" && i.endMonth && !end) throw new Error("Mois de fin invalide (AAAA-MM).");
  if (end && end < start) throw new Error("Le mois de fin précède le mois de début.");
  if (!/^-?\d+(\.\d{1,2})?$/.test(i.amount)) throw new Error("Montant invalide (ex. 15000 ou 15000.50).");
  return {
    categoryKey: i.categoryKey, label: i.label.trim(), amount: i.amount, recurrence: i.recurrence,
    startMonth: start, endMonth: end, brandId: i.brandId, notes: i.notes,
  };
}

export async function createCharge(i: ChargeInputForm, actor: AuditActor): Promise<string> {
  const v = checkCharge(i);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(pnlCharges).values({ ...v, createdById: actor.id }).returning({ id: pnlCharges.id });
    await audit({ actor, action: "PNL_CHARGE_CREATE", module: "administration", entity: "pnl_charge", entityId: row.id, label: v.label, after: v }, tx);
    return row.id;
  });
}

export async function updateCharge(id: string, i: ChargeInputForm, actor: AuditActor) {
  const v = checkCharge(i);
  const before = await getCharge(id);
  if (!before) throw new Error("Charge introuvable.");
  await db.transaction(async (tx) => {
    await tx.update(pnlCharges).set({ ...v, updatedAt: new Date() }).where(eq(pnlCharges.id, id));
    const diff = changedFields(before as unknown as Record<string, unknown>, v as unknown as Record<string, unknown>);
    if (diff) await audit({ actor, action: "PNL_CHARGE_UPDATE", module: "administration", entity: "pnl_charge", entityId: id, label: v.label, before: diff.before, after: diff.after }, tx);
  });
}

/**
 * Révision d'une charge mensuelle à partir d'un mois (augmentation de salaire, nouveau loyer) :
 * l'ancienne ligne est close au mois précédent, une nouvelle part du mois donné. L'historique reste juste.
 */
export async function reviseCharge(id: string, fromMonth: string, amount: string, actor: AuditActor): Promise<string> {
  const c = await getCharge(id);
  if (!c) throw new Error("Charge introuvable.");
  if (c.recurrence !== "MENSUELLE") throw new Error("Seule une charge mensuelle se révise ; modifiez directement une charge ponctuelle.");
  const from = firstOfMonth(fromMonth);
  if (!from) throw new Error("Mois de révision invalide (AAAA-MM).");
  if (from <= c.startMonth) throw new Error("La révision doit partir d'un mois postérieur au début de la charge ; sinon, modifiez-la.");
  if (c.endMonth && from > c.endMonth) throw new Error("La charge est déjà close avant ce mois.");
  if (!/^-?\d+(\.\d{1,2})?$/.test(amount)) throw new Error("Montant invalide.");
  return db.transaction(async (tx) => {
    await tx.update(pnlCharges).set({ endMonth: previousMonth(from), updatedAt: new Date() }).where(eq(pnlCharges.id, id));
    const [row] = await tx.insert(pnlCharges).values({
      categoryKey: c.categoryKey, label: c.label, amount, recurrence: "MENSUELLE", startMonth: from, endMonth: c.endMonth, brandId: c.brandId, notes: c.notes, createdById: actor.id,
    }).returning({ id: pnlCharges.id });
    await audit({ actor, action: "PNL_CHARGE_REVISE", module: "administration", entity: "pnl_charge", entityId: row.id, label: c.label, before: { id, amount: c.amount }, after: { from, amount } }, tx);
    return row.id;
  });
}

/** Arrête une charge mensuelle à un mois (inclus). */
export async function stopCharge(id: string, lastMonth: string, actor: AuditActor) {
  const c = await getCharge(id);
  if (!c) throw new Error("Charge introuvable.");
  const end = firstOfMonth(lastMonth);
  if (!end || end < c.startMonth) throw new Error("Mois de fin invalide.");
  await db.transaction(async (tx) => {
    await tx.update(pnlCharges).set({ endMonth: end, updatedAt: new Date() }).where(eq(pnlCharges.id, id));
    await audit({ actor, action: "PNL_CHARGE_STOP", module: "administration", entity: "pnl_charge", entityId: id, label: c.label, before: { endMonth: c.endMonth }, after: { endMonth: end } }, tx);
  });
}

export async function deleteCharge(id: string, actor: AuditActor) {
  const c = await getCharge(id);
  if (!c) return;
  await db.transaction(async (tx) => {
    await tx.delete(pnlCharges).where(eq(pnlCharges.id, id));
    await audit({ actor, action: "PNL_CHARGE_DELETE", module: "administration", entity: "pnl_charge", entityId: id, label: c.label, before: c }, tx);
  });
}

/* ------------------------------------------------------------ ventes en bloc */

/** Ancienne saisie manuelle des ventes en bloc (`pnl_bulk_sales`) : lecture seule, hors du calcul du P&L. */
export type BulkRow = {
  id: string; date: string; brandId: string; brandName: string; brandColor: string; clientId: string | null; clientName: string | null;
  label: string; quantity: number | null; amountHt: number; costAmount: number | null; discountPct: number | null; notes: string | null;
};

export async function listBulkSales(year: number): Promise<BulkRow[]> {
  const r = await db.execute<{ id: string; date: string; brand_id: string; brand_name: string; brand_color: string; client_id: string | null; client_name: string | null; label: string; quantity: number | null; amount_ht: number; cost_amount: number | null; discount_pct: number | null; notes: string | null }>(sql`
    select bs.id, bs.date::text, bs.brand_id, b.name as brand_name, b.color as brand_color, bs.client_id, c.name as client_name, bs.label,
      bs.quantity::float8 as quantity, bs.amount_ht::float8 as amount_ht, bs.cost_amount::float8 as cost_amount, bs.discount_pct::float8 as discount_pct, bs.notes
    from pnl_bulk_sales bs join brands b on b.id = bs.brand_id left join clients c on c.id = bs.client_id
    where bs.date >= ${`${year}-01-01`}::date and bs.date < ${`${year + 1}-01-01`}::date
    order by bs.date desc`);
  return r.rows.map((x) => ({
    id: x.id, date: x.date, brandId: x.brand_id, brandName: x.brand_name, brandColor: x.brand_color, clientId: x.client_id, clientName: x.client_name, label: x.label,
    quantity: x.quantity === null ? null : Number(x.quantity), amountHt: Number(x.amount_ht), costAmount: x.cost_amount === null ? null : Number(x.cost_amount),
    discountPct: x.discount_pct === null ? null : Number(x.discount_pct), notes: x.notes,
  }));
}

/* ------------------------------------------------------------------ règles */

export async function savePnlRules(rules: PnlSettings, actor: AuditActor) {
  const s = await getSettings();
  const before = s.pnl;
  await saveSettings({ ...s, pnl: rules });
  await audit({ actor, action: "PNL_RULES_UPDATE", module: "administration", entity: "settings", entityId: null, label: "Règles du P&L", before: before, after: rules });
}
