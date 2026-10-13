import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { pnlLineSources } from "@/lib/pnl";
import { MONTHS_SHORT } from "@/lib/pnl-shared";
import { fmtDate, fmtMAD, today } from "@/lib/format";
import { PageHeader, Card } from "@/components/ui";
import { PnlTabs } from "@/components/gestion/gestion-nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "P&L — détail" };

/** Pièces et écritures qui composent une cellule du P&L : la somme des lignes est la cellule (hors troncature). */
export default async function PnlDetailPage(props: { searchParams: Promise<{ year?: string; mois?: string; brand?: string; ligne?: string }> }) {
  await requireAdmin();
  const sp = await props.searchParams;
  const curYear = today().getUTCFullYear();
  const year = Number(sp.year) >= 2020 && Number(sp.year) <= curYear + 1 ? Number(sp.year) : curYear;
  const month = Number(sp.mois) >= 1 && Number(sp.mois) <= 12 ? Number(sp.mois) : null;
  const brandId = sp.brand && /^[0-9a-f-]{36}$/i.test(sp.brand) ? sp.brand : null;
  const drill = (sp.ligne ?? "").slice(0, 80);
  const s = await pnlLineSources(drill, year, month, brandId);
  const withCost = s.rows.some((r) => r.cost !== null);
  const period = month ? `${MONTHS_SHORT[month - 1]} ${year}` : `${year}`;
  const back = `/gestion/pnl?year=${year}${brandId ? `&brand=${brandId}` : ""}`;

  return (
    <>
      <PageHeader
        eyebrow={<Link href={back} className="hover:underline">P&L {year}</Link>}
        title={`${s.title} — ${period}`}
        subtitle={`${s.rows.length} ligne${s.rows.length > 1 ? "s" : ""}${s.truncated ? " (les 500 premières)" : ""} · total ${fmtMAD(s.total)}${brandId ? " · une marque" : ""}`}
      >
        <PnlTabs current="/gestion/pnl" year={year} />
      </PageHeader>
      {s.note && <p className="mb-3 text-[12.5px] text-muted">{s.note}</p>}
      <Card pad={false}>
        <div className="overflow-x-auto">
          <table className="tbl w-full text-[13px] tabular-nums">
            <thead><tr><th className="text-left">Date</th><th className="text-left">Pièce</th><th className="text-left">Libellé</th><th className="text-left">Détail</th><th className="text-right">Montant</th>{withCost && <th className="text-right">Coût d’achat</th>}</tr></thead>
            <tbody>
              {s.rows.map((r, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
                  <td className="font-mono text-[12px]">{r.href ? <Link href={r.href} className="hover:underline">{r.ref ?? "ouvrir"}</Link> : r.ref ?? "—"}</td>
                  <td>{r.label}</td>
                  <td className="text-muted text-[12px]">{r.detail ?? ""}</td>
                  <td className={`text-right ${r.amount < 0 ? "text-red" : ""}`}>{fmtMAD(r.amount, { suffix: false })}</td>
                  {withCost && <td className="text-right text-muted">{r.cost === null ? "—" : fmtMAD(r.cost, { suffix: false })}</td>}
                </tr>
              ))}
              {s.rows.length === 0 && <tr><td colSpan={withCost ? 6 : 5} className="text-muted py-4">Aucune pièce pour cette ligne sur la période.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
