import Link from "next/link";
import type { Client } from "@/db/schema";
import { listLegalEntities, mergeCandidates, mergePreview } from "@/lib/gestion/clients";
import { billingReadiness } from "@/lib/gestion/clients-shared";
import { fmtNum } from "@/lib/format";
import { Card, Badge } from "@/components/ui";
import { saveLegalEntityAction, legalEntityActiveAction, mergeClientAction } from "../gestion-actions";

/**
 * Onglet « Identité & conditions » : raisons sociales supplémentaires du point de vente (facturables
 * au choix sur chaque pièce) et fusion d'une fiche en double dans celle-ci.
 */

const FIELDS: { name: string; label: string; span?: boolean; placeholder?: string }[] = [
  { name: "legalName", label: "Raison sociale *", span: true },
  { name: "ice", label: "ICE (15 chiffres)" },
  { name: "accountCode", label: "Code client Sage" },
  { name: "ifNumber", label: "IF" },
  { name: "rc", label: "RC" },
  { name: "patente", label: "Patente" },
  { name: "city", label: "Ville", placeholder: "vide : ville de la fiche" },
  { name: "billingAddress", label: "Adresse de facturation", span: true },
  { name: "postalCode", label: "Code postal" },
];

function EntityForm({ clientId, entity }: { clientId: string; entity?: Record<string, unknown> }) {
  return (
    <form action={saveLegalEntityAction} className="space-y-2 pt-2">
      <input type="hidden" name="id" value={clientId} />
      {entity && <input type="hidden" name="entityId" value={String(entity.id)} />}
      <div className="grid sm:grid-cols-2 gap-2">
        {FIELDS.map((f) => (
          <label key={f.name} className={f.span ? "block sm:col-span-2" : "block"}>
            <span className="label block mb-1">{f.label}</span>
            <input name={f.name} defaultValue={(entity?.[f.name] as string | null) ?? ""} placeholder={f.placeholder} required={f.name === "legalName"} className="input h-8 text-[12.5px]" />
          </label>
        ))}
      </div>
      <div className="flex justify-end"><button className="btn-secondary btn-sm" type="submit">{entity ? "Enregistrer" : "Ajouter la raison sociale"}</button></div>
    </form>
  );
}

export async function LegalEntitiesCard({ client, canEdit }: { client: Client; canEdit: boolean }) {
  const entities = await listLegalEntities(client.id);
  return (
    <Card title="Raisons sociales facturables">
      <div id="raisons-sociales" className="space-y-2 text-[13px]">
        <p className="text-[12px] text-muted">
          Un même point de vente peut être facturé sous plusieurs sociétés. Ventes, animations, stock et encours restent sur cette fiche ;
          seule la pièce (BL, facture, avoir) choisit la raison sociale imprimée.
        </p>
        <div className="flex items-start justify-between gap-2 border-b border-line pb-2">
          <div><b>{client.legalName ?? client.name}</b> <Badge tone="accent">principale</Badge><div className="text-muted">{client.ice ? `ICE ${client.ice}` : "ICE manquant"} · identité de la fiche ci-contre</div></div>
        </div>
        {entities.map((e) => {
          const r = billingReadiness({ legalName: e.legalName, ice: e.ice, billingAddress: e.billingAddress, city: e.city ?? client.city, accountCode: e.accountCode, paymentDays: 0, paymentModeKey: "x" });
          return (
            <details key={e.id} className="border-b border-line pb-2 last:border-0">
              <summary className="cursor-pointer list-none flex items-start justify-between gap-2">
                <div>
                  <b className={e.active ? "" : "text-muted line-through"}>{e.legalName}</b>
                  {!e.active && <Badge className="ml-1">archivée</Badge>}
                  {e.active && !r.ready && <Badge tone="orange" className="ml-1">incomplète</Badge>}
                  <div className="text-muted">{e.ice ? `ICE ${e.ice}` : "ICE manquant"}{e.accountCode ? ` · Sage ${e.accountCode}` : ""}{e.documents ? ` · ${e.documents} pièce(s)` : ""}</div>
                  {e.active && !r.ready && <div className="text-[12px] text-orange">Pour facturer : {r.missing.join(", ")}.</div>}
                </div>
                {canEdit && <span className="text-[12px] text-accent shrink-0">Modifier</span>}
              </summary>
              {canEdit && (
                <>
                  <EntityForm clientId={client.id} entity={e as unknown as Record<string, unknown>} />
                  <form action={legalEntityActiveAction} className="flex justify-end pt-1">
                    <input type="hidden" name="id" value={client.id} /><input type="hidden" name="entityId" value={e.id} /><input type="hidden" name="active" value={e.active ? "0" : "1"} />
                    <button className="btn-ghost btn-sm" type="submit">{e.active ? "Archiver (plus proposée sur les pièces)" : "Restaurer"}</button>
                  </form>
                </>
              )}
            </details>
          );
        })}
        {canEdit && (
          <details className="pt-1">
            <summary className="cursor-pointer text-accent text-[12.5px] font-medium">+ Ajouter une raison sociale</summary>
            <EntityForm clientId={client.id} />
          </details>
        )}
      </div>
    </Card>
  );
}

