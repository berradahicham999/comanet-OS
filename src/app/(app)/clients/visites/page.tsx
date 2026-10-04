import Link from "next/link";
import { requireAccess, hasFlag } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { fmtDate, fmtMAD, fmtTime, iso, today } from "@/lib/format";
import { PageHeader, Card, Badge, Section, Empty, Kpi } from "@/components/ui";
import { FieldMap, type MapVisit, type MapCabinet } from "@/components/medical/field-map";
import { crmViewer, canSeePositions, canSeeUser, hasTeamView } from "@/lib/crm/access";
import { teamOverview, commercialDetail, crmUsers, visitsOfMonth, placesToValidate, type CityRow } from "@/lib/crm/portfolio";
import { headlineObjective } from "@/lib/crm/objectives";
import { monthOf, monthLabel, parseMonth, shiftMonth, OBJECTIVE_VERDICT_LABELS, type VisitProgress } from "@/lib/crm/portfolio-shared";
import { VISIT_KIND_LABELS, VISIT_STATUS_LABELS, type ClientVisitKind, type ClientVisitStatus } from "@/lib/crm/visits-shared";
import { VERIFICATION_LABELS, type VerificationStatus } from "@/lib/medical/gps-shared";
import { autoCloseStaleClientVisitsQuietly } from "@/lib/crm/visits";
import { validatePositionAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suivi des visites" };

const VERIF_TONE: Record<string, "green" | "orange" | "red" | "gray"> = { VERIFIEE: "green", A_VERIFIER: "orange", NON_VERIFIEE: "red", HORS_CONTROLE: "gray" };
const PACE_TONE: Record<string, "green" | "blue" | "red" | "gray"> = { ATTEINT: "green", DANS_LE_RYTHME: "blue", EN_RETARD: "red", NON_MESURABLE: "gray" };

function Bar({ p, elapsed }: { p: VisitProgress; elapsed: number }) {
  if (!p.expected) return <span className="text-[12px] text-faint">fréquences non définies</span>;
  const pct = p.pct ?? 0;
  const tone = pct >= 100 ? "bg-green" : pct >= elapsed - 10 ? "bg-accent" : pct >= elapsed - 25 ? "bg-orange" : "bg-red";
  return (
    <div className="min-w-[140px]">
      <div className="flex justify-between text-[12px]"><span className="font-medium tabular-nums">{p.counted}/{p.expected}</span><span className="text-muted tabular-nums">{Math.round(pct)} %</span></div>
      <div className="relative mt-1 h-1.5 rounded-full bg-black/6 overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
        <div className="absolute top-0 h-full w-px bg-ink/60" style={{ left: `${Math.min(100, elapsed)}%` }} />
      </div>
    </div>
  );
}

function CityTable({ rows, elapsed }: { rows: CityRow[]; elapsed: number }) {
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead><tr><th>Ville</th><th className="num">Clients</th><th className="num">Suivis</th><th>Visites du mois</th><th className="num">Pas encore visités</th><th className="num">Sans fréquence</th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.city}><td className="font-medium">{c.city}</td><td className="num">{c.clients}</td><td className="num">{c.progress.followed}</td><td><Bar p={c.progress} elapsed={elapsed} /></td><td className="num">{c.progress.notVisited}</td><td className="num text-muted">{c.progress.undefinedFrequency}</td></tr>
          ))}
          {!rows.length && <tr><td colSpan={6} className="text-center text-muted py-6">Aucun client en portefeuille.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default async function VisitsFollowUpPage(props: { searchParams: Promise<{ month?: string; user?: string; city?: string; day?: string; controle?: string }> }) {
  const user = await requireAccess("clients");
  const sp = await props.searchParams;
  await autoCloseStaleClientVisitsQuietly();
  const viewer = await crmViewer();
  if (!viewer) return null;
  const settings = await getSettings();
  const t = iso(today());
  const month = parseMonth(sp.month, monthOf(t));
  const teamView = hasTeamView(viewer);
  const userId = sp.user && /^[0-9a-f-]{36}$/i.test(sp.user) ? sp.user : teamView ? null : user.id;
  const exportAllowed = await hasFlag("exportData");
  const q = (o: Record<string, string | null | undefined>) => {
    const p = new URLSearchParams();
    const merged = { month, user: userId ?? undefined, city: sp.city, ...o };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/clients/visites?${p}`;
  };
  const monthNav = (
    <div className="flex items-center gap-2 text-[13px]">
      <Link href={q({ month: shiftMonth(month, -1), day: null })} className="btn-ghost btn-sm">←</Link>
      <span className="font-medium capitalize">{monthLabel(month)}</span>
      {month < monthOf(t) && <Link href={q({ month: shiftMonth(month, 1), day: null })} className="btn-ghost btn-sm">→</Link>}
      {exportAllowed && <a href={`/clients/visites/export?month=${month}${userId ? `&user=${userId}` : ""}`} className="btn-secondary btn-sm">Exporter (Excel)</a>}
    </div>
  );

  /* ---------------------------- Détail d'une commerciale ---------------------------- */
  if (userId) {
    if (!canSeeUser(viewer, userId)) return <Empty title="Suivi non accessible" hint="Vous voyez vos propres visites ; celles de l'équipe sont réservées à la direction, aux managers et au droit « Valider » sur Clients." />;
    const detail = await commercialDetail(viewer, userId, month, t, settings);
    if (!detail) return <Empty title="Commerciale introuvable" />;
    const positions = canSeePositions(viewer, userId);
    const visits = await visitsOfMonth([userId], month, { withPositions: positions });
    const days = [...new Set(visits.filter((v) => v.events.some((e) => e.lat !== null)).map((v) => v.date))].sort().reverse();
    const mapDay = sp.day && days.includes(sp.day) ? sp.day : days[0] ?? null;
    const dayVisits = visits.filter((v) => v.date === mapDay).sort((a, b) => String(a.startedAt ?? a.endedAt).localeCompare(String(b.startedAt ?? b.endedAt)));
    const mapVisits: MapVisit[] = dayVisits.map((v, i) => ({
      id: v.id, seq: i + 1, doctorId: v.clientId, doctorName: v.clientName, label: VISIT_STATUS_LABELS[v.status as ClientVisitStatus], status: v.status,
      verificationStatus: v.verificationStatus, cabinet: v.place,
      events: v.events.map((e) => ({ ...e, atLabel: fmtTime(e.at) })),
    }));
    const places = positions ? await placesToValidate([userId]) : [];
    const mapPlaces: MapCabinet[] = [
      ...dayVisits.filter((v) => v.place).map((v) => ({ doctorId: v.clientId, name: v.clientName, lat: v.place!.lat, lng: v.place!.lng, validated: v.place!.validated })),
      ...places.map((p) => ({ doctorId: p.id, name: p.name, lat: p.lat, lng: p.lng, validated: false })),
    ];
    const done = visits.filter((v) => v.status === "EFFECTUEE" && (settings.crm.countedKinds as string[]).includes(v.kind));
    const p = detail.progress;
    return (
      <>
        <PageHeader
          eyebrow={teamView ? <Link href={q({ user: null, day: null })} className="hover:underline">Suivi des visites</Link> : "Mes visites"}
          title={detail.name}
          subtitle={`${detail.clients.length} client(s) en portefeuille · ${Math.round(detail.elapsedPct)} % du mois écoulé`}
          actions={monthNav}
        />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Card><div className="label">Visites du mois</div><div className="mt-2"><Bar p={p} elapsed={detail.elapsedPct} /></div><div className={`mt-2 text-[12px] font-medium ${detail.pace.kind === "EN_RETARD" ? "text-red" : detail.pace.kind === "ATTEINT" ? "text-green" : "text-ink-2"}`}>{detail.pace.label}</div></Card>
          <Kpi label="Clients pas encore visités" value={String(p.notVisited)} sub={`sur ${p.followed} suivis`} />
          <Kpi label="Visites effectuées" value={String(done.length)} sub={`${done.filter((v) => !v.inPortfolio).length} hors portefeuille · ${visits.filter((v) => v.status === "NON_EFFECTUEE").length} non effectuée(s)`} />
          <Kpi label="Sans fréquence" value={String(p.undefinedFrequency)} sub="hors progression" href={`/clients/portefeuilles?manager=${userId}&frequency=none`} />
        </div>

        <Section title="Par ville"><CityTable rows={detail.byCity} elapsed={detail.elapsedPct} /></Section>

        <Section title="Clients du portefeuille" description="Visites comptées plafonnées à la fréquence ; objectif = CA HT sell-in du mois.">
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Client</th><th>Ville</th><th className="num">Fréquence</th><th className="num">Visites</th><th>Dernière visite</th><th>Prochaine</th><th>Objectif du mois</th><th>Commande</th></tr></thead>
              <tbody>
                {detail.clients.map((c) => {
                  const h = headlineObjective(c.objective);
                  return (
                    <tr key={c.id}>
                      <td><Link href={`/clients/${c.id}?tab=crm`} className="font-medium hover:underline">{c.name}</Link></td>
                      <td className="text-muted">{c.city ?? "—"}</td>
                      <td className="num">{c.frequency ?? <span className="text-faint">—</span>}</td>
                      <td className={`num font-medium ${c.frequency && c.remaining === 0 ? "text-green" : c.frequency && !c.doneThisMonth ? "text-red" : ""}`}>{c.doneThisMonth}{c.frequency ? `/${c.frequency}` : ""}</td>
                      <td>{c.lastVisit ? fmtDate(c.lastVisit) : <span className="text-faint">jamais</span>}</td>
                      <td>{c.nextPlanned ? fmtDate(c.nextPlanned) : "—"}</td>
                      <td>{h ? <span>{fmtMAD(h.realized, { compact: true })} / {fmtMAD(h.target, { compact: true })} <Badge tone={h.verdict === "ATTEINT" ? "green" : h.verdict === "EN_RETARD" ? "red" : "gray"}>{OBJECTIVE_VERDICT_LABELS[h.verdict]}</Badge></span> : <span className="text-faint">aucun</span>}</td>
                      <td>{c.daysUntilNextOrder !== null && c.daysUntilNextOrder < 0 ? <span className="text-red">retard {-c.daysUntilNextOrder} j</span> : c.lastOrder ? <span className="text-muted">{fmtDate(c.lastOrder)}</span> : "—"}</td>
                    </tr>
                  );
                })}
                {!detail.clients.length && <tr><td colSpan={8} className="text-center text-muted py-6">Aucun client confié. <Link href="/clients/portefeuilles" className="text-accent">Affecter des clients →</Link></td></tr>}
              </tbody>
            </table>
          </div>
        </Section>

        {positions && (
          <Section title="Carte et contrôle de présence" description="Démarrages et fins de visite d'une journée ; positions des points de vente à valider." action={days.length > 1 ? (
            <form className="flex items-center gap-2 text-[13px]"><input type="hidden" name="user" value={userId} /><input type="hidden" name="month" value={month} />
              <select name="day" defaultValue={mapDay ?? ""} className="select h-8">{days.map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}</select><button className="btn-secondary btn-sm">Afficher</button>
            </form>) : undefined}>
            {mapDay || mapPlaces.length ? <Card><FieldMap visits={mapVisits} cabinets={mapPlaces} editable kind="crm" validatePlace={validatePositionAction} /></Card>
              : <Card><div className="text-[13px] text-muted">Aucune visite géolocalisée ce mois.</div></Card>}
          </Section>
        )}

        <Section title={`Visites de ${monthLabel(month)}`}>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Date</th><th>Client</th><th>Type</th><th>Statut</th><th>Horaires</th><th>Résultat</th>{positions && <th>Contrôle</th>}</tr></thead>
              <tbody>
                {visits.map((v) => (
                  <tr key={v.id}>
                    <td><Link href={`/clients/visites/${v.id}`} className="hover:underline">{fmtDate(v.date)}</Link></td>
                    <td className="font-medium">{v.clientName}{!v.inPortfolio && <span className="text-[11px] text-faint"> · hors portefeuille</span>}</td>
                    <td className="text-muted">{VISIT_KIND_LABELS[v.kind as ClientVisitKind]}</td>
                    <td><Badge tone={v.status === "EFFECTUEE" ? "green" : v.status === "NON_EFFECTUEE" ? "orange" : "blue"}>{VISIT_STATUS_LABELS[v.status as ClientVisitStatus]}</Badge>{v.reportStatus === "A_COMPLETER" && <span className="ml-1 text-[11px] text-orange">CR à faire</span>}</td>
                    <td className="text-muted tabular-nums">{v.startedAt ? `${fmtTime(v.startedAt)} → ${fmtTime(v.endedAt)}${v.autoClosed ? " (auto)" : v.durationMinutes !== null ? ` · ${v.durationMinutes} min` : ""}` : v.status === "NON_EFFECTUEE" ? v.notDoneReason ?? "" : "—"}</td>
                    <td className="text-muted">{v.result ?? "—"}</td>
                    {positions && <td>{v.timingSource === "CHRONO" ? <span title={v.verificationReasons.join("\n")}><Badge tone={VERIF_TONE[v.verificationStatus]}>{VERIFICATION_LABELS[v.verificationStatus as VerificationStatus]}</Badge></span> : <span className="text-faint text-[12px]">hors contrôle</span>}</td>}
                  </tr>
                ))}
                {!visits.length && <tr><td colSpan={positions ? 7 : 6} className="text-center text-muted py-6">Aucune visite ce mois.</td></tr>}
              </tbody>
            </table>
          </div>
        </Section>
      </>
    );
  }

  /* ---------------------------- Vue équipe ---------------------------- */
  const [team, users] = await Promise.all([teamOverview(viewer, month, t, settings, { city: sp.city ?? null }), crmUsers()]);
  const cities = [...new Set(team.byCity.map((c) => c.city))].sort();
  return (
    <>
      <PageHeader
        title="Suivi des visites"
        subtitle="Visites commerciales par commerciale et par ville : fréquence attendue, progression du mois, objectifs clients."
        actions={monthNav}
      />
      {!users.length ? (
        <Empty
          title="Aucun portefeuille commercial pour l'instant"
          hint={<>Le suivi démarre quand des clients sont confiés à une commerciale (commercial attitré) avec une fréquence de visite. Ouvrez <Link href="/clients/portefeuilles" className="text-accent">Clients → Portefeuilles</Link> : la reprise propose le commercial de chaque client d&apos;après les affectations actuelles des droits.</>}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Card><div className="label">Visites du mois (équipe)</div><div className="mt-2"><Bar p={team.totals} elapsed={team.elapsedPct} /></div><div className="mt-2 text-[12px] text-muted">{Math.round(team.elapsedPct)} % du mois écoulé</div></Card>
            <Kpi label="Clients suivis" value={String(team.totals.followed)} sub={`${team.totals.notVisited} pas encore visités`} />
            <Kpi label="Sans fréquence définie" value={String(team.totals.undefinedFrequency)} sub="hors progression" href="/clients/portefeuilles?frequency=none" />
            {team.unassigned !== null ? <Kpi label="Clients sans commercial" value={String(team.unassigned)} sub="à affecter" href="/clients/portefeuilles?manager=none" /> : <Kpi label="Commerciales suivies" value={String(team.rows.length)} />}
          </div>

          <form className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
            <input type="hidden" name="month" value={month} />
            <select name="city" defaultValue={sp.city ?? ""} className="select h-9 w-56"><option value="">Toutes les villes</option>{cities.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            <button className="btn-secondary btn-sm">Filtrer</button>
            {sp.city && <Link href={q({ city: null })} className="text-[12px] text-muted underline">Effacer</Link>}
          </form>

          <Section title="Par commerciale" description="Trié par progression croissante : les portefeuilles en retard en tête.">
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Commerciale</th><th className="num">Clients</th><th>Visites du mois</th><th>Rythme</th><th className="num">Pas visités</th><th className="num">Effectuées</th><th className="num">Non eff.</th><th className="num">Appels / msg</th><th className="num">Cmd en visite</th><th>Objectifs clients</th>{team.rows.some((r) => r.verification) && <th>Contrôle</th>}</tr></thead>
                <tbody>
                  {team.rows.map((r) => (
                    <tr key={r.userId}>
                      <td><Link href={q({ user: r.userId })} className="font-medium hover:underline">{r.name}</Link></td>
                      <td className="num">{r.clients}</td>
                      <td><Bar p={r.progress} elapsed={team.elapsedPct} /></td>
                      <td><Badge tone={PACE_TONE[r.pace.kind]}>{r.pace.kind === "EN_RETARD" ? r.pace.label : r.pace.kind === "ATTEINT" ? "Atteint" : r.pace.kind === "NON_MESURABLE" ? "—" : "Dans le rythme"}</Badge></td>
                      <td className="num">{r.progress.notVisited}</td>
                      <td className="num">{r.visitsDone}{r.visitsOutside ? <span className="text-[11px] text-faint"> (+{r.visitsOutside} hors)</span> : null}</td>
                      <td className="num">{r.notDone}</td>
                      <td className="num">{r.contacts}</td>
                      <td className="num">{r.ordersInVisits}</td>
                      <td>{r.objectivesDefined ? <span className="text-[12.5px]">{r.objectivesReached}/{r.objectivesDefined} atteints{r.objectivesLate ? <span className="text-red"> · {r.objectivesLate} en retard</span> : null}</span> : <span className="text-faint text-[12px]">aucun</span>}</td>
                      {team.rows.some((x) => x.verification) && <td className="text-[12px]">{r.verification ? <>{r.verification.verified} ✓{r.verification.toCheck ? <span className="text-orange"> · {r.verification.toCheck} à vérifier</span> : null}{r.verification.notVerified ? <span className="text-red"> · {r.verification.notVerified} sans position</span> : null}</> : "—"}</td>}
                    </tr>
                  ))}
                  {!team.rows.length && <tr><td colSpan={11} className="text-center text-muted py-6">Aucune activité ce mois{sp.city ? " dans cette ville" : ""}.</td></tr>}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Par ville" description="Tous les portefeuilles visibles, par ville du client."><CityTable rows={team.byCity} elapsed={team.elapsedPct} /></Section>
          <p className="text-[12px] text-faint">« Commandes en visite » : commandes saisies par la commerciale chez le client pendant la visite (déduit, seul lien mesuré entre une visite et une commande). Une hausse des ventes après des visites reste une corrélation observée.</p>
        </>
      )}
    </>
  );
}
