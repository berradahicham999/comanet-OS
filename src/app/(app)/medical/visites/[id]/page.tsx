import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, isOwnOnly } from "@/lib/access";
import { PageHeader, Card, Badge } from "@/components/ui";
import { MedicalVisitForm } from "@/components/medical-visit-form";
import { VerificationBadge } from "@/components/medical/verification-badge";
import { fieldScope, inFieldScope } from "@/lib/medical/field-access";
import { fieldVisits } from "@/lib/medical/field-report";
import { toBusinessLocal } from "@/lib/medical/chrono";
import { mapsUrl, VERIFICATION_LABELS, GPS_ERROR_LABELS, type GpsError, type VerificationStatus } from "@/lib/medical/gps-shared";
import { iso, fmtTime, fmtDate } from "@/lib/format";
import { saveVisitAction, deleteVisitAction } from "../actions";
import { correctVisitAction } from "../../suivi/actions";

export const dynamic = "force-dynamic";

const EVENT_LABELS: Record<string, string> = { START: "Démarrer", STOP: "Terminer", NON_EFFECTUEE: "Non effectuée", CLOTURE_AUTO: "Clôture automatique", CORRECTION: "Correction" };
const TIMING_LABELS: Record<string, string> = { CHRONO: "Chronométrée", SAISIE_MANUELLE: "Saisie au formulaire", AVANT_CHRONO: "Saisie avant chrono (hors contrôle GPS)", HISTORIQUE: "Historique repris du CRM (hors contrôle GPS)" };

