import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { audit, type AuditActor } from "@/lib/audit";
import { iso, today } from "@/lib/format";
import { getSettings, saveSettings, type GestionSettings } from "@/lib/settings";
import { pgArray } from "@/lib/sql-array";
import { SCALE, formatScaled, parseDecimal } from "./money";
import { listSeries } from "./numbering";
import { buildReadiness } from "./readiness";
import { controlGap, cutoverBlockers, type CutoverCheck } from "./receivables-shared";

/**
 * Bascule depuis Sage : liste de contrôles, changement de mode (OFF → PARALLELE → ACTIF), rapport de
 * contrôle du mois parallèle. Le mode ne passe à ACTIF que sans contrôle bloquant : à partir de la date
 * de bascule, COMANET OS émet les pièces légales des sites basculés, projette ses ventes, refuse l'import
 * Sage de ces sites et lit le stock dans le journal.
 */

export async function cutoverChecklist(g?: GestionSettings): Promise<CutoverCheck[]> {
  const gestion = g ?? (await getSettings()).gestion;
  const t = iso(today());
  const r = await buildReadiness(gestion, t);
  const year = Number((gestion.cutover.date ?? t).slice(0, 4));
  const [series, parallel, reprise, counts] = await Promise.all([
    listSeries(year),
    db.execute<{ n: number; last: string | null }>(sql`select count(*)::int as n, max(date)::text as last from sales_documents where is_simulation and status <> 'BROUILLON'`),
    db.execute<{ n: number }>(sql`select count(*)::int as n from sales_documents where source = 'SAGE_REPRISE'`),
    db.execute<{ last: string | null }>(sql`select max(count_date)::text as last from stock_counts where status = 'VALIDE'`),
  ]);
  const legal = series.filter((s) => ["BL", "FA", "AV"].includes(s.key));
  const clientsMissing = r.clients.rows.filter((c) => c.missing.length).length;
  const productsMissing = r.products.rows.filter((p) => p.missing.length).length;
  return [
    { key: "date", label: "Date de bascule fixée", ok: !!gestion.cutover.date, blocking: true, detail: gestion.cutover.date ? `Le ${gestion.cutover.date.split("-").reverse().join("/")}, sites ${gestion.cutover.sites.join(", ")}.` : "Paramètres → Gestion commerciale." },
    { key: "company", label: "Identité de la société complète", ok: r.company.missing.length === 0, blocking: true, detail: r.company.missing.length ? `Manque : ${r.company.missing.join(", ")}.` : "Mentions légales complètes." },
    { key: "files", label: "Logo et cachet téléversés", ok: r.company.hasLogo && r.company.hasCachet, blocking: true, detail: [r.company.hasLogo ? null : "logo", r.company.hasCachet ? null : "cachet"].filter(Boolean).join(" et ") ? `Manque : ${[r.company.hasLogo ? null : "logo", r.company.hasCachet ? null : "cachet"].filter(Boolean).join(" et ")}.` : "Imprimés sur les pièces." },
    { key: "stock", label: "Stock de départ dans le journal", ok: r.stock.movements > 0, blocking: true, detail: r.stock.movements ? `${r.stock.products} article(s) au journal${r.stock.lastInitial ? `, stock initial du ${r.stock.lastInitial.split("-").reverse().join("/")}` : ""}.` : "Importer le stock initial (Imports → Stock initial) ou valider l'inventaire du 31/12." },
    { key: "inventory", label: "Inventaire validé récent", ok: !!counts.rows[0]?.last, blocking: false, detail: counts.rows[0]?.last ? `Dernier inventaire validé le ${counts.rows[0].last.split("-").reverse().join("/")}.` : "Recommandé : inventaire du 31/12 comme point de départ." },
    { key: "clients", label: "Clients prêts à facturer", ok: clientsMissing === 0, blocking: false, detail: clientsMissing ? `${clientsMissing} client(s) vendu(s) sur ${r.clients.total} sans identité complète (raison sociale, ICE, adresse) : leur facture sera refusée.` : `${r.clients.total} client(s) prêts.` },
    { key: "products", label: "Articles avec référence COMANET", ok: productsMissing === 0, blocking: false, detail: productsMissing ? `${productsMissing} article(s) vendu(s) sans réf. COMANET.` : `${r.products.total} article(s) prêts.` },
    { key: "series", label: `Numérotation ${year} réglée`, ok: legal.every((s) => s.active), blocking: false, detail: legal.map((s) => `${s.key} → ${s.next}`).join(" · ") + (legal.every((s) => s.lastValue === 0) ? " (reprend à 1 : réglez le prochain numéro si Sage a déjà émis des pièces cette année)." : "") },
    { key: "parallel", label: "Période parallèle faite", ok: (parallel.rows[0]?.n ?? 0) > 0, blocking: false, detail: parallel.rows[0]?.n ? `${parallel.rows[0].n} pièce(s) de simulation, dernière le ${parallel.rows[0].last!.split("-").reverse().join("/")}.` : "Recommandé : un mois de saisie en parallèle de Sage, puis le rapport de contrôle." },
    { key: "reprise", label: "Factures ouvertes de Sage reprises", ok: (reprise.rows[0]?.n ?? 0) > 0, blocking: false, detail: reprise.rows[0]?.n ? `${reprise.rows[0].n} facture(s) reprise(s) : elles seront encaissées et relancées dans COMANET OS.` : "À faire au moment de la bascule : état Sage des factures non soldées." },
  ];
}

