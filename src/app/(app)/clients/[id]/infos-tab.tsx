import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { Client } from "@/db/schema";
import { canDo } from "@/lib/access";
import { auditTrail } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import { listBrands } from "@/lib/users";
import { listPaymentModes } from "@/lib/gestion/refs";
import { clientCommercial, clientLinks } from "@/lib/gestion/clients";
import { fmtMoney } from "@/lib/gestion/money";
import { Card, Badge, BrandDot } from "@/components/ui";
import { ClientLegalForm } from "@/components/gestion/client-legal-form";
import { AuditTrail } from "@/components/gestion/audit-trail";
import {
  saveClientLegalAction, blockClientAction, archiveClientAction, deleteClientAction, addAddressAction, removeAddressAction, brandDiscountAction,
} from "../gestion-actions";

/**
 * Onglet « Identité & conditions » : ce que les pièces imprimeront (raison sociale, ICE, adresse),
 * les conditions commerciales, les adresses de livraison, les remises par marque, le blocage,
 * l'archivage et l'historique des modifications.
 */
export async function ClientInfosTab({ client, billing, sp }: {
  client: Client;
  billing: { ready: boolean; missing: string[]; recommended: string[] };
  sp: { done?: string; error?: string };
}) {
  const [settings, modes, brands, users, commercial, history, links, canEdit, canValidate] = await Promise.all([
    getSettings(), listPaymentModes(), listBrands(),
    db.execute<{ id: string; name: string }>(sql`select id, name from users where active order by name`),
    clientCommercial(client.id), auditTrail("client", client.id), clientLinks(client.id),
    canDo("clients", "edit"), canDo("clients", "validate"),
  ]);
  const g = settings.gestion;
  const discountBrands = new Set(commercial.discounts.map((d) => d.brand_id));

  return (
    <>
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      {sp.done && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green">{sp.done === "cree" ? "Client créé. Complétez son identité légale pour pouvoir le facturer." : "Fiche enregistrée."}</div>}
      <div className={`mb-4 rounded-2xl border px-4 py-3 text-[13px] ${billing.ready ? "border-green/30 bg-green-soft text-green" : "border-orange/30 bg-orange-soft text-orange"}`}>
        {billing.ready
          ? <>Prêt à facturer : les mentions obligatoires sont complètes.{billing.recommended.length > 0 && <span className="text-muted"> Recommandé : {billing.recommended.join(", ")}.</span>}</>
          : <>Pour facturer ce client, il manque : <b>{billing.missing.join(", ")}</b>.</>}
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-4">
        <Card title="Identité et conditions">
          <ClientLegalForm client={client} users={users.rows} paymentModes={modes} action={saveClientLegalAction} readOnly={!canEdit} maxPaymentDays={g.maxPaymentDays} defaultPaymentDays={g.defaultPaymentDays} />
        </Card>

        <div className="space-y-4">
          <Card title="Adresses de livraison">
            <div id="livraison" className="space-y-2 text-[13px]">
              {commercial.addresses.length === 0 && <p className="text-muted">Aucune : les pièces seront livrées à l&apos;adresse de facturation.</p>}
              {commercial.addresses.map((a) => (
                <form key={a.id} action={removeAddressAction} className="flex items-start justify-between gap-2 border-b border-line pb-2 last:border-0">
                  <input type="hidden" name="id" value={client.id} /><input type="hidden" name="addressId" value={a.id} />
                  <div><b>{a.label}</b>{a.isDefault && <Badge tone="accent" className="ml-1">par défaut</Badge>}<div className="text-muted">{a.address}{a.city ? `, ${a.city}` : ""}</div></div>
                  {canEdit && <button className="text-faint hover:text-red text-[13px]" type="submit" title="Retirer">×</button>}
                </form>
              ))}
              {canEdit && (
                <form action={addAddressAction} className="space-y-1.5 pt-1">
                  <input type="hidden" name="id" value={client.id} />
                  <div className="grid grid-cols-2 gap-1.5">
                    <input name="label" placeholder="Libellé (dépôt, 2ᵉ officine…)" className="input h-8 text-[12.5px]" required />
                    <input name="city" placeholder="Ville" className="input h-8 text-[12.5px]" />
                  </div>
                  <input name="address" placeholder="Adresse" className="input h-8 text-[12.5px]" required />
                  <div className="flex items-center justify-between"><label className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" name="isDefault" /> Par défaut</label><button className="btn-secondary btn-sm" type="submit">Ajouter</button></div>
                </form>
              )}
            </div>
          </Card>

          <Card title="Remises par marque">
            <div id="remises" className="space-y-1.5 text-[13px]">
              <p className="text-[12px] text-muted">Remplacent la remise par défaut ({client.defaultDiscountPct ? `${fmtMoney(client.defaultDiscountPct)} %` : "non réglée"}) pour les articles de la marque.</p>
              {commercial.discounts.map((d) => (
                <form key={d.brand_id} action={brandDiscountAction} className="flex items-center justify-between gap-2">
                  <input type="hidden" name="id" value={client.id} /><input type="hidden" name="brandId" value={d.brand_id} /><input type="hidden" name="remove" value="1" />
                  <span className="flex items-center gap-1.5"><BrandDot color={d.color} />{d.brand}</span>
                  <span className="flex items-center gap-2"><b>{fmtMoney(d.discount_pct)} %</b>{canEdit && <button className="text-faint hover:text-red" type="submit" title="Retirer">×</button>}</span>
                </form>
              ))}
              {canEdit && (
                <form action={brandDiscountAction} className="flex items-center gap-1.5 pt-1">
                  <input type="hidden" name="id" value={client.id} />
                  <select name="brandId" className="select h-8 text-[12.5px] flex-1" required><option value="">Marque…</option>{brands.filter((b) => b.active && !b.mergedIntoId && !discountBrands.has(b.id)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                  <input name="pct" placeholder="%" inputMode="decimal" className="input h-8 w-16 text-[12.5px]" required />
                  <button className="btn-secondary btn-sm" type="submit">OK</button>
                </form>
              )}
            </div>
          </Card>

          {canValidate && (
            <Card title="Blocage et archivage">
              <form action={blockClientAction} className="space-y-1.5 text-[13px]">
                <input type="hidden" name="id" value={client.id} /><input type="hidden" name="blocked" value={client.blocked ? "0" : "1"} />
                {client.blocked
                  ? <p className="text-red">Bloqué : {client.blockedReason}</p>
                  : <><p className="text-muted">Un client bloqué ne pourra recevoir de pièce qu&apos;après levée du blocage par un administrateur.</p><input name="reason" placeholder="Motif (impayé, litige…)" className="input h-8 text-[12.5px]" /></>}
                <button className="btn-secondary btn-sm" type="submit">{client.blocked ? "Débloquer" : "Bloquer"}</button>
              </form>
              <form action={archiveClientAction} className="space-y-1.5 text-[13px] mt-4 pt-4 border-t border-line">
                <input type="hidden" name="id" value={client.id} /><input type="hidden" name="archive" value={client.active ? "1" : "0"} />
                <p className="text-muted">{client.active ? "Archivé, le client disparaît des listes et des sélecteurs ; ses ventes et son historique restent." : "Ce client est archivé."}</p>
                <button className="btn-secondary btn-sm" type="submit">{client.active ? "Archiver" : "Restaurer"}</button>
              </form>
              <form action={deleteClientAction} className="space-y-1.5 text-[13px] mt-4 pt-4 border-t border-line">
                <input type="hidden" name="id" value={client.id} />
                {links.length
                  ? <p className="text-muted">Suppression impossible : {links.map((l) => `${l.n} ${l.label}`).join(", ")}. Archivez-le.</p>
                  : <><p className="text-muted">Aucune donnée rattachée : suppression définitive possible. Tapez <b>SUPPRIMER</b>.</p><input name="confirm" placeholder="SUPPRIMER" autoComplete="off" className="input h-8 text-[12.5px]" /><button className="btn-secondary btn-sm text-red" type="submit">Supprimer définitivement</button></>}
              </form>
            </Card>
          )}

          <Card title="Historique"><AuditTrail rows={history} /></Card>
        </div>
      </div>
    </>
  );
}
