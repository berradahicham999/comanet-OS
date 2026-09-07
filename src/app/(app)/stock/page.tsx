import Link from "next/link";
import { requireAccess, hasFlag } from "@/lib/access";
import { getRefDate } from "@/lib/ref-date";
import { productStocks, stockSummary, LEVEL_LABEL, type CoverageLevel } from "@/lib/stock";
import { getSettings } from "@/lib/settings";
import { listBrands } from "@/lib/users";
import { PageHeader, Card, Badge, BrandDot, Tabs, Delta } from "@/components/ui";
import { fmtMAD, fmtNum, fmtDate, fmtDateShort, months } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stock & achats" };

const LEVEL_TONE: Record<CoverageLevel, "green" | "yellow" | "orange" | "red" | "gray"> = { green: "green", yellow: "yellow", orange: "orange", red: "red", none: "gray", unknown: "gray" };

export default async function StockPage(props: { searchParams: Promise<{ brand?: string; view?: string; sort?: string }> }) {
  await requireAccess("stock");
  const seeMargins = await hasFlag("seeMargins");
  const sp = await props.searchParams;
  const { ref, lastSale } = await getRefDate();
  const [all, settings, brands] = await Promise.all([productStocks({ brandId: sp.brand || undefined }, ref), getSettings(), listBrands()]);
  const sum = stockSummary(all);
  const view = sp.view ?? "all";
  // La vue principale ne montre que les produits dont le stock est connu : un produit sans
  // photo de stock (échantillons, référence hors fichier stock) reste accessible dans l'onglet
  // « Stock non renseigné », il n'encombre pas la lecture des couvertures.
  const known = all.filter((p) => p.stockKnown);
  let list = known;
  if (view === "order") list = all.filter((p) => p.recommendedOrder > 0);
  else if (view === "risk") list = all.filter((p) => p.level === "red" || p.level === "orange");
  else if (view === "over") list = all.filter((p) => p.coverageMonths !== null && p.coverageMonths > 6);
  else if (view === "unknown") list = all.filter((p) => !p.stockKnown);
  const sortKey = sp.sort ?? "coverage";
  list = [...list].sort((a, b) => sortKey === "value" ? b.stockValue - a.stockValue : sortKey === "sales" ? b.avgMonthly - a.avgMonthly : (a.coverageMonths ?? (a.stockKnown ? 999 : 9999)) - (b.coverageMonths ?? (b.stockKnown ? 999 : 9999)));
  const qs = (extra: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) p.set(k, v); const s = p.toString(); return `/stock${s ? "?" + s : ""}`; };
  const toOrderValue = sum.toOrder.reduce((a, p) => a + p.recommendedOrder * (p.costPrice ?? 0), 0);
  const stockDate = all.map((p) => p.stockDate).filter(Boolean).sort().pop();

  return (
    <>
      <PageHeader eyebrow="Purchase forecast" title="Stock & achats" subtitle={<>Couverture = stock ÷ ventes moyennes des {settings.avgSalesMonths} derniers mois (au {fmtDate(lastSale ?? ref)}). Stock cible = délai fournisseur + sécurité + 1 mois. Photo de stock du {fmtDate(stockDate)}.</>}
        actions={<><Link href="/imports?type=STOCK" className="btn-secondary btn-sm">Importer un stock</Link><Link href="/parametres" className="btn-ghost btn-sm">Seuils</Link></>}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
          <Link href={qs({ view: "risk" })} className={`card px-3 py-2.5 ${view === "risk" ? "ring-2 ring-accent/40" : ""}`}><div className="text-[11px] text-muted">🔴 Critique &lt; {settings.coverage.orange} mois</div><div className="text-[20px] font-semibold text-red">{sum.red}</div></Link>
          <Link href={qs({ view: "risk" })} className={`card px-3 py-2.5`}><div className="text-[11px] text-muted">🟠 Tendu {settings.coverage.orange}–{settings.coverage.yellow} mois</div><div className="text-[20px] font-semibold text-orange">{sum.orange}</div></Link>
          <div className="card px-3 py-2.5"><div className="text-[11px] text-muted">🟡 À surveiller {settings.coverage.yellow}–{settings.coverage.green}</div><div className="text-[20px] font-semibold text-yellow">{sum.yellow}</div></div>
          <div className="card px-3 py-2.5"><div className="text-[11px] text-muted">🟢 &gt; {settings.coverage.green} mois</div><div className="text-[20px] font-semibold text-green">{sum.green}</div></div>
          <Link href={qs({ view: "over" })} className={`card px-3 py-2.5 ${view === "over" ? "ring-2 ring-accent/40" : ""}`}><div className="text-[11px] text-muted">Surstock &gt; 6 mois</div><div className="text-[20px] font-semibold">{sum.overstock}</div></Link>
          <Link href={qs({ view: "order" })} className={`card px-3 py-2.5 ${view === "order" ? "ring-2 ring-accent/40" : ""}`}><div className="text-[11px] text-muted">À commander</div><div className="text-[20px] font-semibold">{sum.toOrder.length} {seeMargins && <span className="text-[12px] font-medium text-muted">≈ {fmtMAD(toOrderValue, { compact: true })}</span>}</div></Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs current={qs({ view })} tabs={[{ href: qs({ view: "all" }), label: "Tous", count: known.length }, { href: qs({ view: "order" }), label: "À commander", count: sum.toOrder.length }, { href: qs({ view: "risk" }), label: "À risque", count: sum.red + sum.orange }, { href: qs({ view: "over" }), label: "Surstock", count: sum.overstock }, { href: qs({ view: "unknown" }), label: "Stock non renseigné", count: sum.unknown }]} />
          <form action="/stock" method="get" className="flex gap-2 ml-auto">
            {view !== "all" && <input type="hidden" name="view" value={view} />}
            <select name="brand" defaultValue={sp.brand ?? ""} className="select h-8 text-[12px] w-auto"><option value="">Toutes les marques</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            <select name="sort" defaultValue={sortKey} className="select h-8 text-[12px] w-auto"><option value="coverage">Tri : couverture</option><option value="sales">Ventes moyennes</option><option value="value">Valeur stock</option></select>
            <button className="btn-secondary btn-sm" type="submit">OK</button>
          </form>
        </div>
      </PageHeader>

      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Produit</th><th className="num">Stock</th><th className="num">En cours</th><th className="num">Ventes/mois</th><th className="num">Tendance</th><th>Couverture</th><th>Rupture estimée</th><th className="num">Lead time</th><th className="num">Stock cible</th><th className="num">Commande conseillée</th>{seeMargins && <th className="num">Valeur stock</th>}</tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.productId}>
                <td><Link href={`/produits/${p.productId}`} className="flex items-center gap-2 hover:underline"><BrandDot color={p.brandColor ?? "#999"} /><span className="font-medium">{p.name}</span></Link></td>
                <td className="num">{p.stockKnown ? fmtNum(p.stock) : <span className="text-faint">n/c</span>}</td>
                <td className="num text-muted">{p.onOrder ? fmtNum(p.onOrder) : "—"}</td>
                <td className="num">{fmtNum(p.avgMonthly)}</td>
                <td className="num"><Delta value={p.trendPct} size="xs" /></td>
                <td><Badge tone={LEVEL_TONE[p.level]}>{p.coverageMonths === null ? LEVEL_LABEL[p.level] : months(p.coverageMonths)}</Badge></td>
                <td className={p.level === "red" ? "text-red font-medium" : ""}>{fmtDateShort(p.stockoutDate)}</td>
                <td className="num text-muted">{p.leadTimeDays} j</td>
                <td className="num text-muted">{p.stockKnown ? fmtNum(p.targetStock) : "—"}</td>
                <td className="num font-semibold">{p.recommendedOrder > 0 ? `${fmtNum(p.recommendedOrder)} u.` : <span className="text-faint">—</span>}</td>
                {seeMargins && <td className="num text-muted">{p.stockKnown ? fmtMAD(p.stockValue, { compact: true, suffix: false }) : "—"}</td>}
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={11} className="text-center text-muted py-8">{view === "all" && sum.unknown > 0 ? <>Aucune photo de stock importée. <Link href="/imports?type=STOCK" className="underline">Importer un fichier de stock</Link> (colonnes Marque, Nom produit, Stock).</> : "Aucun produit dans cette vue."}</td></tr>}
          </tbody>
        </table>
      </div>
      <Card className="mt-4">
        <div className="label mb-2">Lecture</div>
        <p className="text-[13px] text-ink-2">La commande conseillée ramène le stock (+ commandes en cours) au <b>stock cible</b> = ventes moyennes × (lead time + stock de sécurité + 1 mois de revue), arrondie au MOQ. Modifiez lead time, sécurité et MOQ dans la fiche produit ; les seuils de couverture dans Paramètres. Les ventes moyennes sont du sell-in ; le sell-out terrain constaté en animation s&apos;affiche dans la fiche produit.</p>
      </Card>
    </>
  );
}
