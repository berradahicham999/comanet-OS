import * as XLSX from "xlsx";
import { requireAccess, requireFlag } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { iso, today, fmtTime } from "@/lib/format";
import { crmViewer, canSeeUser, canSeePositions } from "@/lib/crm/access";
import { teamOverview, commercialDetail, crmUsers, visitsOfMonth } from "@/lib/crm/portfolio";
import { headlineObjective } from "@/lib/crm/objectives";
import { monthOf, parseMonth, OBJECTIVE_VERDICT_LABELS } from "@/lib/crm/portfolio-shared";
import { VISIT_KIND_LABELS, VISIT_STATUS_LABELS, type ClientVisitKind, type ClientVisitStatus } from "@/lib/crm/visits-shared";
import { VERIFICATION_LABELS, type VerificationStatus } from "@/lib/medical/gps-shared";

export const dynamic = "force-dynamic";

/** Export Excel du suivi des visites d'un mois : synthèse par commerciale, portefeuilles, visites. */
export async function GET(req: Request) {
  await requireAccess("clients");
  await requireFlag("exportData");
  const viewer = await crmViewer();
  if (!viewer) return new Response("Session expirée", { status: 401 });
  const u = new URL(req.url).searchParams;
  const t = iso(today());
  const month = parseMonth(u.get("month"), monthOf(t));
  const settings = await getSettings();
  const only = u.get("user");
  const userIds = (only && canSeeUser(viewer, only) ? [only] : (await crmUsers()).map((x) => x.id).filter((id) => canSeeUser(viewer, id)));
  const wb = XLSX.utils.book_new();

  if (!only) {
    const team = await teamOverview(viewer, month, t, settings);
    const ws = XLSX.utils.json_to_sheet(team.rows.map((r) => ({
      Commerciale: r.name, Clients: r.clients, "Clients suivis": r.progress.followed, "Visites attendues": r.progress.expected, "Visites comptées": r.progress.counted,
      "Progression (%)": r.progress.pct === null ? "" : Math.round(r.progress.pct), Rythme: r.pace.label, "Pas encore visités": r.progress.notVisited,
      "Visites effectuées": r.visitsDone, "Dont hors portefeuille": r.visitsOutside, "Non effectuées": r.notDone, "Appels / messages": r.contacts,
      "Commandes en visite": r.ordersInVisits, "Objectifs définis": r.objectivesDefined, "Objectifs atteints": r.objectivesReached, "Objectifs en retard": r.objectivesLate,
    })));
    XLSX.utils.book_append_sheet(wb, ws, "Par commerciale");
    const wc = XLSX.utils.json_to_sheet(team.byCity.map((c) => ({ Ville: c.city, Clients: c.clients, Suivis: c.progress.followed, "Visites attendues": c.progress.expected, "Visites comptées": c.progress.counted, "Progression (%)": c.progress.pct === null ? "" : Math.round(c.progress.pct), "Pas encore visités": c.progress.notVisited })));
    XLSX.utils.book_append_sheet(wb, wc, "Par ville");
  }

  const portfolioRows: Record<string, unknown>[] = [];
  for (const id of userIds) {
    const d = await commercialDetail(viewer, id, month, t, settings);
    if (!d) continue;
    for (const c of d.clients) {
      const h = headlineObjective(c.objective);
      portfolioRows.push({
        Commerciale: d.name, Client: c.name, Ville: c.city ?? "", Type: c.type, "Fréquence / mois": c.frequency ?? "non définie", "Visites du mois": c.doneThisMonth,
        "Restant": c.remaining, "Dernière visite": c.lastVisit ?? "", "Prochaine visite": c.nextPlanned ?? "",
        "Objectif du mois (HT)": h ? Math.round(h.target) : "", "Réalisé (HT)": h ? Math.round(h.realized) : "", "Objectif": h ? OBJECTIVE_VERDICT_LABELS[h.verdict] : "aucun",
        "Retard de commande (j)": c.daysUntilNextOrder !== null && c.daysUntilNextOrder < 0 ? -c.daysUntilNextOrder : "",
      });
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(portfolioRows), "Portefeuilles");

  const visits = (await Promise.all(userIds.map((id) => visitsOfMonth([id], month, { withPositions: canSeePositions(viewer, id) })))).flat();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(visits.map((v) => ({
    Date: v.date, Commerciale: v.userName ?? "", Client: v.clientName, Ville: v.city ?? "", Type: VISIT_KIND_LABELS[v.kind as ClientVisitKind], Statut: VISIT_STATUS_LABELS[v.status as ClientVisitStatus],
    Démarrage: v.startedAt ? fmtTime(v.startedAt) : "", Fin: v.endedAt ? fmtTime(v.endedAt) : "", "Durée (min)": v.durationMinutes ?? "", Résultat: v.result ?? "", "Motif non effectuée": v.notDoneReason ?? "",
    "Hors portefeuille": v.inPortfolio ? "" : "oui", Contrôle: v.timingSource === "CHRONO" && v.verificationStatus !== "HORS_CONTROLE" ? VERIFICATION_LABELS[v.verificationStatus as VerificationStatus] : "",
  }))), "Visites");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="COMANET-visites-${month}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
