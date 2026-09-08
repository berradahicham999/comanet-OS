import Link from "next/link";
import { requireActivationAccess, activationScope } from "@/lib/activations/access";
import { activationRefs } from "@/lib/activations/refs";
import { compareActivations } from "@/lib/activations/roi";
import { getSettings } from "@/lib/settings";
import { listBrands } from "@/lib/users";
import { PageHeader, Card, BrandDot, Empty, Tabs } from "@/components/ui";
import { fmtMAD, iso, today } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Comparatif des activations" };

type SP = { dim?: string; brand?: string; type?: string; annee?: string };

/** Où mettre le budget l'année prochaine : coût complet, résultats et écart de ventes par type, marque ou ville. */
export default async function ComparatifPage(props: { searchParams: Promise<SP> }) {
  await requireActivationAccess();
  const sp = await props.searchParams;
  const [refs, settings, scope, brands] = await Promise.all([activationRefs(), getSettings(), activationScope(), listBrands()]);
  const dim = sp.dim === "brand" || sp.dim === "city" ? sp.dim : "type";
  const year = sp.annee && /^\d{4}$/.test(sp.annee) ? Number(sp.annee) : today().getUTCFullYear();
  const rows = await compareActivations(dim, { start: `${year}-01-01`, end: `${year + 1}-01-01`, brand: sp.brand, type: sp.type }, scope, settings.activations, iso(today()));
  const qs = (patch: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v); const s = p.toString(); return s ? `/marketing/activations/comparatif?${s}` : "/marketing/activations/comparatif"; };
  const totals = rows.reduce((a, r) => ({ count: a.count + r.count, cost: a.cost + r.fullCost, inc: a.inc + r.increment, measured: a.measured + r.measured }), { count: 0, cost: 0, inc: 0, measured: 0 });
  const visibleBrands = brands.filter((b) => b.active && (!scope.brandIds || scope.brandIds.includes(b.id)));

  return (
    <>
      <PageHeader eyebrow={<Link href="/marketing/activations" className="hover:underline">Activations</Link>} title="Comparatif" subtitle="Activations terminées : coût complet, résultats et écart de ventes observé, pour savoir où mettre le budget l'année prochaine." />
      <form method="get" className="card card-pad mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[13px]">
        <input type="hidden" name="dim" value={dim} />
        <select name="annee" defaultValue={String(year)} className="select h-9">{[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <select name="brand" defaultValue={sp.brand ?? ""} className="select h-9"><option value="">Toutes marques</option>{visibleBrands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <select name="type" defaultValue={sp.type ?? ""} className="select h-9"><option value="">Tous types</option>{refs.types.filter((t) => t.active).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
        <button className="btn-primary btn-sm h-9" type="submit">OK</button>
      </form>
      <div className="mb-3"><Tabs current={qs({ dim })} tabs={[{ href: qs({ dim: "type" }), label: "Par type" }, { href: qs({ dim: "brand" }), label: "Par marque" }, { href: qs({ dim: "city" }), label: "Par ville" }]} /></div>

      {rows.length === 0 ? (
        <Empty title="Aucune activation terminée sur cette période" hint="Le comparatif se remplit dès qu'une activation passe « Terminée » : ses coûts, ses résultats et l'écart de ventes observé sont alors comparés." />
      ) : (
        <Card pad={false}>
          <div className="table-wrap"><table className="w-full text-[13px]">
            <thead><tr className="text-left text-muted"><th className="px-3 py-2">{dim === "type" ? "Type" : dim === "brand" ? "Marque" : "Ville"}</th><th className="px-3 py-2 text-right">Activations</th><th className="px-3 py-2 text-right">Coût complet</th><th className="px-3 py-2 text-right">Contacts</th><th className="px-3 py-2 text-right">Coût / contact</th><th className="px-3 py-2 text-right">Pharmacies</th><th className="px-3 py-2 text-right">CA mesuré</th><th className="px-3 py-2 text-right">Écart ventes (corrélation)</th><th className="px-3 py-2 text-right">Écart / coût</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-line">
                  <td className="px-3 py-2 font-medium">{r.color ? <span className="inline-flex items-center gap-1.5"><BrandDot color={r.color} />{r.label}</span> : r.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.count}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMAD(r.fullCost)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.participants || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.costPerContact != null ? fmtMAD(r.costPerContact) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.pharmacies || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.attributedRevenue ? fmtMAD(r.attributedRevenue) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.measured ? <>{r.increment >= 0 ? "+" : "−"}{fmtMAD(Math.abs(r.increment))}<div className="text-[11px] text-muted">{r.measured}/{r.count} comparable{r.measured > 1 ? "s" : ""}</div></> : <span className="text-muted">pas encore comparable</span>}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-medium ${r.roi != null ? (r.roi >= settings.activations.roiRepeatMin ? "text-green" : r.roi > 0 ? "text-orange" : "text-red") : ""}`}>{r.roi != null ? `× ${r.roi.toFixed(2)}` : "—"}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-line font-medium"><td className="px-3 py-2">Total</td><td className="px-3 py-2 text-right tabular-nums">{totals.count}</td><td className="px-3 py-2 text-right tabular-nums">{fmtMAD(totals.cost)}</td><td colSpan={4} /><td className="px-3 py-2 text-right tabular-nums">{totals.measured ? `${totals.inc >= 0 ? "+" : "−"}${fmtMAD(Math.abs(totals.inc))}` : "—"}</td><td className="px-3 py-2 text-right tabular-nums">{totals.measured && totals.cost > 0 ? `× ${(totals.inc / totals.cost).toFixed(2)}` : "—"}</td></tr>
            </tbody>
          </table></div>
          <p className="px-3 py-2 text-[11px] text-muted">L&apos;écart de ventes est le sell-in HT observé pendant et après chaque activation, comparé au rythme d&apos;avant, sur les points de vente et produits rattachés. Corrélation observée, jamais causalité. Une activation dont la fenêtre « après » n&apos;est pas écoulée n&apos;entre pas dans l&apos;écart.</p>
        </Card>
      )}
    </>
  );
}
