import * as XLSX from "xlsx";
import { requireFlag } from "@/lib/access";
import { requireFieldControl } from "@/lib/medical/field-access";
import { fieldDelegates, fieldVisits } from "@/lib/medical/field-report";
import { businessDay } from "@/lib/medical/chrono";
import { VERIFICATION_LABELS, mapsUrl } from "@/lib/medical/gps-shared";
import { fmtTime } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Export Excel du suivi terrain : une ligne par visite, mêmes filtres et même portée que la page. */
export async function GET(req: Request) {
  const { scope } = await requireFieldControl();
  await requireFlag("exportData");
  const u = new URL(req.url).searchParams;
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const from = ymd.test(u.get("from") ?? "") ? u.get("from")! : businessDay(new Date());
  const to = ymd.test(u.get("to") ?? "") ? u.get("to")! : from;
  const delegates = await fieldDelegates(scope);
  const delegateId = delegates.some((d) => d.id === u.get("delegate")) ? u.get("delegate") : null;
  const visits = await fieldVisits(scope, { delegateId, from, to });
  const data = visits.map((v) => {
    const start = v.events.find((e) => e.type === "START" || e.type === "NON_EFFECTUEE");
    const stop = [...v.events].reverse().find((e) => e.type === "STOP");
    return {
      Date: v.date,
      Déléguée: v.delegateName ?? "",
      Médecin: `Dr ${v.doctorName}`,
      Ville: v.doctorCity ?? "",
      Statut: v.status === "REALISEE" ? "Réalisée" : v.status === "NON_EFFECTUEE" ? "Non effectuée" : v.status === "EN_COURS" ? "En cours" : v.status,
      "Motif non effectuée": v.notDoneReason ?? "",
      Début: v.startedAt ? fmtTime(v.startedAt) : "",
      Fin: v.endedAt ? fmtTime(v.endedAt) : "",
      "Durée (min)": v.durationMinutes ?? "",
      "Clôture automatique": v.autoClosed ? "oui" : "",
      "Synchronisée en différé": v.syncedLate ? "oui" : "",
      "Distance au cabinet début (m)": start?.distanceM ?? "",
      "Précision début (m)": start?.accuracyM ?? "",
      "Distance au cabinet fin (m)": stop?.distanceM ?? "",
      "Précision fin (m)": stop?.accuracyM ?? "",
      "Cabinet validé": v.cabinet ? (v.cabinet.validated ? "oui" : "à valider") : "inconnu",
      Contrôle: VERIFICATION_LABELS[v.verificationStatus] ?? v.verificationStatus,
      Motifs: v.reasons.join(" | "),
      "Lien début": start?.lat != null ? mapsUrl({ lat: start.lat, lng: start.lng! }) : "",
      "Lien fin": stop?.lat != null ? mapsUrl({ lat: stop.lat, lng: stop.lng! }) : "",
      "Compte rendu": v.reportStatus === "VALIDE" ? "validé" : v.reportStatus === "A_COMPLETER" ? "à compléter" : "",
    };
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Visites");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="COMANET-suivi-terrain-${from}_${to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
