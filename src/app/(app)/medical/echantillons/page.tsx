import { sql } from "drizzle-orm";
import { db } from "@/db";
import { listDelegates } from "@/lib/users";
import { requireAccess, isOwnOnly, hasFlag } from "@/lib/access";
import { sampleStockByDelegate, sampleForecast, sampleValuationByBrand } from "@/lib/medical/samples";
import { today, fmtNum, fmtMAD } from "@/lib/format";
import { PageHeader, Card, Badge, Empty } from "@/components/ui";
import { addSampleEntry } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Échantillons" };

export default async function EchantillonsPage() {
  const user = await requireAccess("medical");
  const isDelegate = await isOwnOnly();
  const seeValues = await hasFlag("seeMargins");
  const year = today().getUTCFullYear();
  const [stocks, forecast, delegatesRes, productsRes, valuation] = await Promise.all([
    sampleStockByDelegate(isDelegate ? user.id : undefined),
    sampleForecast(today()),
    listDelegates().then((rows) => ({ rows })),
    db.execute(sql`select id, name from products where active order by name`),
    sampleValuationByBrand(year),
  ]);
  const delegates = delegatesRes.rows as { id: string; name: string }[];
  const products = productsRes.rows as { id: string; name: string }[];
  const forecastRows = isDelegate ? forecast.filter((f) => f.delegateId === user.id) : forecast;

  return (
    <>
      <PageHeader eyebrow="Médical" title="Échantillons" subtitle="Stock par délégué × produit (somme des mouvements) et besoin estimé pour les visites planifiées." />

      <Card title="Prévision — besoin vs stock" className="mb-4">
        {forecastRows.length === 0 ? <Empty title="Aucun délégué médical" /> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Délégué</th><th className="num">Visites planifiées</th><th className="num">Besoin estimé</th><th className="num">Stock actuel</th><th className="num">Déficit</th></tr></thead>
              <tbody>
                {forecastRows.map((f) => (
                  <tr key={f.delegateId}>
                    <td className="font-medium">{f.delegateName}</td>
                    <td className="num">{fmtNum(f.plannedVisits)}</td>
                    <td className="num">{fmtNum(f.estimatedNeed)}</td>
                    <td className="num">{fmtNum(f.currentStock)}</td>
                    <td className="num">{f.deficit > 0 ? <Badge tone="red">{fmtNum(f.deficit)}</Badge> : <span className="text-faint">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!isDelegate && (
        <Card title={`Valorisation ${year} — décomptée du budget de chaque marque`} className="mb-4">
          <p className="text-[12.5px] text-muted mb-2">Échantillons remis en visite, valorisés au prix d&apos;achat (sinon au prix COMANET). Le montant entre dans le budget consommé de la marque (définition officielle, <code>src/lib/budget.ts</code>). Une unité sans prix n&apos;est pas estimée.</p>
          {valuation.length === 0 ? <p className="text-[13px] text-faint">Aucun échantillon remis cette année.</p> : (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Marque</th><th className="num">Unités remises</th><th className="num">Valorisation</th></tr></thead>
                <tbody>
                  {valuation.map((v) => (
                    <tr key={v.brandId ?? "none"}>
                      <td className="font-medium">{v.brandName}</td>
                      <td className="num">{fmtNum(v.distributed)}</td>
                      <td className="num">{!seeValues ? "•••" : v.value === null ? <span className="text-faint">non mesurable</span> : <>{fmtMAD(v.value, { compact: true })}{v.unknownPriceUnits > 0 && <span className="text-[11px] text-faint"> · {v.unknownPriceUnits} u. sans prix</span>}</>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <Card title="Stock par délégué × produit">
          {stocks.length === 0 ? <Empty title="Aucun mouvement de stock" hint="Ajoutez une dotation depuis le formulaire ci-contre, ou remettez des échantillons lors d'une visite." /> : (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Délégué</th><th>Produit</th><th className="num">Entrées</th><th className="num">Distribués</th><th className="num">Stock actuel</th>{seeValues && <th className="num">Valeur stock</th>}</tr></thead>
                <tbody>
                  {stocks.map((s) => (
                    <tr key={`${s.delegateId}-${s.productId}`}>
                      <td className="text-muted">{s.delegateName}</td>
                      <td className="font-medium">{s.productName}</td>
                      <td className="num">{fmtNum(s.entries)}</td>
                      <td className="num">{fmtNum(s.distributed)}</td>
                      <td className="num font-medium">{fmtNum(s.current)}</td>
                      {seeValues && <td className="num text-muted">{s.currentValue === null ? "non mesurable" : fmtMAD(s.currentValue, { compact: true, suffix: false })}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {!isDelegate && (
          <Card title="Nouvelle dotation">
            <form action={addSampleEntry} className="space-y-2 text-[13px]">
              <label className="block">
                <span className="label block mb-1">Délégué</span>
                <select name="delegateId" className="select h-9" required>
                  <option value="">—</option>
                  {delegates.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="label block mb-1">Produit</span>
                <select name="productId" className="select h-9" required>
                  <option value="">—</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="block"><span className="label block mb-1">Quantité</span><input name="quantity" type="number" min="1" className="input h-9" required /></label>
              <label className="block"><span className="label block mb-1">Commentaire</span><input name="comment" className="input h-9" placeholder="Optionnel" /></label>
              <button className="btn-primary btn-sm w-full" type="submit">Enregistrer la dotation</button>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
