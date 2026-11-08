"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Play } from "lucide-react";
import { BriefView } from "@/components/medical/brief-view";
import { readRef } from "@/lib/mobile/outbox";
import type { DoctorBrief } from "@/lib/medical/prescriptions";
import { loadDoctorBrief, useMobile } from "./mobile-app";
import { Skeleton } from "./mobile-shell";

function Body() {
  const id = useSearchParams().get("id") ?? "";
  const { phase, snapshot, online } = useMobile();
  const uid = snapshot?.user.id ?? null;
  const [brief, setBrief] = useState<DoctorBrief | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!uid || !id) return;
    let stale = false;
    void readRef<DoctorBrief>(uid, `doctor:${id}`).catch(() => null).then((local) => { if (!stale && local) setBrief(local); });
    void loadDoctorBrief(uid, id).then((b) => {
      if (stale) return;
      if (b) setBrief(b);
      setLoaded(true);
    });
    return () => { stale = true; };
  }, [uid, id]);

  if (phase === "LOADING") return <Skeleton />;
  const doctor = snapshot?.medical?.day.doctors.find((d) => d.id === id);
  const name = brief?.doctor.name ?? doctor?.name;
  const back = <Link href="/m/medecins" prefetch={false} className="min-h-11 inline-flex items-center gap-1 text-[13.5px] text-muted"><ArrowLeft size={16} /> Médecins</Link>;
  if (!name) return <div className="space-y-3">{back}{loaded ? <p className="card p-5 text-center text-[14px] text-muted">{online ? "Ce médecin n'est pas dans vos secteurs." : "Cette fiche n'est pas encore sur ce téléphone."}</p> : <Skeleton />}</div>;
  return (
    <div className="space-y-3">
      {back}
      <header>
        <h1 className="text-[20px] font-semibold text-ink">Dr {name}</h1>
        <p className="text-[13.5px] text-muted">{[brief?.doctor.specialty, brief?.doctor.city ?? doctor?.city].filter(Boolean).join(" · ") || "—"}</p>
      </header>
      <Link href={`/m/tournee?doctor=${id}`} prefetch={false} className="btn-primary w-full h-12 text-[15px]"><Play size={16} /> Démarrer une visite</Link>
      {brief ? <div className="card p-4"><BriefView brief={brief} /></div> : loaded && <p className="card p-4 text-[13.5px] text-muted">Fiche indisponible sans réseau : ouvrez-la une première fois avec du réseau.</p>}
    </div>
  );
}

/** Fiche médecin : potentiel, ordonnances observées et produits à présenter, lisibles sans réseau. */
export function FicheMedecinScreen() {
  return <Suspense fallback={<Skeleton />}><Body /></Suspense>;
}
