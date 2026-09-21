import Link from "next/link";
import { Card, Badge, Empty } from "@/components/ui";
import { StockReadingForm } from "@/components/stock-reading-form";
import { canDo, clientInScope } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { listBrands } from "@/lib/users";
import { fmtDateShort, fmtNum, today } from "@/lib/format";
import {
  AGING_META, CHANNEL_LABELS, CHANNEL_TONES, catalogWithLastReadings, clientStockOverview, type ClientStockProduct, type Reading,
} from "@/lib/client-stock";
import { recordClientStock } from "../actions";

/**
 * Onglet « Stock en point de vente » de la fiche client : consultation (dernier relevé par
 * produit, ancienneté, écart, croisement sell-in / sell-out, historique) et mode relevé
 * pour le commercial. Toutes les valeurs viennent de `src/lib/client-stock.ts`.
 */
export async function ClientStockTab({ clientId, clientName, sp }: {
  clientId: string;
  clientName: string;
  sp: { releve?: string; brand?: string; sort?: string; done?: string; error?: string };
}) {
  const base = `/clients/${clientId}?tab=stock`;
  const t = today();
  const [settings, canCreate, inScope] = await Promise.all([getSettings(), canDo("clients", "create"), clientInScope(clientId)]);
  const mayRecord = canCreate && inScope;

  if (sp.releve === "1" && mayRecord) {
    const [catalog, brands] = await Promise.all([catalogWithLastReadings(clientId), listBrands()]);
    return (
      <Card title="Relever le stock">
        <StockReadingForm
          clientId={clientId}
          clientName={clientName}
          products={catalog}
          brands={brands.filter((b) => b.active).map((b) => ({ id: b.id, name: b.name }))}
          action={recordClientStock}
          cancelHref={base}
        />
      </Card>
    );
  }

  const s = settings.clientStock;
  const overview = await clientStockOverview(clientId, t, s);
  let rows = overview.products;
  if (sp.brand) rows = rows.filter((p) => p.brandId === sp.brand);
  if (sp.sort === "qty") rows = [...rows].sort((a, b) => b.latest.quantity - a.latest.quantity);
  if (sp.sort === "age") rows = [...rows].sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0));
  const brands = [...new Map(overview.products.filter((p) => p.brandId).map((p) => [p.brandId as string, p.brandName ?? ""])).entries()].sort((a, b) => a[1].localeCompare(b[1], "fr"));
  const stockouts = overview.products.filter((p) => p.latest.quantity === 0).length;
  const q = (over: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    u.set("tab", "stock");
    for (const [k, v] of Object.entries({ brand: sp.brand, sort: sp.sort, ...over })) if (v) u.set(k, v);
    return `/clients/${clientId}?${u.toString()}`;
  };

  return (
    <>
      {sp.done && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green font-medium">Relevé enregistré : {sp.done} produit{Number(sp.done) > 1 ? "s" : ""}.</div>}
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red font-medium">{sp.error === "quantite" ? "Une quantité est illisible ou négative : rien n'a été enregistré." : sp.error === "portee" ? "Ce client n'est pas dans votre portefeuille." : "Enregistrement impossible."}</div>}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="text-[13px] text-muted flex-1 min-w-[200px]">
          {overview.lastReadAt ? <>Dernier relevé le <span className="font-medium text-ink">{fmtDateShort(overview.lastReadAt)}</span> · {overview.products.length} produit{overview.products.length > 1 ? "s" : ""} relevé{overview.products.length > 1 ? "s" : ""}{stockouts ? <> · <span className="text-red font-medium">{stockouts} en rupture</span></> : null}</> : "Aucun relevé de stock chez ce client."}
        </div>
        {mayRecord
          ? <Link href={q({ releve: "1" })} className="btn-primary h-10 px-4 flex items-center">Relever le stock</Link>
          : <span className="text-[12px] text-faint">{canCreate ? "Client hors de votre portefeuille : lecture seule." : "Lecture seule (droit Créer sur Clients requis pour relever)."}</span>}
      </div>

      {overview.products.length === 0 ? (
        <Empty
          title="Aucun stock relevé chez ce point de vente"
          hint={<>Le stock est relevé par l&apos;animatrice pendant son animation (champ « rayon » de la <Link href={`/terrain/saisie?client=${clientId}`} className="text-accent font-medium">saisie terrain</Link>) ou par le commercial en tournée, ici, avec « Relever le stock ». Chaque relevé est une photo datée : l&apos;historique est conservé.</>}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3 text-[13px]">
            <form method="get" action={`/clients/${clientId}`} className="flex items-center gap-2">
              <input type="hidden" name="tab" value="stock" />
              {sp.sort && <input type="hidden" name="sort" value={sp.sort} />}
              <select name="brand" defaultValue={sp.brand ?? ""} className="select h-9" aria-label="Filtrer par marque">
                <option value="">Toutes marques</option>
                {brands.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
              <button className="btn-secondary btn-sm" type="submit">Filtrer</button>
            </form>
            <span className="text-muted">Trier :</span>
            <Link href={q({ sort: undefined })} className={`rounded-full px-3 h-8 inline-flex items-center border ${!sp.sort ? "bg-ink text-white border-ink" : "border-line"}`}>Marque</Link>
            <Link href={q({ sort: "qty" })} className={`rounded-full px-3 h-8 inline-flex items-center border ${sp.sort === "qty" ? "bg-ink text-white border-ink" : "border-line"}`}>Quantité</Link>
            <Link href={q({ sort: "age" })} className={`rounded-full px-3 h-8 inline-flex items-center border ${sp.sort === "age" ? "bg-ink text-white border-ink" : "border-line"}`}>Ancienneté</Link>
          </div>

          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th className="num">Stock relevé</th>
                  <th>Relevé le</th>
                  <th>Par</th>
                  <th className="num">Écart</th>
                  <th className="num">Sell-in {overview.windowDays} j</th>
                  <th className="num">Sell-out anim. {overview.windowDays} j</th>
                  <th className="num">Couverture (estim.)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => <ProductRow key={p.productId} p={p} />)}
                {rows.length === 0 && <tr><td colSpan={8} className="text-center text-muted py-6">Aucun produit relevé sur cette marque.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-faint mt-2">
            Stock relevé = photo datée du rayon et de la réserve du point de vente, saisie par une animatrice (Animation) ou un commercial (Tournée). Sell-in = unités livrées par COMANET (Sage) ; sell-out = unités vendues pendant les animations : les deux sont nommés, jamais additionnés.
            Couverture = stock relevé ÷ rythme hebdomadaire de sell-in sur {overview.windowDays} j : une <strong>estimation</strong>, « — » sans livraison sur la fenêtre. Ancienneté : vert &lt; {s.freshDays} j, orange &lt; {s.staleDays} j, rouge au-delà (Paramètres → Stock chez le client).
          </p>
        </>
      )}
    </>
  );
}

