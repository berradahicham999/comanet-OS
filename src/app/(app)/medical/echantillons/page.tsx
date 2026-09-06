import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess } from "@/lib/access";
import { sampleStockByDelegate, sampleForecast } from "@/lib/medical/samples";
import { today, fmtNum } from "@/lib/format";
import { PageHeader, Card, Badge, Empty } from "@/components/ui";
import { addSampleEntry } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Échantillons" };

export default async function EchantillonsPage() {
  const user = await requireAccess("medical");
  const isDelegate = user.role === "DELEGUE_MEDICAL";
  const [stocks, forecast, delegatesRes, productsRes] = await Promise.all([
    sampleStockByDelegate(isDelegate ? user.id : undefined),
    sampleForecast(today()),
    db.execute(sql`select id, name from users where role = 'DELEGUE_MEDICAL' and active order by name`),
    db.execute(sql`select id, name from products where active order by name`),
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

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <Card title="Stock par délégué × produit">
          {stocks.length === 0 ? <Empty title="Aucun mouvement de stock" hint="Ajoutez une dotation depuis le formulaire ci-contre, ou remettez des échantillons lors d'une visite." /> : (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Délégué</th><th>Produit</th><th className="num">Entrées</th><th className="num">Distribués</th><th className="num">Stock actuel</th></tr></thead>
                <tbody>
                  {stocks.map((s) => (
                    <tr key={`${s.delegateId}-${s.productId}`}>
                      <td className="text-muted">{s.delegateName}</td>
                      <td className="font-medium">{s.productName}</td>
                      <td className="num">{fmtNum(s.entries)}</td>
                      <td className="num">{fmtNum(s.distributed)}</td>
                      <td className="num font-medium">{fmtNum(s.current)}</td>
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
