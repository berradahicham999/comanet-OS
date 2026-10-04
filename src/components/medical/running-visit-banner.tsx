"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Timer } from "lucide-react";
import { fieldQueue, fmtElapsed } from "@/lib/medical/field-client";

/**
 * Bandeau persistant tant qu'une visite est en cours : connu du serveur, ou seulement du téléphone
 * (démarrage hors connexion pas encore envoyé). Survit au rechargement et à la fermeture de l'application.
 */
const KINDS = {
  medical: { href: "/medical/journee", event: "medical-running-change", prefix: "Dr " },
  crm: { href: "/clients/tournee", event: "crm-running-change", prefix: "" },
} as const;

/** `kind` : visite médicale (défaut) ou visite commerciale (CRM, Ma tournée). */
export function RunningVisitBanner({ server, kind = "medical" }: { server: { doctorName: string; startedAt: string } | null; kind?: "medical" | "crm" }) {
  const k = KINDS[kind];
  const pathname = usePathname();
  const [local, setLocal] = useState<{ doctorName: string; startedAtMs: number } | null>(null);
  const [checked, setChecked] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const read = () => fieldQueue(kind).getRunning().then((r) => { setLocal(r ? { doctorName: r.doctorName, startedAtMs: r.startedAtMs } : null); setChecked(true); }).catch(() => setChecked(true));
    read();
    window.addEventListener(k.event, read);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => { window.removeEventListener(k.event, read); clearInterval(t); };
  }, [kind, k.event]);

  if (pathname?.startsWith(k.href)) return null;
  // Le téléphone fait foi une fois lu (une fin hors connexion n'est pas encore connue du serveur).
  const v = checked ? local : server ? { doctorName: server.doctorName, startedAtMs: Date.parse(server.startedAt) } : null;
  if (!v) return null;
  return (
    <Link href={k.href} className="sticky top-0 z-40 mb-3 flex items-center gap-2 rounded-xl bg-ink text-white px-4 py-2.5 text-[13px] shadow">
      <Timer size={16} className="shrink-0" />
      <span className="flex-1 min-w-0 truncate">Visite en cours — {k.prefix}{v.doctorName}</span>
      <span className="tabular-nums font-semibold">{fmtElapsed(now - v.startedAtMs)}</span>
      <span className="underline shrink-0">Terminer</span>
    </Link>
  );
}
