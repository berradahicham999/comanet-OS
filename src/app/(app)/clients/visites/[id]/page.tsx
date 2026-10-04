import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, clientInScope } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { fmtDate, fmtTime } from "@/lib/format";
import { PageHeader, Card, Badge, Facts } from "@/components/ui";
import { crmViewer, canSeeUser, canSeePositions } from "@/lib/crm/access";
import { visitOutcomes } from "@/lib/crm/visits";
import { VISIT_KIND_LABELS, VISIT_STATUS_LABELS, VISIT_RESULTS, orderHref, stockReadingHref, type ClientVisitKind, type ClientVisitStatus } from "@/lib/crm/visits-shared";
import { VERIFICATION_LABELS, GPS_ERROR_LABELS, mapsUrl, type GpsError, type VerificationStatus } from "@/lib/medical/gps-shared";
import { toBusinessLocal } from "@/lib/medical/chrono";
import { saveReportAction, correctVisitAction, cancelVisitAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Visite client" };

const EVENT_LABELS: Record<string, string> = { START: "Démarrage", STOP: "Fin", NON_EFFECTUEE: "Non effectuée", CLOTURE_AUTO: "Clôture automatique", CORRECTION: "Correction" };
const VERIF_TONE: Record<string, "green" | "orange" | "red" | "gray"> = { VERIFIEE: "green", A_VERIFIER: "orange", NON_VERIFIEE: "red", HORS_CONTROLE: "gray" };

type VisitRow = {
  id: string; client_id: string; client_name: string; city: string | null; user_id: string | null; user_name: string | null; date: string;
  status: ClientVisitStatus; kind: ClientVisitKind; started_at: string | null; ended_at: string | null; duration_minutes: number | null; timing_source: string;
  objective: string | null; result: string | null; comment: string | null; next_action: string | null; next_visit_date: string | null; not_done_reason: string | null;
  report_status: string | null; auto_closed: boolean; synced_late: boolean; verification_status: VerificationStatus; verification_reasons: string[];
  gps_lat: string | null; gps_lng: string | null; gps_status: string | null;
};

export default async function VisitPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ cr?: string; error?: string; done?: string }> }) {
  const user = await requireAccess("clients");
  const { id } = await props.params;
  const sp = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const v = (await db.execute<VisitRow>(sql`
    select v.id, v.client_id, c.name as client_name, c.city, v.user_id, u.name as user_name, v.date::text as date, v.status, v.kind, v.started_at, v.ended_at,
      v.duration_minutes, v.timing_source, v.objective, v.result, v.comment, v.next_action, v.next_visit_date::text as next_visit_date, v.not_done_reason,
      v.report_status, v.auto_closed, v.synced_late, v.verification_status, v.verification_reasons, c.gps_lat, c.gps_lng, c.gps_status
    from client_visits v join clients c on c.id = v.client_id left join users u on u.id = v.user_id where v.id = ${id}::uuid`)).rows[0];
  if (!v) notFound();
  const viewer = await crmViewer();
  if (!viewer || !(canSeeUser(viewer, v.user_id) || (await clientInScope(v.client_id)))) notFound();
  const positions = canSeePositions(viewer, v.user_id);
  const mine = v.user_id === user.id;
  const canReport = (mine && viewer.canCreate) || viewer.canValidate;
  const settings = await getSettings();
  const [events, outcomes] = await Promise.all([
    db.execute<{ type: string; server_time: string; lat: string | null; lng: string | null; accuracy_m: number | null; gps_error: GpsError | null; distance_cabinet_m: number | null; synced_late: boolean; actor_name: string | null; reason: string | null }>(sql`
      select type, server_time, lat, lng, accuracy_m, gps_error, distance_cabinet_m, synced_late, actor_name, reason
      from visit_events where client_visit_id = ${id}::uuid order by server_time, id`),
    visitOutcomes([id], settings.crm),
  ]);
  const out = outcomes.get(id);
  const editReport = canReport && v.status === "EFFECTUEE" && (sp.cr === "1" || v.report_status === "A_COMPLETER");

  return (
    <>
      <PageHeader
        eyebrow={<Link href={mine ? "/clients/tournee" : `/clients/visites?user=${v.user_id ?? ""}`} className="hover:underline">{mine ? "Ma tournée" : "Suivi des visites"}</Link>}
        title={<span className="flex items-center gap-2 flex-wrap"><Link href={`/clients/${v.client_id}?tab=crm`} className="hover:underline">{v.client_name}</Link><Badge tone={v.status === "EFFECTUEE" ? "green" : v.status === "NON_EFFECTUEE" ? "orange" : v.status === "PLANIFIEE" ? "blue" : "gray"}>{VISIT_STATUS_LABELS[v.status]}</Badge>{v.kind !== "VISITE" && <Badge tone="purple">{VISIT_KIND_LABELS[v.kind]}</Badge>}</span>}
        subtitle={[fmtDate(v.date), v.user_name, v.city].filter(Boolean).join(" · ")}
      />
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      {sp.done && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green">{sp.done === "report" ? "Compte rendu enregistré." : sp.done === "correction" ? "Correction enregistrée : le contrôle est recalculé." : sp.done === "cancel" ? "Visite annulée." : "Enregistré."}</div>}

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {editReport ? (
            <Card title="Compte rendu">
              <form action={saveReportAction} className="space-y-3 text-[13px]">
                <input type="hidden" name="visitId" value={v.id} />
                <input type="hidden" name="toTour" value={mine ? "1" : "0"} />
                <label className="block"><span className="label block mb-1">Objectif de la visite</span><input name="objective" defaultValue={v.objective ?? ""} className="input h-11" placeholder="ex. Réassort Gamarde, présentation nouveauté" /></label>
                <label className="block"><span className="label block mb-1">Résultat</span>
                  <input name="result" list="crm-results" defaultValue={v.result ?? ""} className="input h-11" placeholder="ex. Commande prise" />
                  <datalist id="crm-results">{VISIT_RESULTS.map((r) => <option key={r} value={r} />)}</datalist>
                </label>
                <label className="block"><span className="label block mb-1">Commentaire</span><textarea name="comment" defaultValue={v.comment ?? ""} className="textarea min-h-[88px]" placeholder="Ce qui a été dit, objections, concurrence, merchandising…" /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className="label block mb-1">Prochaine action</span><input name="nextAction" defaultValue={v.next_action ?? ""} className="input h-11" /></label>
                  <label className="block"><span className="label block mb-1">Prochaine visite</span><input type="date" name="nextVisitDate" defaultValue={v.next_visit_date ?? ""} min={v.date} className="input h-11" /></label>
                </div>
                <p className="text-[12px] text-muted">Une date de prochaine visite la planifie automatiquement dans votre tournée.</p>
                <button className="btn-primary w-full h-11">Enregistrer le compte rendu</button>
              </form>
            </Card>
          ) : (
            <Card title="Compte rendu" action={canReport && v.status === "EFFECTUEE" ? <Link href={`/clients/visites/${v.id}?cr=1`} className="text-[12px] text-accent font-medium">Modifier</Link> : undefined}>
              {v.status === "NON_EFFECTUEE" ? <p className="text-[13px]">Visite non effectuée : {v.not_done_reason ?? "sans motif"}.</p>
                : v.status === "PLANIFIEE" ? <p className="text-[13px] text-muted">Visite planifiée{v.objective ? ` — ${v.objective}` : ""}. Elle se démarre depuis Ma tournée.</p>
                : <Facts items={[
                    { label: "Objectif", value: v.objective ?? "—" }, { label: "Résultat", value: v.result ?? "—" },
                    { label: "Prochaine action", value: v.next_action ?? "—" }, { label: "Prochaine visite", value: v.next_visit_date ? fmtDate(v.next_visit_date) : "—" },
                  ]} />}
              {v.comment && <p className="mt-3 text-[13px] whitespace-pre-line">{v.comment}</p>}
            </Card>
          )}

          <Card title="Pendant la visite">
            <div className="text-[13px] space-y-1.5">
              <div>Commandes prises : {out?.orders.length ? out.orders.map((o) => <Link key={o.id} href={`/gestion/pieces/${o.id}`} className="text-accent font-medium mr-2">{o.number ?? "brouillon"}</Link>) : <span className="text-muted">aucune</span>}</div>
              <div>Relevés de stock en rayon le même jour : {out?.readings ? `${out.readings} produit(s)` : <span className="text-muted">aucun</span>}</div>
              <p className="text-[11.5px] text-faint">Déduit, pas saisi : commande enregistrée par la commerciale chez ce client entre le démarrage et {settings.crm.orderWindowMinutes} min après la fin ; relevé du même jour.</p>
            </div>
            {mine && v.status !== "ANNULEE" && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={orderHref(v.client_id)} className="btn-secondary btn-sm">Prendre une commande</Link>
                <Link href={stockReadingHref(v.client_id)} className="btn-secondary btn-sm">Relever le stock</Link>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Horaires">
            <Facts items={[
              { label: "Démarrage", value: fmtTime(v.started_at) }, { label: "Fin", value: fmtTime(v.ended_at) },
              { label: "Durée", value: v.auto_closed ? "non mesurée (clôture automatique)" : v.duration_minutes !== null ? `${v.duration_minutes} min` : "—" },
              { label: "Saisie", value: v.timing_source === "CHRONO" ? (v.synced_late ? "chrono, envoyée en différé" : "chrono") : v.timing_source === "HISTORIQUE" ? "reprise" : "saisie après coup" },
            ]} />
            {positions && v.timing_source === "CHRONO" && (
              <div className="mt-3">
                <div className="flex items-center gap-2"><span className="label">Contrôle de présence</span><Badge tone={VERIF_TONE[v.verification_status]}>{VERIFICATION_LABELS[v.verification_status]}</Badge></div>
                {v.verification_reasons.length > 0 && <ul className="mt-1.5 text-[12.5px] text-ink-2 list-disc pl-4 space-y-0.5">{v.verification_reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
                <div className="mt-2 text-[12px] text-muted">
                  Point de vente : {v.gps_lat ? <><a href={mapsUrl({ lat: Number(v.gps_lat), lng: Number(v.gps_lng) })} target="_blank" rel="noopener" className="text-accent">position {v.gps_status === "VALIDEE" ? "validée" : "à valider"}</a></> : "position inconnue"}
                </div>
              </div>
            )}
            {v.status === "PLANIFIEE" && (canReport || mine) && (
              <form action={cancelVisitAction} className="mt-3"><input type="hidden" name="visitId" value={v.id} /><button className="btn-ghost btn-sm text-red">Annuler la visite planifiée</button></form>
            )}
          </Card>

          {events.rows.length > 0 && (
            <Card title="Journal">
              <ul className="text-[12.5px] space-y-2">
                {events.rows.map((e, i) => (
                  <li key={i}>
                    <div className="font-medium">{EVENT_LABELS[e.type] ?? e.type} · {fmtTime(e.server_time)}{e.synced_late ? " · différé" : ""}</div>
                    {positions && (e.lat ? <div className="text-muted"><a href={mapsUrl({ lat: Number(e.lat), lng: Number(e.lng) })} target="_blank" rel="noopener" className="text-accent">position</a>{e.accuracy_m !== null ? ` ± ${e.accuracy_m} m` : ""}{e.distance_cabinet_m !== null ? ` · à ${e.distance_cabinet_m} m du point de vente` : ""}</div>
                      : e.gps_error ? <div className="text-muted">sans position : {GPS_ERROR_LABELS[e.gps_error]}</div> : null)}
                    {e.reason && <div className="text-muted">{e.actor_name ? `${e.actor_name} : ` : ""}{e.reason}</div>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {positions && v.timing_source === "CHRONO" && (
            <Card title="Corriger (manager, direction)">
              <form action={correctVisitAction} className="space-y-2 text-[13px]">
                <input type="hidden" name="visitId" value={v.id} />
                <label className="block"><span className="label block mb-1">Démarrage</span><input type="datetime-local" name="startedAt" defaultValue={toBusinessLocal(v.started_at)} className="input h-9" /></label>
                <label className="block"><span className="label block mb-1">Fin</span><input type="datetime-local" name="endedAt" defaultValue={toBusinessLocal(v.ended_at)} className="input h-9" /></label>
                <label className="block"><span className="label block mb-1">Statut de contrôle</span>
                  <select name="forcedStatus" defaultValue="" className="select h-9"><option value="">Recalculé (ne pas forcer)</option><option value="VERIFIEE">Vérifiée</option><option value="A_VERIFIER">À vérifier</option><option value="NON_VERIFIEE">Non vérifiée</option></select>
                </label>
                <label className="block"><span className="label block mb-1">Motif (obligatoire)</span><input name="reason" required minLength={3} className="input h-9" placeholder="ex. Deuxième adresse du client" /></label>
                <button className="btn-secondary btn-sm w-full">Enregistrer la correction</button>
                <p className="text-[11.5px] text-faint">Les positions ne se corrigent jamais ; la correction et son motif restent au journal.</p>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