/** Change le mode de bascule. ACTIF exige qu'aucun contrôle bloquant ne reste. */
export async function setCutoverMode(mode: "OFF" | "PARALLELE" | "ACTIF", actor: AuditActor): Promise<void> {
  const cur = await getSettings();
  if (mode === "ACTIF") {
    const blockers = cutoverBlockers(await cutoverChecklist(cur.gestion));
    if (blockers.length) throw new Error(`Bascule impossible : ${blockers.map((b) => b.label.toLowerCase()).join(", ")}.`);
  }
  const next = { ...cur, gestion: { ...cur.gestion, cutover: { ...cur.gestion.cutover, mode } } };
  await saveSettings(next);
  await audit({ actor, action: "SETTINGS", module: "administration", entity: "settings", label: `Bascule : mode ${mode}`, before: { mode: cur.gestion.cutover.mode }, after: { mode, date: cur.gestion.cutover.date } });
}

/* ------------------------------------------------------------------ */
/* Rapport de contrôle du mois parallèle                               */
/* ------------------------------------------------------------------ */

export type ControlSiteRow = { site: string; osHt: string; sageHt: string; gap: string; rounding: boolean; osBl: number; sageBl: number; osFa: number; sageFa: number; osAv: number };
export type ControlStockRow = { productId: string; product: string; ledger: string; photo: string | null; photoDate: string | null; gap: string | null };

/**
 * Compare, pour un mois et les sites qui basculent, ce que COMANET OS a émis (pièces de simulation ou
 * réelles) à ce que Sage a facturé (ventes importées) : CA HT livré (BL − avoirs), nombre de pièces, et
 * stock de l'entrepôt au journal contre la dernière photo Sage du mois. Un écart d'un centime par pièce
 * au plus est signalé comme arrondi.
 */
export async function controlReport(month: string) {
  const g = (await getSettings()).gestion;
  const from = `${month}-01`;
  const end = new Date(`${from}T12:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
  const to = end.toISOString().slice(0, 10);
  const sites = g.cutover.sites.map((s) => s.toUpperCase());
  const [os, sage, stock] = await Promise.all([
    db.execute<{ site: string; bl_ht: string; av_ht: string; bl: number; fa: number; av: number }>(sql`
      select upper(site) as site,
        coalesce(sum(net_ht) filter (where type = 'BL'), 0)::text as bl_ht, coalesce(sum(net_ht) filter (where type = 'AVOIR'), 0)::text as av_ht,
        count(*) filter (where type = 'BL')::int as bl, count(*) filter (where type = 'FACTURE')::int as fa, count(*) filter (where type = 'AVOIR')::int as av
      from sales_documents where status not in ('BROUILLON', 'ANNULE') and source = 'COMANET_OS' and date between ${from}::date and ${to}::date
        and upper(site) = any(${pgArray(sites, "text")}) group by 1`),
    db.execute<{ site: string; ht: string; bl: number; fa: number }>(sql`
      select upper(site) as site, coalesce(sum(amount), 0)::text as ht, count(distinct lvc_ref)::int as bl, count(distinct invoice_ref)::int as fa
      from sales where source <> 'COMANET_OS' and date between ${from}::date and ${to}::date and upper(site) = any(${pgArray(sites, "text")}) group by 1`),
    db.execute<{ product_id: string; product: string; ledger: string; photo: string | null; photo_date: string | null }>(sql`
      with ledger as (
        select m.product_id, sum(m.quantity) as q from stock_movements m join warehouses w on w.key = m.warehouse_key
        where w.kind = 'INTERNE' and w.sellable and m.date <= ${to}::date group by 1
      ), photo as (
        select distinct on (product_id) product_id, quantity, date from stock_snapshots
        where date between ${from}::date and ${to}::date and (warehouse_key is null or warehouse_key = 'PRINCIPAL') order by product_id, date desc, created_at desc
      )
      select p.id as product_id, p.name as product, coalesce(l.q, 0)::text as ledger, ph.quantity::text as photo, ph.date::text as photo_date
      from products p left join ledger l on l.product_id = p.id left join photo ph on ph.product_id = p.id
      where p.kind = 'PRODUIT' and (l.q is not null or ph.quantity is not null) order by p.name`),
  ]);
  const osBy = new Map(os.rows.map((r) => [r.site, r]));
  const sageBy = new Map(sage.rows.map((r) => [r.site, r]));
  const m = (v: string) => parseDecimal(v, SCALE.money) ?? 0n;
  const siteRows: ControlSiteRow[] = sites.map((site) => {
    const o = osBy.get(site), s = sageBy.get(site);
    const osHt = formatScaled(m(o?.bl_ht ?? "0") - m(o?.av_ht ?? "0"), SCALE.money);
    const sageHt = formatScaled(m(s?.ht ?? "0"), SCALE.money);
    const cg = controlGap(osHt, sageHt, (o?.bl ?? 0) + (o?.av ?? 0));
    return { site, osHt, sageHt, gap: cg.gap, rounding: cg.rounding, osBl: o?.bl ?? 0, sageBl: s?.bl ?? 0, osFa: o?.fa ?? 0, sageFa: s?.fa ?? 0, osAv: o?.av ?? 0 };
  });
  const q = (v: string | null) => (v === null ? null : parseDecimal(v, SCALE.qty) ?? 0n);
  const stockRows: ControlStockRow[] = stock.rows.map((r) => {
    const l = q(r.ledger)!, p = q(r.photo);
    return { productId: r.product_id, product: r.product, ledger: formatScaled(l, SCALE.qty), photo: p === null ? null : formatScaled(p, SCALE.qty), photoDate: r.photo_date, gap: p === null ? null : formatScaled(l - p, SCALE.qty) };
  });
  return { month, from, to, sites: siteRows, stock: stockRows, stockGaps: stockRows.filter((r) => r.gap !== null && (parseDecimal(r.gap, SCALE.qty) ?? 0n) !== 0n).length };
}