export async function MergeCard({ client, sp }: { client: Client; sp: { merge?: string; mergeq?: string } }) {
  const target = sp.merge && /^[0-9a-f-]{36}$/i.test(sp.merge) ? sp.merge : null;
  const [candidates, preview] = await Promise.all([
    target ? Promise.resolve([]) : mergeCandidates(client.id, sp.mergeq ?? null),
    target ? mergePreview(client.id, target).catch(() => null) : Promise.resolve(null),
  ]);
  return (
    <Card title="Fusionner une fiche en double">
      <div id="fusion" className="space-y-2 text-[13px]">
        {!preview ? (
          <>
            <p className="text-[12px] text-muted">
              Le même point de vente saisi deux fois (ex. un nom au terrain, un autre dans les ventes) ? Fusionnez l&apos;autre fiche dans celle-ci :
              tout son historique y est rattaché, son nom reste reconnu par les imports, sa raison sociale devient facturable ici.
            </p>
            <form className="flex gap-1.5" action={`/clients/${client.id}`}>
              <input type="hidden" name="tab" value="infos" />
              <input name="mergeq" defaultValue={sp.mergeq ?? ""} placeholder="Chercher une fiche (nom, raison sociale, code)" className="input h-8 text-[12.5px] flex-1" />
              <button className="btn-secondary btn-sm" type="submit">Chercher</button>
            </form>
            {candidates.length === 0
              ? <p className="text-[12px] text-faint">{sp.mergeq ? "Aucune fiche trouvée." : "Aucune fiche proche détectée."}</p>
              : (
                <ul className="divide-y divide-line">
                  {candidates.map((c) => (
                    <li key={c.id} className="py-1.5 flex items-start justify-between gap-2">
                      <div>
                        <Link href={`/clients/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                        {c.city && <span className="text-muted"> · {c.city}</span>}
                        <div className="text-[12px] text-muted">{c.reason} · {fmtNum(c.sales)} ventes · {fmtNum(c.animations)} animations{c.docs ? ` · ${c.docs} pièce(s)` : ""}</div>
                      </div>
                      <Link href={`/clients/${client.id}?tab=infos&merge=${c.id}#fusion`} className="btn-ghost btn-sm shrink-0">Aperçu</Link>
                    </li>
                  ))}
                </ul>
              )}
          </>
        ) : (
          <>
            <p>
              <b>{preview.absorbed.name}</b>{preview.absorbed.city && <span className="text-muted"> ({preview.absorbed.city})</span>} sera fusionnée dans{" "}
              <b>{preview.kept.name}</b>, puis supprimée.
            </p>
            {preview.moves.length > 0
              ? <ul className="list-disc pl-5 text-[12.5px]">{preview.moves.map((m) => <li key={m.label}>{fmtNum(m.n)} {m.label} rattaché(e)s à {preview.kept.name}</li>)}</ul>
              : <p className="text-muted text-[12.5px]">Aucune donnée à déplacer.</p>}
            <ul className="list-disc pl-5 text-[12.5px]">
              <li>« {preview.absorbed.name} » devient un libellé d&apos;import de {preview.kept.name}.</li>
              <li>{preview.newEntity ? <>Raison sociale ajoutée : <b>{preview.newEntity.legalName}</b>{preview.newEntity.ice ? ` (ICE ${preview.newEntity.ice})` : ""}.</> : "Même société : aucune raison sociale ajoutée."}</li>
              {preview.notes.map((n) => <li key={n} className="text-orange">{n}</li>)}
            </ul>
            {preview.blockers.length > 0 ? (
              <div className="rounded-xl bg-red-soft border border-red/30 px-3 py-2 text-red text-[12.5px]">
                {preview.blockers.join(" ")}
                {preview.blockers.some((b) => b.includes("autre sens")) && <> <Link href={`/clients/${preview.absorbed.id}?tab=infos&merge=${preview.kept.id}#fusion`} className="underline font-medium">Fusionner dans l&apos;autre sens</Link></>}
              </div>
            ) : (
              <form action={mergeClientAction} className="space-y-1.5 pt-1">
                <input type="hidden" name="id" value={client.id} /><input type="hidden" name="absorbedId" value={preview.absorbed.id} />
                <p className="text-[12px] text-muted">Irréversible d&apos;un clic (l&apos;historique garde la trace). Tapez <b>FUSIONNER</b>.</p>
                <div className="flex gap-1.5">
                  <input name="confirm" placeholder="FUSIONNER" autoComplete="off" className="input h-8 text-[12.5px] flex-1" />
                  <button className="btn-primary btn-sm" type="submit">Fusionner</button>
                </div>
              </form>
            )}
            <div className="flex gap-3 text-[12px]">
              <Link href={`/clients/${client.id}?tab=infos#fusion`} className="text-muted hover:underline">Annuler</Link>
              {preview.blockers.length === 0 && <Link href={`/clients/${preview.absorbed.id}?tab=infos&merge=${preview.kept.id}#fusion`} className="text-muted hover:underline">Garder plutôt « {preview.absorbed.name} »</Link>}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
