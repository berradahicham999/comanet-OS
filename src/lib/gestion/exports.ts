import "server-only";
import { sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "@/db";
import { pgArray } from "@/lib/sql-array";
import { openInvoices } from "./payments";
import { AGING_BUCKETS, AGING_LABELS, agedBalance } from "./receivables-shared";
import { SCALE, formatScaled, parseDecimal } from "./money";

/**
 * Envoi au comptable (décision d'Hicham : « ce sont les mêmes pièces ») : les PDF des factures et avoirs
 * validés du mois, tels qu'envoyés aux clients (sans UG), par lots de ZIP, et un récapitulatif Excel
 * (journal des ventes, TVA par taux, journal des achats, règlements, balance âgée). Rien n'est recalculé :
 * chaque chiffre vient de la pièce figée.
 */

const monthRange = (month: string) => {
  const from = `${month}-01`;
  const end = new Date(`${from}T12:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
  return { from, to: end.toISOString().slice(0, 10) };
};

export type ExportPiece = { id: string; type: string; number: string; date: string; client: string; ice: string | null; netHt: string; vatTotal: string; ttc: string; vatBreakdown: { rate: string; base: string; vat: string }[] };

export async function exportPieces(month: string, simulation: boolean): Promise<ExportPiece[]> {
  const { from, to } = monthRange(month);
  return (await db.execute<ExportPiece>(sql`
    select d.id, d.type, d.number, d.date::text as date, coalesce(d.client_snapshot->>'legalName', c.name) as client, d.client_snapshot->>'ice' as ice,
      d.net_ht::text as "netHt", d.vat_total::text as "vatTotal", d.ttc::text as ttc, d.vat_breakdown as "vatBreakdown"
    from sales_documents d join clients c on c.id = d.client_id
    where d.type in ('FACTURE', 'AVOIR') and d.status <> 'BROUILLON' and d.source = 'COMANET_OS' and d.is_simulation = ${simulation}
      and d.date between ${from}::date and ${to}::date order by d.type desc, d.number`)).rows;
}

export type SelectablePiece = ExportPiece & { status: string; site: string };

/**
 * Pièces validées d'une période, pour la sélection et l'export groupé (BL, factures, avoirs) : le ZIP
 * est assemblé dans le navigateur à partir des PDF figés de chaque pièce (aucune limite de taille).
 */
export async function selectablePieces(opts: { from: string; to: string; types: string[]; simulation: boolean }): Promise<SelectablePiece[]> {
  if (!opts.types.length) return [];
  return (await db.execute<SelectablePiece>(sql`
    select d.id, d.type, d.number, d.date::text as date, coalesce(d.client_snapshot->>'legalName', c.name) as client, d.client_snapshot->>'ice' as ice,
      d.net_ht::text as "netHt", d.vat_total::text as "vatTotal", d.ttc::text as ttc, d.vat_breakdown as "vatBreakdown", d.status, d.site
    from sales_documents d join clients c on c.id = d.client_id
    where d.type = any(${pgArray(opts.types, "text")}) and d.status <> 'BROUILLON' and d.source = 'COMANET_OS' and d.is_simulation = ${opts.simulation}
      and d.date between ${opts.from}::date and ${opts.to}::date order by d.date, d.number`)).rows;
}

/** Récapitulatif du mois pour le comptable, en Excel. */
export async function recapWorkbook(month: string, simulation: boolean): Promise<Buffer> {
  const { from, to } = monthRange(month);
  const pieces = await exportPieces(month, simulation);
  const rates = [...new Set(pieces.flatMap((p) => (p.vatBreakdown ?? []).map((v) => v.rate)))].sort((a, b) => Number(b) - Number(a));
  const sign = (p: ExportPiece) => (p.type === "AVOIR" ? -1 : 1);
  const n = (v: string | null | undefined) => Math.round(Number(v ?? 0) * 100) / 100;

  const journal = pieces.map((p) => {
    const row: Record<string, string | number | null> = { "N° pièce": p.number, Type: p.type === "AVOIR" ? "Avoir" : "Facture", Date: p.date, Client: p.client, ICE: p.ice };
    for (const r of rates) {
      const v = (p.vatBreakdown ?? []).find((x) => x.rate === r);
      row[`Base HT ${Number(r)} %`] = v ? sign(p) * n(v.base) : 0;
      row[`TVA ${Number(r)} %`] = v ? sign(p) * n(v.vat) : 0;
    }
    row["Total HT"] = sign(p) * n(p.netHt);
    row["Total TVA"] = sign(p) * n(p.vatTotal);
    row["Total TTC"] = sign(p) * n(p.ttc);
    return row;
  });
  // Totaux de TVA au centime exact (entiers), puis convertis pour Excel.
  const vat = rates.map((r) => {
    let base = 0n, v = 0n;
    for (const p of pieces) {
      const x = (p.vatBreakdown ?? []).find((y) => y.rate === r);
      if (x) { const k = BigInt(sign(p)); base += k * (parseDecimal(x.base, SCALE.money) ?? 0n); v += k * (parseDecimal(x.vat, SCALE.money) ?? 0n); }
    }
    return { "Taux TVA": `${Number(r)} %`, "Base HT": Number(formatScaled(base, SCALE.money)), "TVA collectée": Number(formatScaled(v, SCALE.money)) };
  });

  const [purchases, payments] = await Promise.all([
    db.execute<Record<string, string | null>>(sql`
      select d.number as "N° interne", d.supplier_ref as "N° facture fournisseur", s.legal_name as "Fournisseur", s.ice as "ICE", d.date::text as "Date",
        d.due_date::text as "Échéance", d.currency as "Devise", d.net_ht_currency::text as "HT devise", d.exchange_rate::text as "Taux",
        d.net_ht_mad::text as "HT MAD", d.vat_mad::text as "TVA MAD", d.ttc_mad::text as "TTC MAD"
      from purchase_documents d join suppliers s on s.id = d.supplier_id
      where d.type = 'FACTURE' and d.status <> 'BROUILLON' and d.date between ${from}::date and ${to}::date order by d.number`),
    db.execute<Record<string, string | null>>(sql`
      select p.number as "N° règlement", p.date::text as "Date", c.name as "Client", pm.label as "Mode", p.reference as "Référence", p.bank as "Banque",
        p.due_date::text as "Échéance", p.amount::text as "Montant", p.status as "Statut",
        (select string_agg(f.number || ' : ' || a.amount::text, ', ') from payment_allocations a join sales_documents f on f.id = a.invoice_id where a.payment_id = p.id) as "Imputé sur"
      from payments p join clients c on c.id = p.client_id join payment_modes pm on pm.key = p.mode_key
      where p.is_simulation = ${simulation} and p.date between ${from}::date and ${to}::date order by p.number`),
  ]);
  const open = await openInvoices({ simulation });
  const aged = agedBalance(open.map((i) => ({ clientId: i.clientId, dueDate: i.dueDate, balance: i.balance })), to);
  const clientNames = new Map(open.map((i) => [i.clientId, i.client]));
  const agedRows = [...aged].map(([id, b]) => ({ Client: clientNames.get(id) ?? id, ...Object.fromEntries(AGING_BUCKETS.map((k) => [AGING_LABELS[k], n(b[k])])), Total: n(b.total) }));

  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: Record<string, unknown>[], empty: string) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Info: empty }]), name);
  add("Journal des ventes", journal, "Aucune facture ni avoir sur le mois.");
  add("TVA par taux", vat, "Aucune TVA collectée sur le mois.");
  add("Journal des achats", purchases.rows.map((r) => ({ ...r, "HT devise": n(r["HT devise"]), "HT MAD": n(r["HT MAD"]), "TVA MAD": n(r["TVA MAD"]), "TTC MAD": n(r["TTC MAD"]) })), "Aucune facture fournisseur sur le mois.");
  add("Règlements", payments.rows.map((r) => ({ ...r, Montant: n(r.Montant) })), "Aucun règlement sur le mois.");
  add("Balance âgée", agedRows, "Aucune facture ouverte.");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

