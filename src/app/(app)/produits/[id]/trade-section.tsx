import Link from "next/link";
import type { Product } from "@/db/schema";
import { canDo } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { auditTrail } from "@/lib/audit";
import { listTaxRates, listWarehouses } from "@/lib/gestion/refs";
import { listMovements, stockState } from "@/lib/gestion/ledger";
import { MOVEMENT_META, expiryStatus } from "@/lib/gestion/ledger-shared";
import { fmtMoney, fmtQty } from "@/lib/gestion/money";
import { fmtDate, fmtDateShort, iso, today } from "@/lib/format";
import { Card, Badge } from "@/components/ui";
import { AuditTrail } from "@/components/gestion/audit-trail";
import { saveProductTradeAction } from "../gestion-actions";

const EXPIRY_TONE = { PERIME: "red", PROCHE: "orange", OK: "green" } as const;

/** Bloc « Gestion commerciale » de la fiche article : données de facturation et stock réel du journal. */
export async function ProductTradeSection({ product, seeMargins }: { product: Product; seeMargins: boolean }) {
  const [rates, warehouses, settings, state, moves, history, canEdit, canSeeStock] = await Promise.all([
    listTaxRates(), listWarehouses(), getSettings(), stockState({ productIds: [product.id] }), listMovements({ productId: product.id, limit: 15 }),
    auditTrail("product", product.id, 10), canDo("produits", "edit"), canDo("stock", "view"),
  ]);
  const st = state[0];
  const now = iso(today());
  const whLabel = new Map(warehouses.map((w) => [w.key, w.label]));
  const defaultRate = rates.find((r) => r.key === settings.gestion.defaultTaxRateKey);

  return (
    <div className="grid lg:grid-cols-3 gap-4 mb-4">
      <Card title="Gestion commerciale" className="scroll-mt-20">
        <form id="gestion" action={saveProductTradeAction} className="space-y-2 text-[13px]">
          <input type="hidden" name="id" value={product.id} />
          <fieldset disabled={!canEdit} className="grid grid-cols-2 gap-2">
            <label className="block"><span className="label block mb-1">Réf. COMANET</span><input name="code" defaultValue={product.code ?? ""} placeholder="ex. CYG01" className="input h-9 font-mono" /></label>
            <label className="block"><span className="label block mb-1">EAN</span><input name="ean" defaultValue={product.ean ?? ""} inputMode="numeric" className="input h-9 font-mono" /></label>
            <label className="block"><span className="label block mb-1">Nature</span>
              <select name="kind" defaultValue={product.kind} className="select h-9"><option value="PRODUIT">Produit (stocké)</option><option value="SERVICE">Service (non stocké)</option></select>
            </label>
            <label className="block"><span className="label block mb-1">TVA</span>
              <select name="taxRateKey" defaultValue={product.taxRateKey ?? ""} className="select h-9">
                <option value="">Défaut ({defaultRate?.label ?? settings.gestion.defaultTaxRateKey})</option>
                {rates.filter((r) => r.active || r.key === product.taxRateKey).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </label>
            <label className="block"><span className="label block mb-1">Unité</span><input name="unit" defaultValue={product.unit} className="input h-9" /></label>
            <label className="block"><span className="label block mb-1">Colisage</span><input name="packSize" defaultValue={product.packSize ?? ""} inputMode="numeric" placeholder="u. / carton" className="input h-9" /></label>
            <label className="col-span-2 flex items-center gap-2"><input type="checkbox" name="trackLots" defaultChecked={product.trackLots} /> Suivi des lots et dates de péremption</label>
          </fieldset>
          {canEdit && <button className="btn-secondary btn-sm w-full" type="submit">Enregistrer</button>}
          <p className="text-[11px] text-faint">La référence COMANET est celle des factures Sage (colonne REF) ; le « code article » de la fiche vient des fichiers distributeurs.</p>
        </form>
        {history.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-[12px] text-muted">Historique</summary><div className="mt-2"><AuditTrail rows={history} /></div></details>}
      </Card>

      <Card title="Stock réel (journal)" className="lg:col-span-2 scroll-mt-20" action={canSeeStock ? <Link href="/gestion/stock" className="text-[12px] text-accent font-medium">Tout le stock</Link> : undefined}>
        <div id="stock" />
        {!st || (st.movements === 0 && st.external.length === 0) ? (
          <p className="text-[13px] text-muted">Aucun mouvement pour cet article. Le journal démarre avec l&apos;import du stock initial ; en attendant, la photo de stock ci-dessus reste la référence de la couverture.</p>
        ) : (
          <div className="space-y-3 text-[13px]">
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {Object.entries(st.byWarehouse).map(([k, q]) => <div key={k}><div className="label">{whLabel.get(k) ?? k}</div><div className="text-[18px] font-semibold">{fmtQty(q)}</div></div>)}
              {st.external.map((e) => <div key={e.warehouseKey}><div className="label">{whLabel.get(e.warehouseKey) ?? e.warehouseKey}</div><div className="text-[18px] font-semibold">{fmtQty(e.qty)}</div><div className="text-[11px] text-faint">photo du {fmtDateShort(e.date)}</div></div>)}
              {seeMargins && <div><div className="label">CMUP</div><div className="text-[18px] font-semibold">{fmtMoney(st.cmup)}</div><div className="text-[11px] text-faint">valeur {fmtMoney(st.value, 0)} MAD</div></div>}
            </div>
            {st.lots.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {st.lots.map((l) => { const s = expiryStatus(l.expiryDate, now, settings.gestion.expiryAlertDays); return <Badge key={`${l.lotId}|${l.warehouseKey}`} tone={s ? EXPIRY_TONE[s] : "gray"}>Lot {l.lotNumber} · {fmtQty(l.qty)} u. · {l.expiryDate ? `péremption ${fmtDate(l.expiryDate)}` : "sans date"}</Badge>; })}
              </div>
            )}
            <div className="table-wrap">
              <table className="tbl text-[12.5px]">
                <thead><tr><th>Date</th><th>Mouvement</th><th>Dépôt</th><th>Lot</th><th className="num">Qté</th></tr></thead>
                <tbody>
                  {moves.map((m) => (
                    <tr key={m.id} className={m.reversed || m.reversalOf ? "opacity-60" : ""}>
                      <td>{fmtDateShort(m.date)}</td>
                      <td><Badge tone={MOVEMENT_META[m.type].tone}>{MOVEMENT_META[m.type].label}</Badge>{m.reversalOf && <span className="text-[11px] text-faint ml-1">contre-passation</span>}</td>
                      <td className="text-muted">{whLabel.get(m.warehouseKey) ?? m.warehouseKey}</td>
                      <td className="font-mono">{m.lotNumber ?? "—"}</td>
                      <td className={`num font-medium ${Number(m.quantity) < 0 ? "text-red" : "text-green"}`}>{Number(m.quantity) > 0 ? "+" : ""}{fmtQty(m.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
