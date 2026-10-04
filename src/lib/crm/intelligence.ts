import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { addDays, iso, today } from "@/lib/format";
import { cityKey } from "@/lib/animations-shared";
import { clientIntel } from "@/lib/clients";
import { getRefDate } from "@/lib/ref-date";
import { openInvoices } from "@/lib/gestion/payments";
import { parseDecimal, formatScaled, SCALE } from "@/lib/gestion/money";
import type { ComanetSettings } from "@/lib/settings";
import { rankMissingAssortment, monthOf, type PeerProduct } from "./portfolio-shared";
import { clientObjectiveProgress, headlineObjective } from "./objectives";
import type { ObjectiveVerdict } from "./portfolio-shared";

/**
 * CRM commercial — lecture enrichie d'un client pour la visite : assortiment manquant (pairs comparables),
 * encours et échu (factures réelles, même définition du solde que les règlements), fiche pré-visite.
 * Lecture seule. Tout ce qui est déduit est présenté comme une corrélation observée, jamais comme une certitude.
 */

export type MissingAssortment = {
  peers: number;
  /** Comment les pairs ont été choisis. */
  basis: string;
  items: { productId: string; name: string; brand: string | null; buyers: number; share: number }[];
};

/**
 * Pairs : clients actifs du même type, de la même ville (à défaut, du même secteur), au chiffre d'affaires
 * 12 mois comparable (de la moitié au double), qui ont acheté sur 12 mois.
 */
export async function missingAssortment(clientId: string, settings: ComanetSettings): Promise<MissingAssortment> {
  const s = settings.crm;
  const { ref } = await getRefDate();
  const from = iso(addDays(ref, -365));
  const c = (await db.execute<{ type: string; city: string | null; sector: string | null; revenue: number }>(sql`
    select c.type::text as type, c.city, c.sector,
      coalesce((select sum(x.amount) from sales x where x.client_id = c.id and x.date >= ${from}::date), 0)::float8 as revenue
    from clients c where c.id = ${clientId}::uuid`)).rows[0];
  if (!c) return { peers: 0, basis: "client introuvable", items: [] };

  const candidates = (await db.execute<{ id: string; city: string | null; sector: string | null; revenue: number }>(sql`
    select c.id, c.city, c.sector, sum(x.amount)::float8 as revenue
    from clients c join sales x on x.client_id = c.id and x.date >= ${from}::date
    where c.active and c.id <> ${clientId}::uuid and c.type::text = ${c.type}
    group by c.id, c.city, c.sector having sum(x.amount) > 0`)).rows;
  const comparable = (r: { revenue: number }) => c.revenue <= 0 || (r.revenue >= c.revenue / 2 && r.revenue <= c.revenue * 2);
  let peers = candidates.filter((r) => c.city && cityKey(r.city) === cityKey(c.city) && comparable(r));
  let basis = `même type, même ville (${c.city ?? "—"}), CA 12 mois comparable`;
  if (peers.length < s.assortmentMinPeers && c.sector) {
    peers = candidates.filter((r) => r.sector === c.sector && comparable(r));
    basis = `même type, même secteur (${c.sector}), CA 12 mois comparable`;
  }
  if (peers.length < s.assortmentMinPeers) return { peers: peers.length, basis: `${basis} — trop peu de clients comparables (${peers.length}, minimum ${s.assortmentMinPeers})`, items: [] };

  const ids = peers.map((p) => p.id);
  const [bought, owned] = await Promise.all([
    db.execute<{ product_id: string; name: string; brand: string | null; buyers: number }>(sql`
      select p.id as product_id, p.name, b.name as brand, count(distinct x.client_id)::int as buyers
      from sales x join products p on p.id = x.product_id left join brands b on b.id = p.brand_id
      where x.date >= ${from}::date and x.client_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) and p.active
      group by p.id, p.name, b.name`),
    db.execute<{ product_id: string }>(sql`select distinct product_id from sales where client_id = ${clientId}::uuid and date >= ${from}::date and product_id is not null`),
  ]);
  const rows: PeerProduct[] = bought.rows.map((r) => ({ productId: r.product_id, name: r.name, brand: r.brand, buyers: r.buyers }));
  const items = rankMissingAssortment(rows, peers.length, new Set(owned.rows.map((r) => r.product_id)), { minPeers: s.assortmentMinPeers, minShare: s.assortmentMinShare, topN: s.assortmentTopN });
  return { peers: peers.length, basis, items };
}

export type Receivables = {
  /** Solde des factures réelles (TTC). */
  outstanding: string;
  /** Dont échu. */
  overdue: string;
  invoices: number;
  oldestDaysLate: number | null;
  lastPayment: { date: string; amount: number; mode: string } | null;
};

