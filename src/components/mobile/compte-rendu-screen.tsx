"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MedicalVisitForm } from "@/components/medical-visit-form";
import { readRef } from "@/lib/mobile/outbox";
import type { DoctorBrief } from "@/lib/medical/prescriptions";
import { localDay } from "./stock-editor";
import { useMobile } from "./mobile-app";
import { NoData, Skeleton } from "./mobile-shell";

function Body() {
  const params = useSearchParams();
  const router = useRouter();
  const { phase, snapshot, submit } = useMobile();
  const m = snapshot?.medical ?? null;
  const visitId = params.get("visit");
  const startRef = params.get("ref");

  const context = useMemo(() => {
    const planned = m?.day.toComplete.find((v) => v.visitId === visitId) ?? m?.day.done.find((v) => v.visitId === visitId) ?? m?.history.find((v) => v.visitId === visitId);
    return {
      doctorId: params.get("doctor") ?? "",
      doctorName: params.get("name") ?? planned?.doctorName ?? "",
    };
  }, [m, visitId, params]);

  const [suggested, setSuggested] = useState<string[]>([]);
  useEffect(() => {
    if (!snapshot || !context.doctorId) return;
    let stale = false;
    void readRef<DoctorBrief>(snapshot.user.id, `doctor:${context.doctorId}`).catch(() => null).then((b) => {
      if (stale || !b?.prescriptions) return;
      setSuggested([...b.prescriptions.recommendations.items.map((r) => r.productId), ...b.prescriptions.products.slice(0, 5).map((p) => p.productId)]);
    });
    return () => { stale = true; };
  }, [snapshot, context.doctorId]);

  if (phase === "LOADING") return <Skeleton />;
  if (!m) return <NoData />;
  if (!visitId && !startRef) return <NoData />;

  async function save(fd: FormData) {
    const fields = [...fd.entries()].filter((e): e is [string, string] => typeof e[1] === "string");
    await submit("VISIT_REPORT", { visitId, startRef, fields }, `Compte rendu — Dr ${context.doctorName || "visite"}`);
    router.push("/m/tournee?done=1");
  }

  return (
    <div className="space-y-3">
      <h1 className="text-[20px] font-semibold text-ink">Compte rendu{context.doctorName ? ` — Dr ${context.doctorName}` : ""}</h1>
      <div className="card p-4">
        <MedicalVisitForm
          mode="report"
          action={save}
          doctors={context.doctorId ? [{ id: context.doctorId, name: context.doctorName, city: null }] : []}
          products={m.products}
          suggestedProductIds={suggested}
          today={localDay()}
          submitLabel="Valider le compte rendu"
          initial={{ id: visitId ?? undefined, doctorId: context.doctorId, date: localDay(), visitType: "VISITE" }}
        />
      </div>
    </div>
  );
}

/** Compte rendu après « Terminer » : le formulaire existant, enregistré sur le téléphone, envoyé dès que le réseau revient. */
export function CompteRenduScreen() {
  return <Suspense fallback={<Skeleton />}><Body /></Suspense>;
}