export default async function VisiteDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requireAccess("medical");
  const { id } = await params;
  const sp = await searchParams;
  const isDelegate = await isOwnOnly();

  const [visitRes, productsRes, doctorsRes] = await Promise.all([
    db.execute(sql`
      select v.*, (d.first_name || ' ' || d.last_name) as doctor_name, d.city as doctor_city,
        coalesce((select array_agg(vp.product_id) from visit_products vp where vp.visit_id = v.id), '{}') as product_ids,
        coalesce((select json_agg(json_build_object('productId', vs.product_id, 'qty', vs.quantity::text)) from visit_samples vs where vs.visit_id = v.id), '[]') as samples
      from doctor_visits v join doctors d on d.id = v.doctor_id
      where v.id = ${id}::uuid`),
    db.execute(sql`select id, name from products where active order by name`),
    db.execute(sql`select id, (first_name || ' ' || last_name) as name, city from doctors where status <> 'INACTIF' order by last_name, first_name`),
  ]);
  const visit = visitRes.rows[0] as Record<string, unknown> | undefined;
  if (!visit) notFound();
  if (isDelegate && visit.delegate_id !== user.id) notFound();

  const products = productsRes.rows as { id: string; name: string }[];
  const doctors = doctorsRes.rows as { id: string; name: string; city: string | null }[];
  const chrono = visit.timing_source === "CHRONO";
  const status = visit.status as string;
  const scope = await fieldScope();
  const canControl = !isDelegate && inFieldScope(scope, visit.delegate_id as string | null);
  const detail = canControl && chrono ? (await fieldVisits(scope, { from: visit.date as string, to: visit.date as string, delegateId: visit.delegate_id as string })).find((v) => v.id === id) ?? null : null;
  const mode = chrono || (isDelegate && status !== "PLANIFIEE") ? "report" : isDelegate ? "planning" : "full";

  return (
    <>
      <PageHeader eyebrow="Médical" title={`Visite — Dr ${visit.doctor_name}`} subtitle={`${(visit.doctor_city as string | null) ?? ""} · ${fmtDate(visit.date as string)} · ${TIMING_LABELS[visit.timing_source as string] ?? ""}`} />
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red font-medium">{sp.error}</div>}
      {sp.ok && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green font-medium">Correction enregistrée et tracée.</div>}

      <div className="grid xl:grid-cols-[minmax(0,640px)_1fr] gap-4 items-start">
        {detail && (
          <div className="space-y-4 xl:col-start-2 xl:row-start-1">
            <Card title="Contrôle de présence">
              <VerificationBadge status={detail.verificationStatus} />
              {detail.reasons.length > 0 ? (
                <ul className="mt-2 text-[13px] text-ink-2 list-disc pl-5 space-y-0.5">{detail.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              ) : <div className="mt-2 text-[13px] text-muted">Aucune anomalie.</div>}
              <div className="mt-2 text-[12px] text-muted">
                Cabinet : {detail.cabinet ? `${detail.cabinet.validated ? "position validée" : "position à valider"} (${detail.cabinet.source === "PREMIERE_VISITE" ? "proposée au premier démarrage" : detail.cabinet.source === "ADRESSE" ? "depuis l'adresse" : "saisie à la main"})` : "position inconnue"}
                {" · "}<Link href={`/medical/suivi?${new URLSearchParams({ day: detail.date, ...(detail.delegateId ? { delegate: detail.delegateId } : {}) })}`} className="text-accent-2 hover:underline">Voir sur la carte</Link>
              </div>
            </Card>

            <Card title="Journal de la visite" pad={false}>
              <div className="overflow-x-auto">
                <table className="tbl text-[12px]">
                  <thead><tr><th>Action</th><th>Heure retenue</th><th>Serveur / téléphone</th><th>Position</th><th>Précision</th><th>Cabinet</th><th>Par</th></tr></thead>
                  <tbody>
                    {detail.events.map((e) => (
                      <tr key={e.id}>
                        <td>{EVENT_LABELS[e.type] ?? e.type}{e.syncedLate && <div className="text-[11px] text-orange">différé</div>}</td>
                        <td className="tabular-nums">{fmtTime(e.at)}</td>
                        <td className="tabular-nums text-muted">{fmtTime(e.serverTime)} / {e.deviceTime ? fmtTime(e.deviceTime) : "—"}</td>
                        <td>{e.lat !== null ? <a href={mapsUrl({ lat: e.lat, lng: e.lng! })} target="_blank" rel="noopener" className="text-accent-2 hover:underline tabular-nums">{e.lat.toFixed(5)}, {e.lng!.toFixed(5)}</a> : e.gpsError ? GPS_ERROR_LABELS[e.gpsError as GpsError] ?? e.gpsError : "—"}</td>
                        <td className="tabular-nums">{e.accuracyM !== null ? `± ${e.accuracyM} m` : "—"}</td>
                        <td className="tabular-nums">{e.distanceM !== null ? `${e.distanceM} m` : "—"}</td>
                        <td>
                          {e.actorName ?? "—"}
                          {e.reason && <div className="text-[11px] text-muted">{e.reason}</div>}
                          {e.type === "CORRECTION" && e.payload && <div className="text-[11px] text-muted">{describeCorrection(e.payload)}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 text-[11.5px] text-faint">Journal en écriture seule : rien ne s&apos;y modifie ni ne s&apos;y efface. Une erreur se corrige par une correction motivée.</div>
            </Card>

            <Card title="Corriger (manager ou direction)">
              <form action={correctVisitAction} className="space-y-2 text-[13px]">
                <input type="hidden" name="id" value={id} />
                <div className="grid grid-cols-2 gap-2">
                  <label><span className="label block mb-1">Début</span><input type="datetime-local" name="startedAt" defaultValue={toBusinessLocal(visit.started_at as string | null)} className="input h-9" /></label>
                  <label><span className="label block mb-1">Fin</span><input type="datetime-local" name="endedAt" defaultValue={toBusinessLocal(visit.ended_at as string | null)} className="input h-9" /></label>
                </div>
                <label className="block"><span className="label block mb-1">Statut de contrôle</span>
                  <select name="forcedStatus" defaultValue="" className="select h-9">
                    <option value="">Calculé automatiquement</option>
                    {(["VERIFIEE", "A_VERIFIER", "NON_VERIFIEE"] as VerificationStatus[]).map((s) => <option key={s} value={s}>Fixer à « {VERIFICATION_LABELS[s]} »</option>)}
                  </select>
                </label>
                <label className="block"><span className="label block mb-1">Motif (obligatoire)</span><input name="reason" required minLength={3} className="input h-9" placeholder="Ex. cabinet secondaire confirmé par téléphone" /></label>
                <button className="btn-primary" type="submit">Enregistrer la correction</button>
                <p className="text-[11.5px] text-faint">Les positions enregistrées ne se corrigent pas : ce sont des preuves. La correction est tracée dans le journal et dans l&apos;audit.</p>
              </form>
            </Card>
          </div>
        )}
        <Card className="xl:col-start-1 xl:row-start-1">
          {chrono && (
            <div className="mb-4 pb-4 border-b border-line text-[13px] flex flex-wrap gap-x-4 gap-y-1">
              <span>Début <b>{visit.started_at ? fmtTime(visit.started_at as string) : "—"}</b></span>
              <span>Fin <b>{visit.ended_at ? fmtTime(visit.ended_at as string) : status === "EN_COURS" ? "en cours" : "—"}</b></span>
              <span>Durée <b>{visit.auto_closed ? "non mesurée (clôture automatique)" : visit.duration_minutes != null ? `${visit.duration_minutes} min` : "—"}</b></span>
              {status === "NON_EFFECTUEE" && <span>Non effectuée : <b>{(visit.not_done_reason as string) ?? "—"}</b></span>}
              {visit.report_status === "A_COMPLETER" && <Badge tone="orange">Compte rendu à compléter</Badge>}
              {Boolean(visit.synced_late) && <Badge tone="orange">Synchronisée en différé</Badge>}
            </div>
          )}
          {status === "EN_COURS" ? (
            <div className="text-[13px] text-muted">Visite en cours : le compte rendu s&apos;ouvre après « Terminer ».</div>
          ) : (
            <MedicalVisitForm
              mode={mode}
              action={saveVisitAction}
              doctors={doctors}
              products={products}
              today={iso(new Date())}
              submitLabel={mode === "report" ? "Enregistrer le compte rendu" : "Enregistrer les modifications"}
              initial={{
                id: visit.id as string,
                doctorId: visit.doctor_id as string,
                date: visit.date as string,
                status: visit.status as string,
                durationMinutes: visit.duration_minutes as number | null,
                visitType: visit.visit_type as string,
                objective: visit.objective as string | null,
                result: visit.result as string | null,
                doctorInterest: visit.doctor_interest as string | null,
                comment: visit.comment as string | null,
                nextAction: visit.next_action as string | null,
                nextVisitDate: visit.next_visit_date as string | null,
                objections: visit.objections as string | null,
                documentation: visit.documentation as string | null,
                productIds: (visit.product_ids as string[]) ?? [],
                samples: ((visit.samples as { productId: string; qty: string }[]) ?? []).map((s) => ({ productId: s.productId, qty: s.qty })),
              }}
            />
          )}
          {!isDelegate && !chrono && (
            <form action={deleteVisitAction} className="mt-4 pt-4 border-t border-line">
              <input type="hidden" name="id" value={visit.id as string} />
              <input type="hidden" name="doctorId" value={visit.doctor_id as string} />
              <button className="btn-ghost btn-sm text-red" type="submit">Supprimer cette visite</button>
            </form>
          )}
        </Card>

      </div>
    </>
  );
}

function describeCorrection(p: Record<string, unknown>): string {
  const b = (p.before ?? {}) as Record<string, string | null>;
  const a = (p.after ?? {}) as Record<string, string | null>;
  const parts: string[] = [];
  if (b.startedAt !== a.startedAt && a.startedAt !== undefined) parts.push(`début ${b.startedAt ? fmtTime(b.startedAt) : "—"} → ${a.startedAt ? fmtTime(a.startedAt) : "—"}`);
  if (b.endedAt !== a.endedAt && a.endedAt !== undefined) parts.push(`fin ${b.endedAt ? fmtTime(b.endedAt) : "—"} → ${a.endedAt ? fmtTime(a.endedAt) : "—"}`);
  if (p.forcedStatus) parts.push(`statut fixé à « ${VERIFICATION_LABELS[p.forcedStatus as VerificationStatus]} »`);
  return parts.join(" · ");
}
