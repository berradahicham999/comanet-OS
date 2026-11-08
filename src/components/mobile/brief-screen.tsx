"use client";

import Link from "next/link";
import { ChevronRight, SquareCheck, Zap } from "lucide-react";
import { MorningBrief } from "@/components/ai/morning-brief";
import { useMobile } from "./mobile-app";
import { NoData, Skeleton } from "./mobile-shell";

/** Écran d'ouverture de la direction : ce qui demande une décision, puis le brief du jour. */
export function BriefScreen() {
  const { phase, snapshot, online } = useMobile();
  const d = snapshot?.direction ?? null;
  if (phase === "LOADING") return <Skeleton />;
  if (!d) return <NoData />;
  const n = d.pendingValidations;
  return (
    <div className="space-y-3">
      <h1 className="text-[20px] font-semibold text-ink">Bonjour {snapshot!.user.name.split(" ")[0]}</h1>
      <Link href="/m/validations" prefetch={false} className="card px-4 min-h-[60px] flex items-center gap-3">
        <SquareCheck size={20} className="text-accent shrink-0" />
        <span className="flex-1 text-[15px] text-ink">{n ? `${n} décision${n > 1 ? "s" : ""} à prendre` : "Rien à valider"}</span>
        <ChevronRight size={17} className="text-faint" />
      </Link>
      <Link href="/actions" prefetch={false} className="card px-4 min-h-[60px] flex items-center gap-3">
        <Zap size={20} className="text-accent shrink-0" />
        <span className="flex-1 text-[15px] text-ink">Action Center</span>
        <ChevronRight size={17} className="text-faint" />
      </Link>
      {!online ? <p className="card p-4 text-[14px] text-muted">Le brief du jour demande du réseau.</p>
        : d.aiConfigured ? <MorningBrief initial={null} configured />
        : <p className="card p-4 text-[14px] text-muted">Le brief du jour demande la clé du copilote (ANTHROPIC_API_KEY), absente du serveur.</p>}
    </div>
  );
}
