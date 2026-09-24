import Link from "next/link";
import { redirect } from "next/navigation";
import { canDo, requireAccessContext } from "@/lib/access";
import { purchaseStats } from "@/lib/gestion/purchases";
import { fmtMoney } from "@/lib/gestion/money";
import { fmtMonth, iso, today } from "@/lib/format";
import { PageHeader, Card, BrandDot, Empty } from "@/components/ui";
import { GestionTabs } from "@/components/gestion/gestion-nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suivi des achats" };

/**
 * Suivi des achats entrés en stock (coût de revient des réceptions, nets des retours) par mois,
 * fournisseur et marque, sur 12 mois glissants. Les commandes non reçues n'y sont pas : elles
 * sont dans « Commandes » et dans les commandes en cours du stock.
 */
export default async function PurchaseStatsPage(props: { searchParams: Promise<{ year?: string }> }) {
  const a = await requireAccessContext();
  if (!(await canDo("achats", "view"))) redirect(a.home);
  const sp = await props.searchParams;
  const t = today();
  const year = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : null;
  const from = year ? `${year}-01-01` : iso(new Date(Date.UTC(t.getUTCFullYear() - 1, t.getUTCMonth() + 1, 1)));
  const to = year ? `${year}-12-31` : iso(t);
  const rows = await purchaseStats({ from, to });
  const months = [...new Set(rows.map((r) => r.month))].sort();
  const sum = (xs: typeof rows) => xs.reduce((a, r) => a + Number(r.amount), 0);
  const group = <K extends string>(key: (r: (typeof rows)[number]) => K) => {
    const m = new Map<K, typeof rows>();
    for (const r of rows) { const k = key(r); m.set(k, [...(m.get(k) ?? []), r]); }
    return [...m.entries()].map(([k, xs]) => ({ k, xs, total: sum(xs) })).sort((a, b) => b.total - a.total);
  };
  const bySupplier = group((r) => r.supplier_id);
  const byBrand = group((r) => r.brand_id ?? "—");
  const total = sum(rows);
  const cell = (v: number) => (v ? fmtMoney(v.toFixed(2), 0) : "—");

  return (
    <>
      <PageHeader eyebrow={<Link href="/gestion/achats" className="hover:underline">Achats</Link>} title="Suivi des achats"
        subtitle="Coût de revient des réceptions (HT en dirhams + frais d'approche), nets des retours. Ce qui est réellement entré en stock, pas ce qui a été commandé.">
        <GestionTabs current="/gestion/achats" />
      </PageHeader>
      <div className="mb-4 flex gap-2 text-[13px]">
        <Link href="/gestion/achats/suivi" className={`btn-sm ${!year ? "btn-primary" : "btn-secondary"}`}>12 derniers mois</Link>
        {[t.getUTCFullYear(), t.getUTCFullYear() - 1].map((y) => <Link key={y} href={`/gestion/achats/suivi?year=${y}`} className={`btn-sm ${year === y ? "btn-primary" : "btn-secondary"}`}>{y}</Link>)}
      </div>
      {rows.length === 0 ? (
        <Empty title="Aucun achat reçu sur la période" hint="Les montants apparaissent dès la première réception validée (Achats → Réceptions)." />
      ) : (
        <div className="space-y-4">
          <Card title={`Par fournisseur et par mois — total ${fmtMoney(total.toFixed(2), 0)} MAD`} pad={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px] tabular-nums">
                <thead><tr className="text-faint border-b border-line"><th className="px-3 py-2 text-left font-medium">Fournisseur</th>{months.map((m) => <th key={m} className="px-3 py-2 text-right font-medium whitespace-nowrap">{fmtMonth(`${m}-01`)}</th>)}<th className="px-3 py-2 text-right font-medium">Total</th></tr></thead>
                <tbody>
                  {bySupplier.map((g) => (
                    <tr key={g.k} className="border-b border-line last:border-0">
                      <td className="px-3 py-2"><Link href={`/gestion/fournisseurs/${g.k}`} className="hover:underline">{g.xs[0].supplier}</Link></td>
                      {months.map((m) => <td key={m} className="px-3 py-2 text-right">{cell(sum(g.xs.filter((r) => r.month === m)))}</td>)}
                      <td className="px-3 py-2 text-right font-semibold">{cell(g.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Par marque" pad={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px] tabular-nums">
                <thead><tr className="text-faint border-b border-line"><th className="px-3 py-2 text-left font-medium">Marque</th>{months.map((m) => <th key={m} className="px-3 py-2 text-right font-medium whitespace-nowrap">{fmtMonth(`${m}-01`)}</th>)}<th className="px-3 py-2 text-right font-medium">Total</th></tr></thead>
                <tbody>
                  {byBrand.map((g) => (
                    <tr key={g.k} className="border-b border-line last:border-0">
                      <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5">{g.xs[0].color && <BrandDot color={g.xs[0].color} />}{g.xs[0].brand ?? "Sans marque (matériel, frais)"}</span></td>
                      {months.map((m) => <td key={m} className="px-3 py-2 text-right">{cell(sum(g.xs.filter((r) => r.month === m)))}</td>)}
                      <td className="px-3 py-2 text-right font-semibold">{cell(g.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
