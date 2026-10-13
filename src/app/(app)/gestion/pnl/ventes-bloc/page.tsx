import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { listBulkSales } from "@/lib/pnl";
import { fmtDate, fmtMAD, fmtNum, fmtPct, today } from "@/lib/format";
import { PageHeader, BrandDot, Empty } from "@/components/ui";
import { PnlTabs } from "@/components/gestion/gestion-nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ancienne saisie des ventes en bloc — P&L" };

/**
 * Historique de l'ancienne saisie manuelle des ventes en bloc (`pnl_bulk_sales`), en lecture seule. Le P&L ne la lit
 * plus : le CA en bloc vient des factures − avoirs réels du client « vente en bloc » (Paramètres → Gestion).
 */
export default async function BulkSalesPage(props: { searchParams: Promise<{ year?: string }> }) {
  await requireAdmin();
  const sp = await props.searchParams;
  const curYear = today().getUTCFullYear();
  const year = Number(sp.year) >= 2020 && Number(sp.year) <= curYear + 1 ? Number(sp.year) : curYear;
  const rows = await listBulkSales(year);
  const tot = rows.reduce((a, r) => ({ ca: a.ca + r.amountHt, cost: a.cost + (r.costAmount ?? 0) }), { ca: 0, cost: 0 });

  return (
    <>
      <PageHeader
        eyebrow="P&L"
        title="Ancienne saisie des ventes en bloc"
        subtitle="Lecture seule. Le P&L ne lit plus ces lignes : le CA en bloc vient désormais des factures et avoirs réels du client « vente en bloc » (Paramètres → Gestion). Les ventes 2026 émises dans Sage y sont reprises en factures de reprise, avec leurs lignes."
      >
        <PnlTabs current="/gestion/pnl" year={year} />
      </PageHeader>

      <form method="get" className="flex items-center gap-2 mb-4 text-[13px]">
        <select name="year" defaultValue={year} className="select h-9">{[curYear - 2, curYear - 1, curYear].map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <button className="btn-secondary btn-sm h-9">Voir</button>
        {rows.length > 0 && <span className="ml-3 text-muted">{year} : CA saisi {fmtMAD(tot.ca)} · coût saisi {fmtMAD(tot.cost)} — <Link href={`/gestion/pnl/detail?year=${year}&ligne=ca_bulk`} className="underline">comparer avec les factures</Link></span>}
      </form>

      {rows.length === 0 ? (
        <Empty title={`Aucune ancienne saisie sur ${year}`} hint="Les ventes en bloc se lisent sur les factures du client « vente en bloc »." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="tbl w-full text-[13px] tabular-nums">
            <thead><tr><th className="text-left">Date</th><th className="text-left">Libellé</th><th className="text-left">Marque</th><th className="text-left">Client</th><th className="text-right">Unités</th><th className="text-right">Remise</th><th className="text-right">CA HT saisi</th><th className="text-right">Coût saisi</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.date)}</td>
                  <td className="font-medium">{r.label}</td>
                  <td><span className="inline-flex items-center gap-1.5"><BrandDot color={r.brandColor} />{r.brandName}</span></td>
                  <td className="text-muted">{r.clientName ?? "—"}</td>
                  <td className="text-right">{r.quantity !== null ? fmtNum(r.quantity) : "—"}</td>
                  <td className="text-right">{r.discountPct !== null ? fmtPct(r.discountPct) : "—"}</td>
                  <td className="text-right">{fmtMAD(r.amountHt, { suffix: false })}</td>
                  <td className="text-right">{r.costAmount !== null ? fmtMAD(r.costAmount, { suffix: false }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
