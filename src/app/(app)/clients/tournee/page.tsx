import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, clientFilter, canDo } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { fmtTime, iso, today } from "@/lib/format";
import { pgArray } from "@/lib/sql-array";
import { portfolioOf, tourSuggestions } from "@/lib/crm/portfolio";
import { headlineObjective } from "@/lib/crm/objectives";
import { monthOf, monthLabel } from "@/lib/crm/portfolio-shared";
import { autoCloseStaleClientVisitsQuietly, hasAcceptedCrmGpsNotice, runningClientVisitOf } from "@/lib/crm/visits";
import { TourDay, type TourData } from "@/components/crm/tour-day";
import { Empty } from "@/components/ui";
import { acceptCrmNoticeAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ma tournée" };

/**
 * Écran de la commerciale (mobile) : progression des visites du mois sur son portefeuille, clients à voir en
 * priorité (raisons mesurées), visites planifiées, chrono de visite (Démarrer / Terminer / non effectuée),
 * comptes rendus à compléter.
 */
export default async function TourPage(props: { searchParams: Promise<{ client?: string; done?: string }> }) {
  const user = await requireAccess("clients");
  const sp = await props.searchParams;
  if (!(await canDo("clients", "create"))) {
    return <Empty title="Ma tournée est réservée aux commerciaux" hint="Il faut le droit « Créer » sur Clients pour enregistrer des visites. Le suivi des visites de l'équipe est dans Clients → Suivi des visites." />;
  }
  await autoCloseStaleClientVisitsQuietly();
  const settings = await getSettings();
  const day = iso(today());
  const month = monthOf(day);
  const scope = await clientFilter();

  const [accepted, running, portfolio, plannedRes, doneRes, todoRes, othersRes] = await Promise.all([
    hasAcceptedCrmGpsNotice(user.id),
    runningClientVisitOf(user.id),
    portfolioOf(user.id, month, day, settings),
    db.execute<{ id: string; client_id: string; name: string; city: string | null }>(sql`
      select v.id, v.client_id, c.name, c.city from client_visits v join clients c on c.id = v.client_id
      where v.user_id = ${user.id}::uuid and v.status = 'PLANIFIEE' and v.date = ${day}::date order by c.name`),
    db.execute<{ id: string; name: string; kind: string; status: string; started_at: string | null; ended_at: string | null; duration_minutes: number | null; report_status: string | null; not_done_reason: string | null; auto_closed: boolean; timing_source: string }>(sql`
      select v.id, c.name, v.kind, v.status, v.started_at, v.ended_at, v.duration_minutes, v.report_status, v.not_done_reason, v.auto_closed, v.timing_source
      from client_visits v join clients c on c.id = v.client_id
      where v.user_id = ${user.id}::uuid and v.date = ${day}::date and v.status in ('EFFECTUEE', 'NON_EFFECTUEE')
      order by coalesce(v.started_at, v.ended_at, v.created_at)`),
    db.execute<{ id: string; name: string; date: string }>(sql`
      select v.id, c.name, v.date::text as date from client_visits v join clients c on c.id = v.client_id
      where v.user_id = ${user.id}::uuid and v.report_status = 'A_COMPLETER' and v.date < ${day}::date order by v.date desc limit 20`),
    db.execute<{ id: string; name: string; city: string | null }>(sql`
      select c.id, c.name, c.city from clients c
      where c.active and (c.account_manager_id is distinct from ${user.id}::uuid) ${scope ? (scope.length ? sql`and c.id = any(${pgArray(scope)})` : sql`and false`) : sql``}
      order by c.name limit 2000`),
  ]);

  const suggestions = tourSuggestions(portfolio, day, settings.crm);
  const data: TourData = {
    day,
    monthLabel: monthLabel(month),
    accepted,
    gpsTimeoutS: settings.crm.gpsTimeoutS,
    running,
    progress: portfolio.progress,
    pace: { kind: portfolio.pace.kind, label: portfolio.pace.label },
    elapsedPct: portfolio.elapsedPct,
    byCity: portfolio.byCity.map((c) => ({ city: c.city, expected: c.progress.expected, counted: c.progress.counted, pct: c.progress.pct, clients: c.clients })),
    suggestions: suggestions.map((s) => ({ clientId: s.clientId, name: s.name, city: s.city, reasons: s.reasons, plannedVisitId: portfolio.clients.find((c) => c.id === s.clientId)?.plannedToday ?? null })),
    // Une visite planifiée déjà proposée en priorité n'est pas répétée dans la liste du jour.
    planned: plannedRes.rows.filter((p) => !suggestions.some((s) => s.clientId === p.client_id)).map((p) => ({ visitId: p.id, clientId: p.client_id, clientName: p.name, city: p.city })),
    clients: portfolio.clients.map((c) => {
      const h = headlineObjective(c.objective);
      return {
        id: c.id, name: c.name, city: c.city, type: c.type, frequency: c.frequency, done: c.doneThisMonth, remaining: c.remaining,
        lastVisit: c.lastVisit, nextPlanned: c.nextPlanned, plannedToday: c.plannedToday,
        overdueDays: c.daysUntilNextOrder !== null && c.daysUntilNextOrder < 0 ? -c.daysUntilNextOrder : null,
        objective: h ? { pct: h.pct, verdict: h.verdict } : null, stockStale: c.stockAging === "stale",
      };
    }),
    others: othersRes.rows,
    done: doneRes.rows.map((v) => ({
      visitId: v.id, clientName: v.name, kind: v.kind, status: v.status, startLabel: fmtTime(v.started_at), endLabel: fmtTime(v.ended_at),
      durationMinutes: v.duration_minutes, reportStatus: v.report_status, notDoneReason: v.not_done_reason, autoClosed: v.auto_closed, manual: v.timing_source !== "CHRONO",
    })),
    toComplete: todoRes.rows.map((v) => ({ visitId: v.id, clientName: v.name, date: v.date })),
    preselectClientId: sp.client ?? null,
    flash: sp.done === "report" ? "Compte rendu enregistré. Merci !" : sp.done === "contact" ? "Contact enregistré." : sp.done === "planned" ? "Visite planifiée." : null,
  };
  return <TourDay data={data} acceptNotice={acceptCrmNoticeAction} />;
}
