import Link from "next/link";
import { PageHeader, Card, Kpi, Section, Empty, Badge } from "@/components/ui";
import { requireFieldControl } from "@/lib/medical/field-access";
import { fieldDelegates, fieldVisits, fieldKpis, cabinetsToValidate, type FieldVisit } from "@/lib/medical/field-report";
import { buildTimeline } from "@/lib/medical/field-report-shared";
import { autoCloseStaleQuietly, businessDay } from "@/lib/medical/chrono";
import { mapsUrl } from "@/lib/medical/gps-shared";
import { fmtTime, fmtDate } from "@/lib/format";
import { FieldMap, type MapVisit, type MapCabinet } from "@/components/medical/field-map";
import { VerificationBadge } from "@/components/medical/verification-badge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suivi terrain médical" };

const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace(".", ",")} km` : `${m} m`);
const fmtMin = (m: number | null) => (m === null ? "—" : m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`);
const ymd = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Suivi terrain médical (direction et managers) : carte des démarrages / fins, timeline de la journée,
 * tableau des visites avec contrôle de présence, indicateurs, cabinets à valider. Une déléguée n'y a
 * jamais accès ; un manager ne voit que ses déléguées.
 */
export default async function SuiviPage(props: { searchParams: Promise<{ delegate?: string; from?: string; to?: string; day?: string }> }) {
  const { scope } = await requireFieldControl();
  await autoCloseStaleQuietly();
  const sp = await props.searchParams;
  const todayStr = businessDay(new Date());
  const day = sp.day && ymd.test(sp.day) ? sp.day : null;
  const from = day ?? (sp.from && ymd.test(sp.from) ? sp.from : todayStr);
  const to = day ?? (sp.to && ymd.test(sp.to) ? sp.to : from);
  const delegates = await fieldDelegates(scope);
  const delegateId = sp.delegate && delegates.some((d) => d.id === sp.delegate) ? sp.delegate : null;
  const filters = { delegateId, from, to };

  const [visits, cabinets] = await Promise.all([fieldVisits(scope, filters), cabinetsToValidate(scope)]);
  const kpis = await fieldKpis(scope, visits, filters);

  // Timeline par déléguée et par jour ; le rang sert aussi aux numéros de la carte.
  const groups = new Map<string, FieldVisit[]>();
  for (const v of visits) groups.set(`${v.date}|${v.delegateId ?? ""}`, [...(groups.get(`${v.date}|${v.delegateId ?? ""}`) ?? []), v]);
  const timelines = [...groups.entries()].map(([k, vs]) => ({ key: k, date: vs[0].date, delegate: vs[0].delegateName ?? "—", ...buildTimeline(vs) }));
  const seqOf = new Map<string, number>();
  for (const t of timelines) for (const it of t.items) seqOf.set(it.id, it.seq);

  const mapVisits: MapVisit[] = visits.map((v) => ({
    id: v.id, seq: seqOf.get(v.id) ?? 0, doctorId: v.doctorId, doctorName: v.doctorName,
    label: `${v.delegateName ?? ""} · ${fmtDate(v.date)}`, status: v.status, verificationStatus: v.verificationStatus,
    events: v.events.map((e) => ({ type: e.type, lat: e.lat, lng: e.lng, accuracyM: e.accuracyM, at: e.at, atLabel: fmtTime(e.at) })), cabinet: v.cabinet,
  }));
  const mapCabinets: MapCabinet[] = [
    ...visits.filter((v) => v.cabinet).map((v) => ({ doctorId: v.doctorId, name: v.doctorName, lat: v.cabinet!.lat, lng: v.cabinet!.lng, validated: v.cabinet!.validated })),
    ...cabinets.map((c) => ({ doctorId: c.doctorId, name: c.name, lat: c.lat, lng: c.lng, validated: false })),
  ];
  const qs = new URLSearchParams({ ...(delegateId ? { delegate: delegateId } : {}), from, to }).toString();

  return (
    <>
      <PageHeader
        eyebrow="Médical"
        title="Suivi terrain"
        subtitle="Démarrage, fin et position de chaque visite. Visible par la direction et le manager de chaque déléguée uniquement."
        actions={<a href={`/medical/suivi/export?${qs}`} className="btn-ghost">Export Excel</a>}
      >
        <form className="flex flex-wrap items-end gap-2 text-[13px]">
          <label><span className="label block mb-1">Déléguée</span>
            <select name="delegate" defaultValue={delegateId ?? ""} className="select h-9 min-w-[180px]">
              <option value="">Toutes</option>
              {delegates.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label><span className="label block mb-1">Du</span><input type="date" name="from" defaultValue={from} className="input h-9" /></label>
          <label><span className="label block mb-1">Au</span><input type="date" name="to" defaultValue={to} className="input h-9" /></label>
          <button className="btn-primary h-9" type="submit">Afficher</button>
          <Link href={`/medical/suivi?${new URLSearchParams({ ...(delegateId ? { delegate: delegateId } : {}), day: todayStr })}`} className="btn-ghost h-9">Aujourd&apos;hui</Link>
        </form>
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi label="Visites réalisées" value={kpis.realized} sub={`${kpis.perDay ?? "—"} / jour actif · ${kpis.notDone} non effectuée(s)`} />
        <Kpi label="Semaine en cours" value={`${kpis.week.done} / ${kpis.week.objective || "—"}`} sub="réalisées / objectif hebdo" tone={kpis.week.objective && kpis.week.done >= kpis.week.objective ? "green" : undefined} />
        <Kpi label="Mois en cours" value={`${kpis.month.done} / ${kpis.month.objective || "—"}`} sub="réalisées / objectif mensuel" />
        <Kpi label="Durée moyenne" value={fmtMin(kpis.avgDuration)} sub="visites chronométrées terminées" />
        <Kpi label="Visites vérifiées" value={kpis.verifiedPct === null ? "—" : `${kpis.verifiedPct} %`} sub={`${kpis.controlled} visite(s) sous contrôle GPS`} tone={kpis.verifiedPct !== null && kpis.verifiedPct < 70 ? "orange" : undefined} />
        <Kpi label="Temps en visite" value={fmtMin(timelines.reduce((a, t) => a + t.summary.visitMinutes, 0))} sub={`${fmtMin(timelines.reduce((a, t) => a + t.summary.betweenMinutes, 0))} entre les visites (trajet, attente, pauses)`} />
        <Kpi label="Couverture du fichier" value={kpis.coverage.pct === null ? "—" : `${kpis.coverage.pct} %`} sub={`${kpis.coverage.visited} / ${kpis.coverage.total} médecins des secteurs visités sur la période`} />
        <Kpi label="Fréquence respectée" value={kpis.frequency.pct === null ? "—" : `${kpis.frequency.pct} %`} sub={`${kpis.frequency.onTime} / ${kpis.frequency.total} médecins à jour de visite`} />
      </div>

      {cabinets.length > 0 && (
        <Card className="mb-6" title={`Positions de cabinet à valider (${cabinets.length})`}>
          <p className="text-[13px] text-muted mb-2">Proposées au premier démarrage d&apos;une visite. Tant qu&apos;elles ne sont pas validées, les visites de ces médecins restent « à vérifier ». Ouvrez le carré orange sur la carte, déplacez-le si besoin, puis validez.</p>
          <div className="flex flex-wrap gap-1.5">
            {cabinets.slice(0, 30).map((c) => <Badge key={c.doctorId} tone="orange">Dr {c.name}{c.city ? ` · ${c.city}` : ""}</Badge>)}
          </div>
        </Card>
      )}

      <Section title="Carte" description="Points numérotés dans l'ordre de la journée de chaque déléguée.">
        <Card><FieldMap visits={mapVisits} cabinets={mapCabinets} editable /></Card>
      </Section>

      {visits.length === 0 ? (
        <Empty title="Aucune visite sur cette période" hint="Les visites apparaissent ici dès qu'une déléguée appuie sur « Démarrer » dans Médical → Ma journée. Les visites saisies avant le chrono restent visibles dans Médical → Visites." />
      ) : (
        <>
          <Section title="Timeline">
            <div className="grid lg:grid-cols-2 gap-3">
              {timelines.map((t) => (
                <Card key={t.key} title={`${t.delegate} · ${fmtDate(t.date)}`}>
                  <div className="text-[12px] text-muted mb-2">
                    Premier démarrage {t.summary.firstStart ? fmtTime(t.summary.firstStart) : "—"} · dernière fin {t.summary.lastStop ? fmtTime(t.summary.lastStop) : "—"} ·
                    amplitude {fmtMin(t.summary.spanMinutes)} · en visite {fmtMin(t.summary.visitMinutes)} · entre visites {fmtMin(t.summary.betweenMinutes)}
                  </div>
                  <ol className="space-y-1.5 text-[13px]">
                    {t.items.map((v) => (
                      <li key={v.id}>
                        {v.gapBeforeMin !== null && <div className="text-[11.5px] text-faint pl-7">↓ {fmtMin(v.gapBeforeMin)}</div>}
                        <div className="flex items-center gap-2">
                          <span className="w-5 text-right font-semibold">{v.seq}</span>
                          <Link href={`/medical/visites/${v.id}`} className="hover:underline flex-1 min-w-0 truncate">Dr {v.doctorName}</Link>
                          <span className="text-muted tabular-nums">
                            {v.status === "NON_EFFECTUEE" ? `non effectuée ${v.endedAt ? fmtTime(v.endedAt) : ""}` : `${v.startedAt ? fmtTime(v.startedAt) : "—"} → ${v.endedAt ? fmtTime(v.endedAt) : "en cours"} · ${v.autoClosed ? "clôture auto" : fmtMin(v.durationMinutes)}`}
                          </span>
                          <VerificationBadge status={v.verificationStatus} />
                        </div>
                      </li>
                    ))}
                    {t.untimed.map((v) => (
                      <li key={v.id} className="text-muted pl-7"><Link href={`/medical/visites/${v.id}`} className="hover:underline">Dr {v.doctorName}</Link> · saisie sans heure</li>
                    ))}
                  </ol>
                </Card>
              ))}
            </div>
          </Section>

          <Section title="Visites" description="Distance au cabinet calculée avec la position actuelle du cabinet. Précision = rayon d'incertitude annoncé par le téléphone.">
            <Card pad={false}>
              <div className="overflow-x-auto">
                <table className="tbl text-[12.5px]">
                  <thead>
                    <tr><th>Médecin</th><th>Déléguée</th><th>Date</th><th>Début</th><th>Fin</th><th>Durée</th><th>Dist. début / fin</th><th>Précision</th><th>Contrôle</th><th>Points</th></tr>
                  </thead>
                  <tbody>
                    {visits.map((v) => {
                      const start = v.events.find((e) => e.type === "START" || e.type === "NON_EFFECTUEE");
                      const stop = [...v.events].reverse().find((e) => e.type === "STOP");
                      const dist = (e?: (typeof v.events)[number]) => (e ? (e.distanceM === null ? (e.lat === null ? "pas de GPS" : "—") : fmtDist(e.distanceM)) : "—");
                      return (
                        <tr key={v.id}>
                          <td><Link href={`/medical/visites/${v.id}`} className="hover:underline">Dr {v.doctorName}</Link>{v.cabinet && !v.cabinet.validated && <div className="text-[11px] text-orange">cabinet à valider</div>}</td>
                          <td>{v.delegateName ?? "—"}</td>
                          <td>{fmtDate(v.date)}</td>
                          <td className="tabular-nums">{v.startedAt ? fmtTime(v.startedAt) : "—"}</td>
                          <td className="tabular-nums">{v.endedAt ? fmtTime(v.endedAt) : v.status === "EN_COURS" ? "en cours" : "—"}</td>
                          <td>{v.status === "NON_EFFECTUEE" ? `non effectuée (${v.notDoneReason ?? ""})` : v.autoClosed ? "clôture auto" : fmtMin(v.durationMinutes)}{v.syncedLate && <div className="text-[11px] text-orange">synchronisée en différé</div>}</td>
                          <td className="tabular-nums">{dist(start)} / {dist(stop)}</td>
                          <td className="tabular-nums">{start?.accuracyM != null ? `± ${start.accuracyM} m` : "—"} / {stop?.accuracyM != null ? `± ${stop.accuracyM} m` : "—"}</td>
                          <td className="min-w-[220px]">
                            <VerificationBadge status={v.verificationStatus} />
                            {v.reasons.length > 0 && <ul className="mt-1 text-[11.5px] text-muted list-disc pl-4">{v.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
                          </td>
                          <td className="whitespace-nowrap">
                            {v.events.filter((e) => e.lat !== null && (e.type === "START" || e.type === "STOP" || e.type === "NON_EFFECTUEE")).map((e) => (
                              <a key={e.id} href={mapsUrl({ lat: e.lat!, lng: e.lng! })} target="_blank" rel="noopener" className="text-accent-2 hover:underline mr-2">
                                {e.type === "START" ? "Début" : e.type === "STOP" ? "Fin" : "Absent"}
                              </a>
                            ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </Section>
        </>
      )}
    </>
  );
}
