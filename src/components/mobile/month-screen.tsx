"use client";

import Link from "next/link";
import { LogOut, Monitor } from "lucide-react";
import { fmtInt, fmtMad } from "@/lib/mobile/format";
import { useMobile } from "./mobile-app";
import { NoData, Skeleton } from "./mobile-shell";
import { Gap } from "./today-screen";

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="card p-3"><div className="text-[12px] text-muted">{label}</div><div className="text-[19px] font-semibold text-ink">{children}</div></div>;
}

/** Scorecard du mois. Le classement donne son rang, sans le détail des autres. */
export function MonthScreen() {
  const { phase, snapshot, logout, pending } = useMobile();
  if (phase === "LOADING") return <Skeleton />;
  const t = snapshot?.terrain;
  if (!t) return <NoData />;
  const m = t.month;
  return (
    <div className="space-y-4">
      <h1 className="text-[20px] font-semibold text-ink first-letter:uppercase">{m.label}</h1>

      <section className="card p-4 text-center">
        <div className="label">Mon classement</div>
        {m.rank === null ? <div className="text-[15px] text-muted mt-1">Pas encore de classement ce mois-ci.</div> : (
          <div className="text-[30px] font-semibold text-ink">{m.rank}<sup className="text-[15px]">{m.rank === 1 ? "re" : "e"}</sup> <span className="text-[15px] font-normal text-muted">sur {m.ranked}</span></div>
        )}
        <div className="text-[13px] text-muted">Score {m.score} / 100</div>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <Stat label="Unités vendues">{fmtInt(m.units)}</Stat>
        <Stat label="Objectif">{m.objectiveUnits === null ? "—" : fmtInt(m.objectiveUnits)}</Stat>
        <Stat label="Écart"><Gap value={m.gapUnits} /></Stat>
        <Stat label="Atteinte">{m.completionPct === null ? "—" : `${m.completionPct} %`}</Stat>
        <Stat label="Jours animés">{fmtInt(m.days)}</Stat>
        <Stat label="CA sell-out">{fmtMad(m.selloutRevenue)}</Stat>
      </section>

      {m.topProduct && <p className="text-[13.5px] text-ink-2">Votre meilleur produit : <b>{m.topProduct}</b></p>}

      <section className="pt-2 space-y-1">
        <Link href="/terrain/rapports" prefetch={false} className="min-h-12 flex items-center gap-2 text-[14px] text-muted"><Monitor size={17} /> Mes rapports et la version complète</Link>
        <button type="button" onClick={logout} className="min-h-12 flex items-center gap-2 text-[14px] text-muted"><LogOut size={17} /> Se déconnecter</button>
        {pending.length > 0 && <p className="text-[12.5px] text-orange">Vos saisies en attente restent sur ce téléphone et partiront à votre prochaine connexion.</p>}
      </section>
    </div>
  );
}
