"use client";

import { Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { VisitDay } from "@/components/medical/visit-day";
import { capturePosition } from "@/lib/medical/field-client";
import { useMobile } from "./mobile-app";
import { NoData, Skeleton } from "./mobile-shell";

const reportHref = (visitId: string) => `/m/compte-rendu?visit=${visitId}`;

function Body() {
  const { phase, snapshot, refresh } = useMobile();
  const router = useRouter();
  const params = useSearchParams();
  const accept = useCallback(async () => {
    const m = snapshot?.medical;
    if (m) void capturePosition(m.day.gpsTimeoutS);
    await fetch("/api/m/notice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "MEDICAL" }) }).catch(() => null);
    refresh();
  }, [snapshot, refresh]);

  if (phase === "LOADING") return <Skeleton />;
  const m = snapshot?.medical;
  if (!m) return <NoData />;
  return (
    <VisitDay
      data={{ ...m.day, preselectDoctorId: params.get("doctor"), flash: params.get("done") ? "Compte rendu enregistré sur le téléphone." : null }}
      acceptNotice={accept}
      reportHref={reportHref}
      onChanged={refresh}
      onStoppedOffline={(e) => router.push(`/m/compte-rendu?${new URLSearchParams(e.visitId ? { visit: e.visitId, doctor: e.doctorId, name: e.doctorName } : { ref: e.startRef, doctor: e.doctorId, name: e.doctorName })}`)}
    />
  );
}

/** Tournée du jour de la déléguée : l'écran existant de chronométrage, alimenté par le téléphone. */
export function TourneeScreen() {
  return <Suspense fallback={<Skeleton />}><Body /></Suspense>;
}
