import Link from "next/link";
import { requireAccess, hasFlag } from "@/lib/access";
import { requireAccessContext, can } from "@/lib/permissions";
import { getRefDate } from "@/lib/ref-date";
import { productStocks, LEVEL_LABEL, type CoverageLevel, type ProductStock } from "@/lib/stock";
import { getSettings } from "@/lib/settings";
import { listBrands } from "@/lib/users";
import { suppliersByBrand, type BrandSupplier } from "@/lib/forecast";
import { orderPrefillHref } from "@/lib/forecast-shared";
import { PageHeader, Card, Badge, BrandDot, Tabs } from "@/components/ui";
import { fmtMAD, fmtNum, fmtDate, fmtDateShort, fmtMonth, months } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Prévision saisonnière" };

const LEVEL_TONE: Record<CoverageLevel, "green" | "yellow" | "orange" | "red" | "gray"> = { green: "green", yellow: "yellow", orange: "orange", red: "red", none: "gray", unknown: "gray" };
const nf2 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

/** Facteur effectif d'un événement sur un mois : 1 + (coefficient − 1) × part du mois couverte. */
const factor = (e: { multiplier: number; share: number }) => 1 + (e.multiplier - 1) * e.share;

export default async function PrevisionPage(props: { searchParams: Promise<{ brand?: string; view?: string }> }) {
  await requireAccess("stock");
  const a = await requireAccessContext();
  const canOrder = !a.preview && can(a.perms, "achats", "create");
  const seeMargins = await hasFlag("seeMargins");
  const sp = await props.searchParams;
  const { ref, lastSale } = await getRefDate();
  const [all, settings, brands, bySupplier] = await Promise.all([productStocks({ brandId: sp.brand || undefined }, ref), getSettings(), listBrands(), suppliersByBrand()]);
  const fc = settings.forecast;
  const view = sp.view ?? "order";
  const known = all.filter((p) => p.stockKnown || p.forecast.baseline > 0);
  const list = (view === "order" ? all.filter((p) => p.recommendedOrder > 0) : known).sort((a, b) => (a.brandName ?? "").localeCompare(b.brandName ?? "") || a.name.localeCompare(b.name));
  const horizon = fc.horizonMonths;
  const monthKeys = (list[0] ?? all[0])?.forecast.months.slice(0, horizon).map((m) => m.month) ?? [];
  const qs = (extra: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) p.set(k, v); const s = p.toString(); return `/stock/prevision${s ? "?" + s : ""}`; };

  // Événements qui touchent chaque mois de l'horizon, tous produits confondus (légende).
  const legend = monthKeys.map((mk) => {
    const seen = new Map<string, { label: string; multiplier: number; share: number }>();
    for (const p of all) { const m = p.forecast.months.find((x) => x.month === mk); for (const e of m?.events ?? []) if (!seen.has(e.key)) seen.set(e.key, e); }
    return { month: mk, events: [...seen.values()] };
  });

  // Regroupement par fournisseur (via la marque) pour le bouton « Commander chez … ».
  type Group = { supplier: BrandSupplier | null; rows: ProductStock[] };
  const groups = new Map<string, Group>();
  for (const p of list) {
    const s = p.brandId ? bySupplier.get(p.brandId) ?? null : null;
    const k = s?.id ?? "__none__";
    if (!groups.has(k)) groups.set(k, { supplier: s, rows: [] });
    groups.get(k)!.rows.push(p);
  }
  const ordered = [...groups.values()].sort((x, y) => (x.supplier ? 0 : 1) - (y.supplier ? 0 : 1) || (x.supplier?.name ?? "").localeCompare(y.supplier?.name ?? ""));
  const toOrder = all.filter((p) => p.recommendedOrder > 0);
  const toOrderValue = toOrder.reduce((s, p) => s + p.recommendedOrder * (p.costPrice ?? 0), 0);
  const orderHref = (s: BrandSupplier, rows: ProductStock[]) => orderPrefillHref(s.id, rows.filter((p) => p.recommendedOrder > 0).map((p) => ({ productId: p.productId, qty: p.recommendedOrder })));

  return (
    <>
      <PageHeader eyebrow={<Link href="/stock" className="hover:underline">Stock & achats</Link>} title="Prévision saisonnière par référence"
        subtitle={<>Prévision mensuelle <b>modélisée</b> : base désaisonnalisée des {fc.baseMonths} derniers mois complets (ventes au {fmtDate(lastSale ?? ref)}) × indice saisonnier des événements paramétrés ({fc.events.map((e) => e.label).join(", ") || "aucun"}). Elle alimente le stock cible (délai + sécurité + 1 mois) et la commande conseillée. Ce n&apos;est pas une mesure : aucune tendance n&apos;est extrapolée.</>}
        actions={<><Link href="/stock" className="btn-secondary btn-sm">Couvertures</Link><Link href="/parametres?tab=regles#prevision" className="btn-ghost btn-sm">Événements & coefficients</Link></>}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <div className="card px-3 py-2.5"><div className="text-[11px] text-muted">Références à commander</div><div className="text-[20px] font-semibold">{toOrder.length}</div></div>
          <div className="card px-3 py-2.5"><div className="text-[11px] text-muted">Unités conseillées</div><div className="text-[20px] font-semibold">{fmtNum(toOrder.reduce((s, p) => s + p.recommendedOrder, 0))}</div></div>
          {seeMargins && <div className="card px-3 py-2.5"><div className="text-[11px] text-muted">Valeur au prix d&apos;achat</div><div className="text-[20px] font-semibold">{fmtMAD(toOrderValue, { compact: true })}</div></div>}
          <div className="card px-3 py-2.5"><div className="text-[11px] text-muted">Fournisseurs concernés</div><div className="text-[20px] font-semibold">{new Set(toOrder.map((p) => (p.brandId ? bySupplier.get(p.brandId)?.id : null)).filter(Boolean)).size}</div></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs current={qs({ view })} tabs={[{ href: qs({ view: "order" }), label: "À commander", count: toOrder.length }, { href: qs({ view: "all" }), label: "Toutes les références", count: known.length }]} />
          <form action="/stock/prevision" method="get" className="flex gap-2 ml-auto">
            <input type="hidden" name="view" value={view} />
            <select name="brand" defaultValue={sp.brand ?? ""} className="select h-8 text-[12px] w-auto"><option value="">Toutes les marques</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            <button className="btn-secondary btn-sm" type="submit">OK</button>
          </form>
        </div>
      </PageHeader>

      {legend.some((l) => l.events.length) && (
        <Card className="mb-4">
          <div className="label mb-2">Événements sur l&apos;horizon</div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
            {legend.map((l) => (
              <div key={l.month}><span className="font-medium">{fmtMonth(`${l.month}-01`)}</span>{l.events.length ? <> : {l.events.map((e, i) => <span key={e.label}>{i > 0 && ", "}{e.label} ×{nf2.format(e.multiplier)}{e.share < 0.999 && <span className="text-faint"> ({Math.round(e.share * 100)} % du mois)</span>}</span>)}</> : <span className="text-faint"> : aucun</span>}</div>
            ))}
          </div>
        </Card>
      )}

      {ordered.map((g) => {
        const toOrderRows = g.rows.filter((p) => p.recommendedOrder > 0);
        return (
          <div key={g.supplier?.id ?? "none"} className="mb-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="text-[14px] font-semibold">{g.supplier ? <>{g.supplier.name} <span className="text-faint font-normal">({g.supplier.currency})</span></> : <>Sans fournisseur rattaché <Link href="/gestion/fournisseurs" className="text-[12px] font-normal text-accent hover:underline">rattacher une marque à un fournisseur</Link></>}<span className="text-muted font-normal text-[12px]"> · {g.rows.length} référence{g.rows.length > 1 ? "s" : ""}</span></div>
              {g.supplier && toOrderRows.length > 0 && canOrder && (
                <Link href={orderHref(g.supplier, toOrderRows)} className="btn-primary btn-sm">Commander chez {g.supplier.name} ({toOrderRows.length} réf., {fmtNum(toOrderRows.reduce((s, p) => s + p.recommendedOrder, 0))} u.)</Link>
              )}
            </div>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Produit</th><th className="num">Stock</th><th className="num">En cours</th><th>Couverture</th><th className="num" title="Moyenne désaisonnalisée des mois de base">Base/mois</th>{monthKeys.map((mk) => <th key={mk} className="num">{fmtMonth(`${mk}-01`)}<div className="text-[10px] font-normal text-faint">modélisée</div></th>)}<th className="num">Stock cible</th><th className="num">Commande conseillée</th>{canOrder && <th></th>}</tr></thead>
                <tbody>
                  {g.rows.map((p) => {
                    const f = p.forecast;
                    return (
                      <tr key={p.productId}>
                        <td className="min-w-[280px]"><Link href={`/produits/${p.productId}`} className="flex items-center gap-2 hover:underline"><BrandDot color={p.brandColor ?? "#999"} /><span className="font-medium">{p.name}</span></Link><div className="text-[11px] text-faint">{f.fallbackToAverage ? `base = vente moyenne glissante (${fmtNum(p.avgMonthly)} u./mois, aucun mois complet)` : `base sur ${f.base.length} mois (${f.base[0]?.month ? fmtMonth(`${f.base[0].month}-01`) : ""} → ${f.base.at(-1)?.month ? fmtMonth(`${f.base.at(-1)!.month}-01`) : ""})`} · délai {p.leadTimeDays} j{p.moq ? ` · MOQ ${fmtNum(p.moq)}` : ""}</div></td>
                        <td className="num font-medium">{p.stockKnown ? fmtNum(p.stock) : <span className="text-faint">n/c</span>}</td>
                        <td className="num text-muted">{p.onOrder ? fmtNum(p.onOrder) : "—"}</td>
                        <td><Badge tone={LEVEL_TONE[p.level]}>{p.coverageMonths === null ? LEVEL_LABEL[p.level] : months(p.coverageMonths)}</Badge>{p.stockoutDate && p.level === "red" && <div className="text-[11px] text-red">rupture {fmtDateShort(p.stockoutDate)}</div>}</td>
                        <td className="num">{fmtNum(f.baseline, f.baseline < 10 ? 1 : 0)}</td>
                        {monthKeys.map((mk) => {
                          const m = f.months.find((x) => x.month === mk);
                          if (!m) return <td key={mk} className="num text-faint">—</td>;
                          return (
                            <td key={mk} className="num" title={m.events.length ? m.events.map((e) => `${e.label} ×${nf2.format(factor(e))}`).join(" · ") : "aucun événement"}>
                              <span className={m.index !== 1 ? "font-medium" : ""}>{fmtNum(m.qty, m.qty < 10 ? 1 : 0)}</span>
                              {m.events.length > 0 && <div className="text-[10px] text-faint leading-tight">{m.events.map((e) => `×${nf2.format(factor(e))}`).join(" ")}</div>}
                            </td>
                          );
                        })}
                        <td className="num text-muted">{p.stockKnown ? fmtNum(p.targetStock) : "—"}</td>
                        <td className="num font-semibold">{p.recommendedOrder > 0 ? `${fmtNum(p.recommendedOrder)} u.` : <span className="text-faint">—</span>}</td>
                        {canOrder && <td className="num">{p.recommendedOrder > 0 && g.supplier ? <Link href={orderHref(g.supplier, [p])} className="btn-ghost btn-sm">Commander</Link> : null}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {list.length === 0 && (
        <Card><p className="text-[13px] text-muted">{view === "order" ? <>Aucune commande conseillée : le stock (+ commandes en cours) couvre la demande modélisée sur le délai fournisseur, la sécurité et un mois de revue. Voir <Link href={qs({ view: "all" })} className="underline">toutes les références</Link>.</> : <>Aucune référence avec un stock connu ou des ventes. Chargez le <Link href="/imports?type=STOCK_INITIAL" className="underline">stock initial</Link> et un <Link href="/imports?type=SALES" className="underline">fichier de ventes</Link>.</>}</p></Card>
      )}

      <Card className="mt-2">
        <div className="label mb-2">Lecture</div>
        <p className="text-[13px] text-ink-2 mb-2"><b>Base/mois</b> = moyenne, sur les {fc.baseMonths} derniers mois civils complets (à partir de la première vente de la référence), des ventes sell-in <i>désaisonnalisées</i> (ventes du mois ÷ indice du mois). Un mois à venir = base × son indice : produit, sur les événements qui concernent la référence, de 1 + (coefficient − 1) × part du mois couverte. Les événements à mots-clés (saison solaire) ne touchent que les références dont le nom ou la catégorie les contient.</p>
        <p className="text-[13px] text-ink-2 mb-2"><b>Stock cible</b> = demande modélisée sur délai fournisseur + stock de sécurité + 1 mois de revue, à partir d&apos;aujourd&apos;hui (reste du mois en cours proraté). <b>Commande conseillée</b> = stock cible − stock − en cours, arrondie au MOQ. <b>Couverture</b> = jours de demande modélisée couverts par le stock ÷ 30.</p>
        <p className="text-[13px] text-ink-2">Les coefficients sont des réglages, pas des constats : la page Paramètres affiche le ratio <i>observé</i> dans l&apos;historique à côté de chacun (corrélation observée, pas causalité) pour les calibrer. « Commander » ouvre une commande fournisseur pré-remplie (quantités conseillées, dernier prix payé) que vous ajustez avant de l&apos;enregistrer.</p>
      </Card>
    </>
  );
}
