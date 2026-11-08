"use client";

import Link from "next/link";
import { useMobile } from "./mobile-app";
import { NoData, Skeleton } from "./mobile-shell";

const frDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Ses dernières visites, et ce qu'il reste à compléter. */
export function HistoriqueScreen() {
  const { phase, snapshot } = useMobile();
  const m = snapshot?.medical ?? null;
  if (phase === "LOADING") return <Skeleton />;
  if (!m) return <NoData />;
  return (
    <div className="space-y-3">
      <h1 className="text-[20px] font-semibold text-ink">Historique</h1>
      {m.history.length === 0 && <p className="card p-4 text-[14px] text-muted">Aucune visite terminée pour l&apos;instant. Elles s&apos;afficheront ici dès la première.</p>}
      <ul className="space-y-2">
        {m.history.map((v) => (
          <li key={v.visitId} className="card px-3 py-2 min-h-[60px] flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[14.5px] font-medium text-ink truncate">Dr {v.doctorName}</div>
              <div className="text-[12.5px] text-muted">{frDate(v.date)} · {v.status === "NON_EFFECTUEE" ? "Non effectuée" : "Réalisée"}</div>
            </div>
            {v.reportStatus === "A_COMPLETER" && <Link href={`/m/compte-rendu?visit=${v.visitId}`} prefetch={false} className="btn-primary h-11 px-3 text-[13px] shrink-0">Compte rendu</Link>}
            {v.reportStatus === "VALIDE" && <span className="text-[12.5px] text-green shrink-0">Compte rendu ✓</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
