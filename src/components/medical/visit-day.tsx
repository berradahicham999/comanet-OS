"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CloudOff, LoaderCircle, MapPin, Play, Search, Square, UserX, ChevronRight, ShieldCheck } from "lucide-react";
import { normKey } from "@/lib/import/normalize";
import {
  capturePosition, enqueue, flushQueue, getRunning, setRunning, queued, newId, fmtElapsed,
  type QueuedAction, type RunningVisit, type Fix,
} from "@/lib/medical/field-client";
import { GpsHelp } from "./gps-help";
import { LocationSetup, askLocationOnce } from "./location-setup";
import { PreVisitBrief } from "./pre-visit-brief";

export type DayData = {
  day: string;
  accepted: boolean;
  gpsTimeoutS: number;
  running: { visitId: string; doctorId: string; doctorName: string; startedAt: string; startRef: string | null } | null;
  planned: { visitId: string; doctorId: string; doctorName: string; city: string | null }[];
  done: {
    visitId: string; doctorName: string; status: string; startedAt: string | null; endedAt: string | null;
    /** Heures formatées par le serveur (`fmtTime`, fuseau de l'entreprise) : une seule définition de l'heure affichée. */
    startLabel: string; endLabel: string;
    durationMinutes: number | null; reportStatus: string | null; notDoneReason: string | null; autoClosed: boolean;
  }[];
  toComplete: { visitId: string; doctorName: string; date: string }[];
  doctors: { id: string; name: string; city: string | null; sector: string | null }[];
  preselectDoctorId: string | null;
  flash: string | null;
};

const NOT_DONE_REASONS = ["Médecin absent", "Cabinet fermé", "Médecin indisponible (trop d'attente)", "Refus de recevoir"];