function ProductRow({ p }: { p: ClientStockProduct }) {
  const aging = AGING_META[p.aging];
  return (
    <>
      <tr>
        <td>
          <Link href={`/produits/${p.productId}`} className="font-medium hover:underline">{p.name}</Link>
          <details className="group">
            <summary className="cursor-pointer list-none">
              <div className="text-[11px] text-muted">{p.brandName ?? "—"} · {p.history.length} relevé{p.history.length > 1 ? "s" : ""} <span className="text-accent group-open:hidden">▸ historique</span><span className="text-accent hidden group-open:inline">▾ replier</span></div>
            </summary>
            <History history={p.history} />
          </details>
        </td>
        <td className={`num font-semibold ${p.latest.quantity === 0 ? "text-red" : ""}`}>{p.latest.quantity === 0 ? "Rupture" : fmtNum(p.latest.quantity)}</td>
        <td><div>{fmtDateShort(p.latest.readAt)}</div><Badge tone={aging.tone}>{aging.label}{p.ageDays !== null ? ` · ${p.ageDays} j` : ""}</Badge></td>
        <td><div className="text-[13px]">{p.latest.userName ?? "—"}</div><Badge tone={CHANNEL_TONES[p.latest.channel]}>{CHANNEL_LABELS[p.latest.channel]}</Badge></td>
        <td className={`num ${p.delta === null ? "text-faint" : p.delta < 0 ? "text-red" : p.delta > 0 ? "text-green" : ""}`}>{p.delta === null ? "—" : `${p.delta > 0 ? "+" : ""}${fmtNum(p.delta)}`}{p.previous && <div className="text-[11px] text-faint">vs {fmtNum(p.previous.quantity)} le {fmtDateShort(p.previous.readAt)}</div>}</td>
        <td className="num">{p.sellInUnits ? fmtNum(p.sellInUnits) : "—"}</td>
        <td className="num">{p.selloutUnits ? fmtNum(p.selloutUnits) : "—"}</td>
        <td className="num">{p.coverageWeeks === null ? <span className="text-faint" title="Aucune livraison sur la fenêtre : non estimable">—</span> : <span title="Estimation : stock relevé ÷ rythme de sell-in">≈ {fmtNum(p.coverageWeeks, 1)} sem.</span>}</td>
      </tr>
    </>
  );
}

function History({ history }: { history: Reading[] }) {
  const pts = [...history].reverse();
  return (
    <div className="mt-2 mb-1 rounded-xl bg-sunk p-2 text-[12px]">
      {pts.length >= 3 && <Sparkline values={pts.map((r) => r.quantity)} />}
      <ul className="space-y-0.5">
        {history.map((r) => (
          <li key={r.id} className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-muted">{fmtDateShort(r.readAt)}</span>
            <span className={`w-10 shrink-0 text-right font-medium ${r.quantity === 0 ? "text-red" : ""}`}>{r.quantity}</span>
            <Badge tone={CHANNEL_TONES[r.channel]}>{CHANNEL_LABELS[r.channel]}</Badge>
            <span className="truncate text-muted">{r.userName ?? "—"}{r.comment ? ` · ${r.comment}` : ""}</span>
            {r.animationId && <Link href={`/terrain/${r.animationId}`} className="text-accent shrink-0">animation</Link>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Courbe minimale des relevés (≥ 3 points), sans bibliothèque. */
function Sparkline({ values }: { values: number[] }) {
  const w = 220, h = 44, pad = 4;
  const max = Math.max(...values, 1);
  const step = (w - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => `${pad + i * step},${h - pad - (v / max) * (h - pad * 2)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="block mb-1" aria-label="Évolution du stock relevé">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent" />
      {values.map((v, i) => <circle key={i} cx={pad + i * step} cy={h - pad - (v / max) * (h - pad * 2)} r="2.5" className={v === 0 ? "fill-red" : "fill-accent"} />)}
    </svg>
  );
}
