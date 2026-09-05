import Link from "next/link";
import { requireAccess } from "@/lib/access";
import { productList } from "@/lib/products";
import { productStocks, LEVEL_LABEL } from "@/lib/stock";
import { getRefDate } from "@/lib/ref-date";
import { listBrands } from "@/lib/users";
import { PageHeader, Badge, BrandDot, Delta } from "@/components/ui";
import { fmtMAD, fmtNum, fmtDateShort, delta, months } from "@/lib/format";
import { normKey } from "@/lib/import/normalize";

export const dynamic = "force-dynamic";
export const metadata = { title: "Produits" };

const LEVEL_TONE = { green: "green", yellow: "yellow", orange: "orange", red: "red", none: "gray", unknown: "gray" } as const;

export default async function ProduitsPage(props: { searchParams: Promise<{ brand?: string; q?: string; review?: string; inactive?: string }> }) {
  await requireAccess("produits");
  const sp = await props.searchParams;
  const { ref } = await getRefDate();
  const [rows, stocks, brands] = await Promise.all([productList(ref, { brandId: sp.brand || undefined }), productStocks({}, ref), listBrands()]);
  const stockById = new Map(stocks.map((s) => [s.productId, s]));
  const q = sp.q ? normKey(sp.q) : "";
  let list = rows.filter((p) => sp.inactive ? true : p.active);
  if (q) list = list.filter((p) => normKey(p.name).includes(q) || (p.sku ?? "").includes(q) || normKey(p.shortName ?? "").includes(q));
  if (sp.review) list = list.filter((p) => p.needsReview || !p.brandId);

  return (
    <>
      <PageHeader eyebrow="Bibliothèque produits" title="Produits" subtitle={`${rows.length} références · CA et volumes sur 12 mois glissants`} actions={<Link href="/produits/nouveau" className="btn-primary btn-sm">+ Produit</Link>}>
        <form action="/produits" method="get" className="flex flex-wrap gap-2 items-center">
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Rechercher une désignation, un code…" className="input h-9 max-w-xs" />
          <select name="brand" defaultValue={sp.brand ?? ""} className="select h-9 w-auto">
            <option value="">Toutes les marques</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" name="review" value="1" defaultChecked={!!sp.review} /> À rattacher</label>
          <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" name="inactive" value="1" defaultChecked={!!sp.inactive} /> Inclure inactifs</label>
          <button className="btn-secondary h-9" type="submit">Filtrer</button>
        </form>
      </PageHeader>

      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Produit</th><th>Marque</th><th className="num">CA 12 m</th><th className="num">Unités 12 m</th><th className="num">Tendance 3 m</th><th className="num">Clients</th><th className="num">Stock</th><th>Couverture</th><th>Dernière vente</th></tr></thead>
          <tbody>
            {list.map((p) => {
              const st = stockById.get(p.id);
              return (
                <tr key={p.id}>
                  <td>
                    <Link href={`/produits/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                    {p.sku && <span className="text-faint text-[11px] ml-2">{p.sku}</span>}
                    {(p.needsReview || !p.brandId) && <Badge tone="yellow" className="ml-2">à rattacher</Badge>}
                    {!p.active && <Badge tone="gray" className="ml-2">inactif</Badge>}
                  </td>
                  <td>{p.brandName ? <span className="flex items-center gap-1.5 text-muted"><BrandDot color={p.brandColor ?? "#999"} />{p.brandName}</span> : <span className="text-faint">—</span>}</td>
                  <td className="num font-medium">{fmtMAD(p.revenue12, { suffix: false })}</td>
                  <td className="num">{fmtNum(p.qty12)}</td>
                  <td className="num"><Delta value={delta(p.qty3, p.qtyPrev3)} size="xs" /></td>
                  <td className="num">{p.clients12}</td>
                  <td className="num">{st?.stockKnown ? fmtNum(st.stock) : <span className="text-faint">n/c</span>}</td>
                  <td>{st && st.stockKnown ? <Badge tone={LEVEL_TONE[st.level]}>{st.coverageMonths === null ? LEVEL_LABEL[st.level] : months(st.coverageMonths)}</Badge> : <span className="text-faint text-[12px]">—</span>}</td>
                  <td className="text-muted">{fmtDateShort(p.lastSale)}</td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={9} className="text-center text-muted py-8">Aucun produit.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