export function VisitDay({ data, acceptNotice }: { data: DayData; acceptNotice: () => Promise<void> }) {
  const router = useRouter();
  const [running, setRunningState] = useState<RunningVisit | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<null | "gps" | "send">(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(data.flash);
  const [gpsDenied, setGpsDenied] = useState(false);
  const [query, setQuery] = useState("");
  const [notDoneFor, setNotDoneFor] = useState<null | { doctorId: string; doctorName: string; plannedVisitId?: string | null; running: boolean }>(null);
  const [reason, setReason] = useState(NOT_DONE_REASONS[0]);
  const [otherReason, setOtherReason] = useState("");

  const refreshPending = useCallback(async () => setPending((await queued()).length), []);

  /** Envoie la file ; renvoie la visite créée pour une action donnée, si elle est passée. */
  const flush = useCallback(async (watch?: string) => {
    const r = await flushQueue();
    await refreshPending();
    if (r.rejected.length) setError(r.rejected.map((x) => x.message).join(" "));
    // Un Démarrer refusé (visite déjà en cours ailleurs, médecin hors secteur) : on oublie la visite locale.
    const cur = await getRunning();
    if (cur && r.rejected.some((x) => x.clientEventId === cur.startRef)) {
      await setRunning(null);
      setRunningState(null);
    }
    for (const s of r.sent) {
      if (s.type === "START" && cur && cur.startRef === s.clientEventId && !cur.visitId) {
        const next = { ...cur, visitId: s.visitId };
        await setRunning(next);
        setRunningState(next);
      }
    }
    return { offline: r.offline, visitId: watch ? r.sent.find((s) => s.clientEventId === watch)?.visitId ?? null : null, rejected: watch ? r.rejected.find((x) => x.clientEventId === watch) ?? null : null };
  }, [refreshPending]);

  // Réconciliation au chargement : visite locale (hors connexion) et visite connue du serveur.
  useEffect(() => {
    (async () => {
      const local = await getRunning();
      const q = await queued();
      const s = data.running;
      const closingQueued = (ref: string | null) => !!ref && q.some((a) => a.startRef === ref && a.type !== "START");
      if (s && !closingQueued(s.startRef)) {
        const v: RunningVisit = { startRef: s.startRef ?? local?.startRef ?? newId(), visitId: s.visitId, doctorId: s.doctorId, doctorName: s.doctorName, startedAtMs: Date.parse(s.startedAt) };
        await setRunning(v);
        setRunningState(v);
      } else if (local && !s) {
        const startPending = q.some((a) => a.type === "START" && a.clientEventId === local.startRef);
        if (startPending) setRunningState(local);
        else await setRunning(null);
      } else {
        setRunningState(null);
      }
      setPending(q.length);
      if (q.length) flush();
    })();
  }, [data.running, flush]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    const onOnline = () => flush();
    window.addEventListener("online", onOnline);
    const retry = setInterval(() => { if (navigator.onLine) flush(); }, 30_000);
    // Production seulement : en développement les fichiers gardent le même nom et le cache masquerait les changements.
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => { clearInterval(t); clearInterval(retry); window.removeEventListener("online", onOnline); };
  }, [flush]);

  async function locate(): Promise<Fix> {
    setBusy("gps");
    const fix = await capturePosition(data.gpsTimeoutS);
    if ("error" in fix && fix.error === "REFUSE") setGpsDenied(true);
    return fix;
  }

  function fixFields(fix: Fix): Pick<QueuedAction, "lat" | "lng" | "accuracyM" | "gpsError"> {
    return "error" in fix ? { lat: null, lng: null, accuracyM: null, gpsError: fix.error } : { lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM, gpsError: null };
  }

  async function start(doctorId: string, doctorName: string, plannedVisitId?: string | null) {
    setError(null); setInfo(null);
    if (running) { setError(`Une visite est déjà en cours chez Dr ${running.doctorName}.`); return; }
    const fix = await locate();
    const deviceTime = new Date().toISOString();
    const a: QueuedAction = { clientEventId: newId(), type: "START", doctorId, plannedVisitId: plannedVisitId ?? null, deviceTime, label: doctorName, ...fixFields(fix) };
    const v: RunningVisit = { startRef: a.clientEventId, visitId: null, doctorId, doctorName, startedAtMs: Date.now() };
    await enqueue(a);
    await setRunning(v);
    setRunningState(v);
    setBusy("send");
    const r = await flush(a.clientEventId);
    setBusy(null);
    if (r.offline) setInfo("Pas de réseau : le démarrage est enregistré sur le téléphone et partira tout seul.");
    else if (r.rejected) setError(r.rejected.message);
  }

  async function stop() {
    if (!running) return;
    setError(null); setInfo(null);
    const fix = await locate();
    const a: QueuedAction = { clientEventId: newId(), type: "STOP", startRef: running.startRef, visitId: running.visitId, deviceTime: new Date().toISOString(), label: running.doctorName, ...fixFields(fix) };
    await enqueue(a);
    const ended = running;
    await setRunning(null);
    setRunningState(null);
    setBusy("send");
    const r = await flush(a.clientEventId);
    setBusy(null);
    const visitId = r.visitId ?? ended.visitId;
    if (!r.offline && visitId) {
      router.push(`/medical/visites/${visitId}/compte-rendu`);
      return;
    }
    setInfo(`Visite chez Dr ${ended.doctorName} terminée et enregistrée sur le téléphone. Le compte rendu se remplira au retour du réseau (« À compléter »).`);
  }

  async function notDone() {
    if (!notDoneFor) return;
    const why = reason === "Autre" ? otherReason.trim() || "Autre" : reason;
    const target = notDoneFor;
    setNotDoneFor(null);
    setError(null); setInfo(null);
    const fix = await locate();
    const base = { clientEventId: newId(), type: "NON_EFFECTUEE" as const, deviceTime: new Date().toISOString(), reason: why, label: target.doctorName, ...fixFields(fix) };
    const a: QueuedAction = target.running && running
      ? { ...base, startRef: running.startRef, visitId: running.visitId }
      : { ...base, doctorId: target.doctorId, plannedVisitId: target.plannedVisitId ?? null };
    await enqueue(a);
    if (target.running) { await setRunning(null); setRunningState(null); }
    setBusy("send");
    const r = await flush(a.clientEventId);
    setBusy(null);
    if (r.rejected) setError(r.rejected.message);
    else {
      setInfo(r.offline ? "Visite non effectuée enregistrée sur le téléphone (envoi au retour du réseau)." : `Visite non effectuée enregistrée (${why}).`);
      if (!r.offline) router.refresh();
    }
  }

  const results = useMemo(() => {
    const q = normKey(query);
    if (!q) return [];
    return data.doctors.filter((d) => normKey(`${d.name} ${d.city ?? ""} ${d.sector ?? ""}`).includes(q)).slice(0, 30);
  }, [query, data.doctors]);
  const preselected = data.preselectDoctorId ? data.doctors.find((d) => d.id === data.preselectDoctorId) ?? null : null;

  if (!data.accepted) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="rounded-2xl bg-surface border border-line p-5 space-y-3">
          <div className="flex items-center gap-2 text-ink font-semibold text-[16px]"><ShieldCheck size={20} /> Votre position pendant les visites</div>
          <p className="text-[14px] text-ink-2 leading-relaxed">
            Quand vous appuyez sur <b>Démarrer</b>, <b>Terminer</b> ou <b>Visite non effectuée</b>, le téléphone enregistre votre position à cet instant précis.
            Il n&apos;y a <b>aucun suivi en continu</b> : entre deux actions, votre position n&apos;est jamais lue.
          </p>
          <p className="text-[14px] text-ink-2 leading-relaxed">
            Ces positions servent à confirmer la présence chez le médecin et la durée des visites. Elles sont visibles <b>uniquement par la direction et votre manager</b>, jamais par les autres délégués.
            Vous ne pouvez pas modifier une heure ni une position ; une erreur se corrige par votre manager, avec un motif.
          </p>
          <p className="text-[14px] text-ink-2 leading-relaxed">Si la localisation est refusée, la visite reste possible : elle est simplement signalée « non vérifiée ».</p>
          <form action={acceptNotice}>
            <button
              type="button"
              disabled={busy !== null}
              className="btn-primary w-full h-12 text-[15px] disabled:opacity-60"
              onClick={async (e) => {
                const form = e.currentTarget.form;
                // La demande d'autorisation du téléphone arrive ici, une fois, avant la première visite.
                setBusy("gps");
                await askLocationOnce(data.gpsTimeoutS);
                setBusy(null);
                form?.requestSubmit();
              }}
            >
              {busy ? "Activation de la localisation…" : "J'ai compris — activer la localisation"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const elapsed = running ? now - running.startedAtMs : 0;

  return (
    <div className="max-w-lg mx-auto space-y-4 pb-10">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[20px] font-semibold text-ink">Ma journée</h1>
        <span className="text-[12px] text-muted">{new Date(data.day + "T12:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</span>
      </div>

      <LocationSetup timeoutS={data.gpsTimeoutS} />
      {info && <div className="rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green font-medium">{info}</div>}
      {error && <div className="rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red font-medium">{error}</div>}
      {pending > 0 && (
        <button onClick={() => flush()} className="w-full rounded-2xl bg-orange-soft border border-orange/30 px-4 py-3 text-[13px] text-orange font-medium flex items-center gap-2">
          <CloudOff size={16} /> {pending} action(s) en attente de réseau — elles partiront toutes seules. Toucher pour réessayer.
        </button>
      )}
      {gpsDenied && <GpsHelp onClose={() => setGpsDenied(false)} />}
      {busy && (
        <div className="rounded-2xl bg-surface-2 border border-line px-4 py-3 text-[13px] text-ink-2 flex items-center gap-2">
          <LoaderCircle size={16} className="animate-spin" /> {busy === "gps" ? "Localisation en cours…" : "Envoi…"}
        </div>
      )}

      {running ? (
        <div className="rounded-2xl bg-ink text-white p-5 space-y-4">
          <div className="text-[12px] uppercase tracking-wide opacity-70">Visite en cours</div>
          <div className="text-[18px] font-semibold">Dr {running.doctorName}</div>
          <div className="text-[44px] font-semibold tabular-nums leading-none">{fmtElapsed(elapsed)}</div>
          <button disabled={!!busy} onClick={stop} className="w-full h-14 rounded-xl bg-white text-ink text-[16px] font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
            <Square size={18} /> Terminer la visite
          </button>
          <button disabled={!!busy} onClick={() => setNotDoneFor({ doctorId: running.doctorId, doctorName: running.doctorName, running: true })} className="w-full h-11 rounded-xl border border-white/30 text-[14px] flex items-center justify-center gap-2 disabled:opacity-60">
            <UserX size={16} /> Médecin absent / visite non effectuée
          </button>
        </div>
      ) : (
        <>
          {preselected && (
            <DoctorRow name={preselected.name} sub={[preselected.city, preselected.sector].filter(Boolean).join(" · ")} busy={!!busy}
              onStart={() => start(preselected.id, preselected.name)} onAbsent={() => setNotDoneFor({ doctorId: preselected.id, doctorName: preselected.name, running: false })} highlight />
          )}
          <section className="space-y-2">
            <h2 className="label">Planifiées aujourd&apos;hui ({data.planned.length})</h2>
            {data.planned.length === 0 && <div className="text-[13px] text-muted">Aucune visite planifiée. Cherchez un médecin ci-dessous pour démarrer une visite.</div>}
            {data.planned.map((p) => (
              <DoctorRow key={p.visitId} name={p.doctorName} sub={p.city ?? ""} busy={!!busy}
                onStart={() => start(p.doctorId, p.doctorName, p.visitId)} onAbsent={() => setNotDoneFor({ doctorId: p.doctorId, doctorName: p.doctorName, plannedVisitId: p.visitId, running: false })} />
            ))}
          </section>
          <section className="space-y-2">
            <h2 className="label">Nouvelle visite</h2>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Médecin, ville ou secteur…" className="input h-12 pl-9 text-[15px]" />
            </div>
            {results.map((d) => (
              <DoctorRow key={d.id} name={d.name} sub={[d.city, d.sector].filter(Boolean).join(" · ")} busy={!!busy}
                onStart={() => start(d.id, d.name)} onAbsent={() => setNotDoneFor({ doctorId: d.id, doctorName: d.name, running: false })} />
            ))}
            {query && results.length === 0 && <div className="text-[13px] text-muted">Aucun médecin trouvé dans vos secteurs.</div>}
          </section>
        </>
      )}

      {running && <PreVisitBrief key={running.doctorId} doctorId={running.doctorId} />}

      {data.toComplete.length > 0 && (
        <section className="space-y-2">
          <h2 className="label">Comptes rendus à compléter</h2>
          {data.toComplete.map((v) => (
            <Link key={v.visitId} href={`/medical/visites/${v.visitId}/compte-rendu`} className="flex items-center justify-between rounded-xl bg-orange-soft border border-orange/30 px-4 py-3 text-[14px]">
              <span>Dr {v.doctorName} · {new Date(v.date + "T12:00:00Z").toLocaleDateString("fr-FR")}</span><ChevronRight size={16} />
            </Link>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="label">Faites aujourd&apos;hui ({data.done.length})</h2>
        {data.done.length === 0 && <div className="text-[13px] text-muted">Pas encore de visite terminée aujourd&apos;hui.</div>}
        {data.done.map((v) => (
          <div key={v.visitId} className="rounded-xl bg-surface border border-line px-4 py-3 text-[13px] flex items-center justify-between gap-2">
            <div>
              <div className="font-medium text-ink">Dr {v.doctorName}</div>
              <div className="text-muted">
                {v.status === "NON_EFFECTUEE" ? `Non effectuée · ${v.notDoneReason ?? ""} · ${v.endLabel}` : `${v.startLabel} → ${v.endLabel} · ${v.autoClosed ? "clôture automatique" : v.durationMinutes !== null ? `${v.durationMinutes} min` : "—"}`}
              </div>
            </div>
            {v.reportStatus === "A_COMPLETER" && <Link href={`/medical/visites/${v.visitId}/compte-rendu`} className="btn-primary btn-sm shrink-0">Compte rendu</Link>}
            {v.reportStatus === "VALIDE" && <span className="text-[12px] text-green shrink-0">Compte rendu ✓</span>}
          </div>
        ))}
      </section>

      {notDoneFor && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={() => setNotDoneFor(null)}>
          <div className="w-full sm:max-w-md bg-surface rounded-t-2xl sm:rounded-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold text-ink">Visite non effectuée — Dr {notDoneFor.doctorName}</div>
            <p className="text-[13px] text-muted">Votre position est enregistrée : elle prouve le déplacement.</p>
            <div className="space-y-1.5">
              {[...NOT_DONE_REASONS, "Autre"].map((r) => (
                <label key={r} className="flex items-center gap-2 text-[14px] h-10"><input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} /> {r}</label>
              ))}
              {reason === "Autre" && <input value={otherReason} onChange={(e) => setOtherReason(e.target.value)} placeholder="Précisez…" className="input h-11" />}
            </div>
            <button onClick={notDone} className="btn-primary w-full h-12">Enregistrer</button>
            <button onClick={() => setNotDoneFor(null)} className="btn-ghost w-full h-10">Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DoctorRow({ name, sub, onStart, onAbsent, busy, highlight }: { name: string; sub: string; onStart: () => void; onAbsent: () => void; busy: boolean; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 flex items-center gap-2 ${highlight ? "bg-accent-soft border-accent/40" : "bg-surface border-line"}`}>
      <MapPin size={16} className="text-faint shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium text-ink truncate">Dr {name}</div>
        {sub && <div className="text-[12px] text-muted truncate">{sub}</div>}
      </div>
      <button disabled={busy} onClick={onAbsent} className="btn-ghost h-10 w-10 p-0 rounded-lg shrink-0 disabled:opacity-50" aria-label="Visite non effectuée" title="Médecin absent / non effectuée"><UserX size={17} /></button>
      <button disabled={busy} onClick={onStart} className="btn-primary h-10 px-3 shrink-0 disabled:opacity-50"><Play size={15} /> Démarrer</button>
    </div>
  );
}
