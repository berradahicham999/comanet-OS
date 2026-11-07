"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MapPin, Share, ShieldCheck, Smartphone } from "lucide-react";
import { fmtInt } from "@/lib/mobile/format";
import { useMobile } from "./mobile-app";
import { NoData, Skeleton } from "./mobile-shell";

/** Écart à l'objectif : un chiffre signé, jamais estimé ; sans objectif, « — ». */
export function Gap({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted">—</span>;
  return <span className={value >= 0 ? "text-green" : "text-red"}>{value > 0 ? "+" : ""}{fmtInt(value)}</span>;
}

function GpsNotice() {
  const { acceptNotice, online } = useMobile();
  return (
    <section className="card p-4 space-y-2">
      <h2 className="font-semibold text-ink flex items-center gap-2 text-[15px]"><ShieldCheck size={17} /> Votre position à la saisie</h2>
      <p className="text-[13.5px] text-ink-2">Quand vous touchez <b>Enregistrer</b> une saisie de ventes, le téléphone enregistre votre position à cet instant précis. Il n&apos;y a <b>aucun suivi en continu</b> : entre deux saisies, votre position n&apos;est jamais lue.</p>
      <p className="text-[13.5px] text-ink-2">Elle confirme votre présence au point de vente et n&apos;est visible que par la direction. Si vous refusez, la saisie reste possible : elle est simplement signalée « sans position ».</p>
      <button type="button" disabled={!online} onClick={() => void acceptNotice()} className="btn-primary w-full h-12 text-[15px] disabled:opacity-50">J&apos;ai compris</button>
      {!online && <p className="text-[12.5px] text-muted">À confirmer quand vous aurez du réseau.</p>}
    </section>
  );
}

/** Dans le navigateur plutôt que dans l'app : on propose l'installation, une fois, sans bloquer. */
function InstallHint() {
  const [show, setShow] = useState(false);
  const [iphone, setIphone] = useState(false);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const id = setTimeout(() => {
      setIphone(/iPhone|iPad|iPod/i.test(navigator.userAgent));
      setShow(!standalone);
    }, 0);
    return () => clearTimeout(id);
  }, []);
  if (!show) return null;
  return (
    <a href="/app" className="card px-4 py-3 flex items-center gap-3 text-[13.5px]">
      {iphone ? <Share size={18} className="text-accent shrink-0" /> : <Smartphone size={18} className="text-accent shrink-0" />}
      <span>Installez l&apos;application sur votre téléphone : elle s&apos;ouvre plus vite et marche sans réseau.</span>
    </a>
  );
}

export function TodayScreen() {
  const { phase, snapshot } = useMobile();
  if (phase === "LOADING") return <Skeleton />;
  const t = snapshot?.terrain;
  if (!snapshot || !t) return <NoData />;
  const m = t.month;
  const pos = t.planned[0];
  const dayGap = m.dayObjectiveUnits === null ? null : t.todayUnits - m.dayObjectiveUnits;
  return (
    <div className="space-y-4">
      <h1 className="text-[20px] font-semibold text-ink">Bonjour {snapshot.user.name.split(" ")[0]}</h1>
      {!snapshot.gpsNoticeAccepted && <GpsNotice />}

      <section className="card p-4">
        <div className="label mb-1">Aujourd&apos;hui</div>
        {pos ? (
          <div className="flex items-start gap-2 text-[16px] font-semibold text-ink"><MapPin size={18} className="text-accent mt-0.5 shrink-0" /><span>{pos.clientName}{pos.city ? <span className="block text-[13px] font-normal text-muted">{pos.city}</span> : null}</span></div>
        ) : (
          <div className="text-[14px] text-muted">Aucune animation planifiée aujourd&apos;hui.</div>
        )}
        <Link href="/m/saisie" prefetch={false} className="btn-primary w-full h-14 text-[16px] mt-3">Saisir mes ventes</Link>
      </section>

      <section className="grid grid-cols-3 gap-2 text-center">
        <div className="card p-3"><div className="text-[11.5px] text-muted">Objectif du jour</div><div className="text-[20px] font-semibold text-ink">{m.dayObjectiveUnits === null ? "—" : fmtInt(m.dayObjectiveUnits)}</div></div>
        <div className="card p-3"><div className="text-[11.5px] text-muted">Réalisé</div><div className="text-[20px] font-semibold text-ink">{fmtInt(t.todayUnits)}</div></div>
        <div className="card p-3"><div className="text-[11.5px] text-muted">Écart</div><div className="text-[20px] font-semibold"><Gap value={dayGap} /></div></div>
      </section>
      <p className="text-[12px] text-muted -mt-2">Unités vendues. Objectif du jour = objectif du mois réparti sur ses jours (une moyenne).</p>

      <section className="card p-4">
        <div className="flex items-baseline justify-between">
          <span className="label">{m.label}</span>
          <Link href="/m/mois" prefetch={false} className="text-[13px] text-accent min-h-11 flex items-center">Mon mois</Link>
        </div>
        <div className="text-[15px] text-ink"><b className="text-[22px]">{fmtInt(m.units)}</b> {m.objectiveUnits === null ? "unités" : `/ ${fmtInt(m.objectiveUnits)} unités`}</div>
        {m.completionPct !== null && <div className="mt-2 h-2 rounded-full bg-sunk overflow-hidden"><div className="h-full bg-accent" style={{ width: `${Math.min(100, m.completionPct)}%` }} /></div>}
      </section>

      <InstallHint />
    </div>
  );
}