/** Encours et échu d'un client : factures réelles validées avec un solde (`openInvoices()`), dernier règlement. */
export async function clientReceivables(clientId: string): Promise<Receivables> {
  const [inv, pay] = await Promise.all([
    openInvoices({ clientId, simulation: false }),
    db.execute<{ date: string; amount: number; mode: string }>(sql`
      select p.date::text as date, p.amount::float8 as amount, coalesce(m.label, p.mode_key) as mode
      from payments p left join payment_modes m on m.key = p.mode_key
      where p.client_id = ${clientId}::uuid and not p.is_simulation and p.status not in ('ANNULE', 'IMPAYE')
      order by p.date desc limit 1`).catch(() => ({ rows: [] as { date: string; amount: number; mode: string }[] })),
  ]);
  const m = (v: string) => parseDecimal(v, SCALE.money) ?? 0n;
  const total = inv.reduce((a, i) => a + m(i.balance), 0n);
  const late = inv.filter((i) => i.bucket !== "NON_ECHU");
  const overdue = late.reduce((a, i) => a + m(i.balance), 0n);
  const oldest = late.reduce<number | null>((a, i) => (i.daysLate !== null && (a === null || i.daysLate > a) ? i.daysLate : a), null);
  return { outstanding: formatScaled(total, SCALE.money), overdue: formatScaled(overdue, SCALE.money), invoices: inv.length, oldestDaysLate: oldest, lastPayment: pay.rows[0] ?? null };
}

export type VisitBrief = {
  client: { id: string; name: string; city: string | null; type: string; contactName: string | null; phone: string | null };
  lastVisit: { date: string; who: string | null; result: string | null; comment: string | null; nextAction: string | null } | null;
  rhythm: { lastOrder: string | null; avgIntervalDays: number | null; daysUntilNext: number | null; revenue12: number; segment: string | null };
  usualProducts: { name: string; brand: string | null; units: number; lastDate: string }[];
  lastReading: { date: string; products: number; units: number } | null;
  objective: { target: number; realized: number; pct: number | null; verdict: ObjectiveVerdict } | null;
  /** null quand la personne ne voit ni règlements ni factures. */
  receivables: Receivables | null;
  missing: MissingAssortment;
  openTasks: { id: string; title: string; dueDate: string | null }[];
  /** Ventes connues jusqu'au (fraîcheur des imports). */
  salesUpTo: string | null;
};

/** Fiche pré-visite d'un client : tout ce qu'il faut savoir en entrant, en une page. */
export async function clientVisitBrief(clientId: string, settings: ComanetSettings): Promise<VisitBrief | null> {
  const c = (await db.execute<{ id: string; name: string; city: string | null; type: string; contact_name: string | null; phone: string | null }>(sql`
    select id, name, city, type::text as type, contact_name, phone from clients where id = ${clientId}::uuid`)).rows[0];
  if (!c) return null;
  const { ref, lastSale } = await getRefDate();
  const t = iso(today());
  const [intel, last, usual, reading, objectives, receivables, missing, tasks] = await Promise.all([
    clientIntel({ clientId, includeArchived: true }, ref),
    db.execute<{ date: string; who: string | null; result: string | null; comment: string | null; next_action: string | null }>(sql`
      select v.date::text as date, u.name as who, v.result, v.comment, v.next_action from client_visits v left join users u on u.id = v.user_id
      where v.client_id = ${clientId}::uuid and v.status = 'EFFECTUEE' order by v.date desc, v.ended_at desc nulls last limit 1`),
    db.execute<{ name: string; brand: string | null; units: number; last_date: string }>(sql`
      select p.name, b.name as brand, sum(s.quantity)::float8 as units, max(s.date)::text as last_date
      from sales s join products p on p.id = s.product_id left join brands b on b.id = p.brand_id
      where s.client_id = ${clientId}::uuid and s.date >= ${iso(addDays(ref, -365))}::date
      group by p.name, b.name order by sum(s.amount) desc limit 6`),
    db.execute<{ date: string; products: number; units: number }>(sql`
      select read_at::text as date, count(*)::int as products, sum(quantity)::int as units from client_stock_readings
      where client_id = ${clientId}::uuid and read_at = (select max(read_at) from client_stock_readings where client_id = ${clientId}::uuid)
      group by read_at`),
    clientObjectiveProgress([clientId], monthOf(t), t, settings.crm),
    clientReceivables(clientId),
    missingAssortment(clientId, settings),
    db.execute<{ id: string; title: string; due_date: string | null }>(sql`
      select id, title, due_date::text as due_date from tasks where entity_id = ${clientId}::uuid and status in ('TODO', 'IN_PROGRESS') order by due_date nulls last limit 5`),
  ]);
  const it = intel[0];
  const l = last.rows[0];
  return {
    client: { id: c.id, name: c.name, city: c.city, type: c.type, contactName: c.contact_name, phone: c.phone },
    lastVisit: l ? { date: l.date, who: l.who, result: l.result, comment: l.comment, nextAction: l.next_action } : null,
    rhythm: { lastOrder: it?.lastOrder ?? null, avgIntervalDays: it?.avgIntervalDays ?? null, daysUntilNext: it?.daysUntilNext ?? null, revenue12: it?.revenue12 ?? 0, segment: it?.segment ?? null },
    usualProducts: usual.rows.map((u) => ({ name: u.name, brand: u.brand, units: Number(u.units), lastDate: u.last_date })),
    lastReading: reading.rows[0] ?? null,
    objective: headlineObjective(objectives.get(clientId)),
    receivables,
    missing,
    openTasks: tasks.rows.map((x) => ({ id: x.id, title: x.title, dueDate: x.due_date })),
    salesUpTo: lastSale ? iso(lastSale) : null,
  };
}
