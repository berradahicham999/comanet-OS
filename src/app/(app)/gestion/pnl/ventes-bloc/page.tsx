import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { distributorClients, getBulkSale, listBulkSales } from "@/lib/pnl";
import { listBrands } from "@/lib/users";
import { fmtDate, fmtMAD, fmtNum, fmtPct, iso, today } from "@/lib/format";
import { PageHeader, Card, Badge, BrandDot, Empty } from "@/components/ui";
import { PnlTabs } from "@/components/gestion/gestion-nav";
import { deleteBulkAction, saveBulkAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ventes en bloc — P&L" };

export default async function BulkSalesPage(props: { searchParams: Promise<{ year?: string; new?: string; edit?: string; error?: string; done?: string }> }) {
  await requireAdmin();
  const sp = await props.searchParams;
  const now = today();
  const curYear = now.getUTCFullYear();
  const year = Number(sp.year) >= 2020 && Number(sp.year) <= curYear + 1 ? Number(sp.year) : curYear;
  const [rows, brands, clients, editing] = await Promise.all([
    listBulkSales(year), listBrands(), distributorClients(), sp.edit && /^[0-9a-f-]{36}$/i.test(sp.edit) ? getBulkSale(sp.edit) : Promise.resolve(null),
  ]);
  const e = editing;
  const showForm = sp.new === "1" || !!e;
  const cospharma = clients.find((c) => /cospharma/i.test(c.name));
  const gamarde = brands.find((b) => /gamarde/i.test(b.name) && !b.mergedIntoId);
  const tot = rows.reduce((a, r) => ({ ca: a.ca + r.amountHt, cost: a.cost + (r.costAmount ?? 0) }), { ca: 0, cost: 0 });

  return (
    <>
      <PageHeader
        eyebrow="P&L"
        title="Ventes en bloc aux distributeurs"
        subtitle="Le stock Gamarde (et Ainhoa) vendu à Cospharma dès sa réception au Maroc. Ces factures ne sont pas dans le fichier de ventes : saisissez à chaque arrivage le montant HT facturé et le coût d'achat de la marchandise. La revente de Cospharma aux pharmacies (sites COS, CAS…) reste hors CA COMANET."
        actions={!showForm ? <Link href={`/gestion/pnl/ventes-bloc?year=${year}&new=1`} className="btn-primary btn-sm">+ Vente en bloc</Link> : undefined}
      >
        <PnlTabs current="/gestion/pnl/ventes-bloc" year={year} />
      </PageHeader>

      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      {sp.done && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green">Enregistré. Le P&L est à jour.</div>}

      <form method="get" className="flex items-center gap-2 mb-4 text-[13px]">
        <select name="year" defaultValue={year} className="select h-9">{[curYear - 2, curYear - 1, curYear].map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <button className="btn-secondary btn-sm h-9">Voir</button>
        {rows.length > 0 && <span className="ml-3 text-muted">{year} : CA <b className="text-ink">{fmtMAD(tot.ca)}</b> · coût {fmtMAD(tot.cost)} · marge <b className="text-ink">{fmtMAD(tot.ca - tot.cost)}</b></span>}
      </form>

      {showForm && (
        <Card className="mb-6 max-w-3xl" title={e ? `Modifier — ${e.label}` : "Nouvelle vente en bloc"}>
          <form action={saveBulkAction} className="grid sm:grid-cols-2 gap-3 text-[13px]">
            {e && <input type="hidden" name="id" value={e.id} />}
            <input type="hidden" name="year" value={year} />
            <label className="block"><span className="label block mb-1">Date de facturation *</span><input type="date" name="date" defaultValue={e?.date ?? iso(now)} className="input h-9" required /></label>
            <label className="block"><span className="label block mb-1">Marque *</span>
              <select name="brandId" defaultValue={e?.brandId ?? gamarde?.id ?? ""} className="select h-9" required>
                <option value="">—</option>
                {brands.filter((b) => b.active && !b.mergedIntoId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className="block"><span className="label block mb-1">Client</span>
              <select name="clientId" defaultValue={e?.clientId ?? cospharma?.id ?? ""} className="select h-9">
                <option value="">—</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="block"><span className="label block mb-1">Libellé</span><input name="label" defaultValue={e?.label ?? ""} className="input h-9" placeholder="ex. Arrivage Gamarde sept. 2026" /></label>
            <label className="block"><span className="label block mb-1">Montant HT facturé (MAD) *</span><input name="amountHt" defaultValue={e?.amountHt ?? ""} className="input h-9" inputMode="decimal" required /></label>
            <label className="block"><span className="label block mb-1">Coût d’achat de la marchandise (MAD)</span><input name="costAmount" defaultValue={e?.costAmount ?? ""} className="input h-9" inputMode="decimal" placeholder="coût de revient de l'arrivage" /></label>
            <label className="block"><span className="label block mb-1">Remise accordée (%)</span><input name="discountPct" defaultValue={e?.discountPct ?? ""} className="input h-9" inputMode="decimal" placeholder="40 (55 pour le solaire)" /></label>
            <label className="block"><span className="label block mb-1">Unités</span><input name="quantity" defaultValue={e?.quantity ?? ""} className="input h-9" inputMode="decimal" /></label>
            <label className="block sm:col-span-2"><span className="label block mb-1">Note</span><input name="notes" defaultValue={e?.notes ?? ""} className="input h-9" placeholder="ex. 30 % à la livraison, 70 % à 90 jours" /></label>
            <div className="sm:col-span-2 flex gap-2">
              <button className="btn-primary btn-sm">{e ? "Enregistrer" : "Ajouter"}</button>
              <Link href={`/gestion/pnl/ventes-bloc?year=${year}`} className="btn-ghost btn-sm">Annuler</Link>
            </div>
          </form>
          {e && (
            <form action={deleteBulkAction} className="mt-4 pt-3 border-t border-line text-[12px] flex items-center gap-2">
              <input type="hidden" name="id" value={e.id} /><input type="hidden" name="year" value={year} />
              <span className="text-muted">Saisie erronée ?</span>
              <button className="text-red hover:underline">Supprimer cette vente</button>
            </form>
          )}
        </Card>
      )}

      {rows.length === 0 ? (
        <Empty
          title={`Aucune vente en bloc sur ${year}`}
          hint="À chaque arrivage Gamarde ou Ainhoa facturé à Cospharma, saisissez la facture : montant HT, coût d'achat, remise. Sans ces ventes, le P&L ne voit pas le CA de ces marques."
          action={<Link href={`/gestion/pnl/ventes-bloc?year=${year}&new=1`} className="btn-primary btn-sm">Saisir un arrivage</Link>}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="tbl w-full text-[13px] tabular-nums">
            <thead><tr><th className="text-left">Date</th><th className="text-left">Libellé</th><th className="text-left">Marque</th><th className="text-left">Client</th><th className="text-right">Unités</th><th className="text-right">Remise</th><th className="text-right">CA HT</th><th className="text-right">Coût</th><th className="text-right">Marge</th><th /></tr></thead>
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
                  <td className="text-right">{r.costAmount !== null ? fmtMAD(r.costAmount, { suffix: false }) : <Badge tone="red">à saisir</Badge>}</td>
                  <td className="text-right font-medium">{r.costAmount !== null ? fmtMAD(r.amountHt - r.costAmount, { suffix: false }) : "—"}</td>
                  <td className="text-right"><Link href={`/gestion/pnl/ventes-bloc?year=${year}&edit=${r.id}`} className="btn-ghost btn-sm">Modifier</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
