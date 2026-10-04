"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CloudOff, LoaderCircle, MapPin, Play, Search, Square, UserX, ChevronRight, ShieldCheck, ShoppingCart, PackageSearch, Phone, Sparkles } from "lucide-react";
import { normKey } from "@/lib/import/normalize";
import { capturePosition, fieldQueue, newId, fmtElapsed, type QueuedAction, type RunningVisit, type Fix } from "@/lib/medical/field-client";
import { GpsHelp } from "@/components/medical/gps-help";
import { LocationSetup, askLocationOnce } from "@/components/medical/location-setup";
import { NOT_DONE_REASONS, orderHref, stockReadingHref } from "@/lib/crm/visits-shared";
import { ClientBrief } from "./client-brief";

const Q = fieldQueue("crm");

export type TourClient = {
  id: string; name: string; city: string | null; type: string; frequency: number | null; done: number; remaining: number;
  lastVisit: string | null; nextPlanned: string | null; plannedToday: string | null; overdueDays: number | null;
  objective: { pct: number | null; verdict: string } | null; stockStale: boolean;
};

export type TourData = {
  day: string;
  monthLabel: string;
  accepted: boolean;
  gpsTimeoutS: number;
  running: { visitId: string; clientId: string; clientName: string; startedAt: string; startRef: string | null } | null;
  progress: { expected: number; counted: number; done: number; pct: number | null; followed: number; notVisited: number; undefinedFrequency: number };
  pace: { kind: string; label: string };
  elapsedPct: number;
  byCity: { city: string; expected: number; counted: number; pct: number | null; clients: number }[];
  suggestions: { clientId: string; name: string; city: string | null; reasons: string[]; plannedVisitId: string | null }[];
  planned: { visitId: string; clientId: string; clientName: string; city: string | null }[];
  clients: TourClient[];
  /** Clients de la portée hors portefeuille (visite ponctuelle possible). */
  others: { id: string; name: string; city: string | null }[];
  done: { visitId: string; clientName: string; kind: string; status: string; startLabel: string; endLabel: string; durationMinutes: number | null; reportStatus: string | null; notDoneReason: string | null; autoClosed: boolean; manual: boolean }[];
  toComplete: { visitId: string; clientName: string; date: string }[];
  preselectClientId: string | null;
  flash: string | null;
};

const pctTone = (pct: number | null, elapsed: number) => (pct === null ? "bg-faint" : pct >= 100 ? "bg-green" : pct >= elapsed - 10 ? "bg-accent" : pct >= elapsed - 25 ? "bg-orange" : "bg-red");
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

export function TourDay({ data, acceptNotice }: { data: TourData; acceptNotice: () => Promise<void> }) {
  const router = useRouter();
  const [running, setRunningState] = useState<RunningVisit | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<null | "gps" | "send">(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(data.flash);
  const [gpsDenied, setGpsDenied] = useState(false);
  const [query, setQuery] = useState("");
  const [notDoneFor, setNotDoneFor] = useState<null | { clientId: string; clientName: string; plannedVisitId?: string | null; running: boolean }>(null);
  const [reason, setReason] = useState(NOT_DONE_REASONS[0]);
  const [otherReason, setOtherReason] = useState("");
  const [showUndefined, setShowUndefined] = useState(false);

  const refreshPending = useCallback(async () => setPending((await Q.queued()).length), []);

  const flush = useCallback(async (watch?: string) => {
    const r = await Q.flushQueue();
    await refreshPending();
    if (r.rejected.length) setError(r.rejected.map((x) => x.message).join(" "));
    const cur = await Q.getRunning();
    if (cur && r.rejected.some((x) => x.clientEventId === cur.startRef)) {
      await Q.setRunning(null);
      setRunningState(null);
    }
    for (const s of r.sent) {
      if (s.type === "START" && cur && cur.startRef === s.clientEventId && !cur.visitId) {
        const next = { ...cur, visitId: s.visitId };
        await Q.setRunning(next);
        setRunningState(next);
      }
    }
    return { offline: r.offline, visitId: watch ? r.sent.find((s) => s.clientEventId === watch)?.visitId ?? null : null, rejected: watch ? r.rejected.find((x) => x.clientEventId === watch) ?? null : null };
  }, [refreshPending]);

  // Réconciliation au chargement : visite locale (hors connexion) et visite connue du serveur.
  useEffect(() => {
    (async () => {
      const local = await Q.getRunning();
      const q = await Q.queued();
      const s = data.running;
      const closingQueued = (ref: string | null) => !!ref && q.some((a) => a.startRef === ref && a.type !== "START");
      if (s && !closingQueued(s.startRef)) {
        const v: RunningVisit = { startRef: s.startRef ?? local?.startRef ?? newId(), visitId: s.visitId, doctorId: s.clientId, doctorName: s.clientName, startedAtMs: Date.parse(s.startedAt) };
        await Q.setRunning(v);
        setRunningState(v);
      } else if (local && !s) {
        const startPending = q.some((a) => a.type === "START" && a.clientEventId === local.startRef);
        if (startPending) setRunningState(local);
        else await Q.setRunning(null);
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
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => { clearInterval(t); clearInterval(retry); window.removeEventListener("online", onOnline); };
  }, [flush]);

  async function locate(): Promise<Fix> {
    setBusy("gps");
    const fix = await capturePosition(data.gpsTimeoutS);
    if ("error" in fix && fix.error === "REFUSE") setGpsDenied(true);
    return fix;
  }
  const fixFields = (fix: Fix): Pick<QueuedAction, "lat" | "lng" | "accuracyM" | "gpsError"> =>
    "error" in fix ? { lat: null, lng: null, accuracyM: null, gpsError: fix.error } : { lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM, gpsError: null };

  async function start(clientId: string, clientName: string, plannedVisitId?: string | null) {
    setError(null); setInfo(null);
    if (running) { setError(`Une visite est déjà en cours chez ${running.doctorName}.`); return; }
    const fix = await locate();
    const a: QueuedAction = { clientEventId: newId(), type: "START", clientId, plannedVisitId: plannedVisitId ?? null, deviceTime: new Date().toISOString(), label: clientName, ...fixFields(fix) };
    const v: RunningVisit = { startRef: a.clientEventId, visitId: null, doctorId: clientId, doctorName: clientName, startedAtMs: Date.now() };
    await Q.enqueue(a);
    await Q.setRunning(v);
    setRunningState(v);
    setBusy("send");
    const r = await flush(a.clientEventId);
    setBusy(null);
    if (r.offline) setInfo("Pas de réseau : le démarrage est enregistré sur le téléphone et partira tout seul.");
    else if (r.rejected) setError(r.rejected.message);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function stop() {
    if (!running) return;
    setError(null); setInfo(null);
    const fix = await locate();
    const a: QueuedAction = { clientEventId: newId(), type: "STOP", startRef: running.startRef, visitId: running.visitId, deviceTime: new Date().toISOString(), label: running.doctorName, ...fixFields(fix) };
    await Q.enqueue(a);
    const ended = running;
    await Q.setRunning(null);
    setRunningState(null);
    setBusy("send");
    const r = await flush(a.clientEventId);
    setBusy(null);
    const visitId = r.visitId ?? ended.visitId;
    if (!r.offline && visitId) {
      router.push(`/clients/visites/${visitId}?cr=1`);
      return;
    }
    setInfo(`Visite chez ${ended.doctorName} terminée et enregistrée sur le téléphone. Le compte rendu se remplira au retour du réseau (« À compléter »).`);
  }

  async function notDone() {
    if (!notDoneFor) return;
    const why = reason === "Autre" ? otherReason.trim() || "Autre" : reason;
    const target = notDoneFor;
    setNotDoneFor(null);
    setError(null); setInfo(null);
    const fix = await locate();
    const base = { clientEventId: newId(), type: "NON_EFFECTUEE" as const, deviceTime: new Date().toISOString(), reason: why, label: target.clientName, ...fixFields(fix) };
    const a: QueuedAction = target.running && running
      ? { ...base, startRef: running.startRef, visitId: running.visitId }
      : { ...base, clientId: target.clientId, plannedVisitId: target.plannedVisitId ?? null };
    await Q.enqueue(a);
    if (target.running) { await Q.setRunning(null); setRunningState(null); }
    setBusy("send");
    const r = await flush(a.clientEventId);
    setBusy(null);
    if (r.rejected) setError(r.rejected.message);
    else {
      setInfo(r.offline ? "Visite non effectuée enregistrée sur le téléphone (envoi au retour du réseau)." : `Visite non effectuée enregistrée (${why}).`);
      if (!r.offline) router.refresh();
    }
  }

  const followed = useMemo(() => data.clients.filter((c) => c.frequency !== null), [data.clients]);
  const undefinedFreq = useMemo(() => data.clients.filter((c) => c.frequency === null), [data.clients]);
  const filtered = useMemo(() => {
    const q = normKey(query);
    const list = q ? data.clients.filter((c) => normKey(`${c.name} ${c.city ?? ""}`).includes(q)) : followed;
    const byCity = new Map<string, TourClient[]>();
    for (const c of list) byCity.set(c.city ?? "Ville non renseignée", [...(byCity.get(c.city ?? "Ville non renseignée") ?? []), c]);
    return [...byCity].map(([city, cs]) => ({ city, clients: cs.sort((a, b) => b.remaining - a.remaining || (a.overdueDays ?? 0) - (b.overdueDays ?? 0) || a.name.localeCompare(b.name)) }));
  }, [query, data.clients, followed]);
  const otherResults = useMemo(() => {
    const q = normKey(query);
    if (q.length < 2) return [];
    return data.others.filter((c) => normKey(`${c.name} ${c.city ?? ""}`).includes(q)).slice(0, 15);
  }, [query, data.others]);
  const preselected = data.preselectClientId ? data.clients.find((c) => c.id === data.preselectClientId) ?? data.others.find((c) => c.id === data.preselectClientId) ?? null : null;

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
            Ces positions confirment le passage chez le client et la durée des visites. Elles sont visibles <b>uniquement par la direction et votre manager</b>.
            Vous ne pouvez pas modifier une heure ni une position ; une erreur se corrige par votre manager, avec un motif.
          </p>
          <p className="text-[14px] text-ink-2 leading-relaxed">Si la localisation est refusée, la visite reste possible : elle est simplement signalée « non vérifiée ».</p>
          <form action={acceptNotice}>
            <button type="button" disabled={busy !== null} className="btn-primary w-full h-12 text-[15px] disabled:opacity-60"
              onClick={async (e) => {
                const form = e.currentTarget.form;
                setBusy("gps");
                await askLocationOnce(data.gpsTimeoutS);
                setBusy(null);
                form?.requestSubmit();
              }}>
              {busy ? "Activation de la localisation…" : "J'ai compris — activer la localisation"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const elapsed = running ? now - running.startedAtMs : 0;
  const p = data.progress;

  return (
    <div className="max-w-lg mx-auto space-y-4 pb-10">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[20px] font-semibold text-ink">Ma tournée</h1>
        <span className="text-[12px] text-muted">{new Date(data.day + "T12:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</span>
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

      {/* Progression du mois */}
      <section className="rounded-2xl bg-surface border border-line p-4 space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[13px] text-muted">Visites de {data.monthLabel}</div>
          <div className="text-[12px] text-muted">{Math.round(data.elapsedPct)} % du mois écoulé</div>
        </div>
        {p.expected ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-[28px] font-semibold tabular-nums text-ink">{p.counted}</span>
              <span className="text-[15px] text-muted">/ {p.expected} visites · {Math.round(p.pct ?? 0)} %</span>
            </div>
            <div className="relative h-2.5 w-full rounded-full bg-black/6 overflow-hidden">
              <div className={`h-full rounded-full ${pctTone(p.pct, data.elapsedPct)}`} style={{ width: `${Math.min(100, p.pct ?? 0)}%` }} />
              <div className="absolute top-0 h-full w-0.5 bg-ink/60" style={{ left: `${Math.min(100, data.elapsedPct)}%` }} title="Avancement du mois" />
            </div>
            <div className={`text-[13px] font-medium ${data.pace.kind === "EN_RETARD" ? "text-red" : data.pace.kind === "ATTEINT" ? "text-green" : "text-ink-2"}`}>{data.pace.label}</div>
            <div className="text-[12px] text-muted">{p.followed} clients suivis · {p.notVisited} pas encore visité{p.notVisited > 1 ? "s" : ""} ce mois{p.done > p.counted ? ` · ${p.done - p.counted} visite(s) au-delà de la fréquence` : ""}</div>
            {data.byCity.length > 1 && (
              <div className="pt-1 space-y-1">
                {data.byCity.filter((c) => c.expected > 0).map((c) => (
                  <div key={c.city} className="flex items-center gap-2 text-[12px]">
                    <span className="w-28 truncate text-ink-2">{c.city}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-black/6 overflow-hidden"><div className={`h-full ${pctTone(c.pct, data.elapsedPct)}`} style={{ width: `${Math.min(100, c.pct ?? 0)}%` }} /></div>
                    <span className="tabular-nums text-muted w-14 text-right">{c.counted}/{c.expected}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="text-[13px] text-muted">
            {data.clients.length ? "Aucune fréquence de visite n'est encore définie sur vos clients : la progression du mois se calculera dès que votre manager les aura fixées." : "Aucun client ne vous est encore confié. Votre manager affecte les clients depuis Clients → Portefeuilles ; en attendant, cherchez un client ci-dessous pour démarrer une visite."}
          </div>
        )}
        {undefinedFreq.length > 0 && <div className="text-[12px] text-faint">{undefinedFreq.length} client(s) sans fréquence définie, hors progression.</div>}
      </section>

      {running ? (
        <div className="rounded-2xl bg-ink text-white p-5 space-y-4">
          <div className="text-[12px] uppercase tracking-wide opacity-70">Visite en cours</div>
          <div className="text-[18px] font-semibold">{running.doctorName}</div>
          <div className="text-[44px] font-semibold tabular-nums leading-none">{fmtElapsed(elapsed)}</div>
          <div className="grid grid-cols-2 gap-2">
            <Link href={orderHref(running.doctorId)} className="h-11 rounded-xl bg-white/10 border border-white/25 text-[13px] flex items-center justify-center gap-1.5"><ShoppingCart size={15} /> Prendre une commande</Link>
            <Link href={stockReadingHref(running.doctorId)} className="h-11 rounded-xl bg-white/10 border border-white/25 text-[13px] flex items-center justify-center gap-1.5"><PackageSearch size={15} /> Relever le stock</Link>
          </div>
          <button disabled={!!busy} onClick={stop} className="w-full h-14 rounded-xl bg-white text-ink text-[16px] font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
            <Square size={18} /> Terminer la visite
          </button>
          <button disabled={!!busy} onClick={() => setNotDoneFor({ clientId: running.doctorId, clientName: running.doctorName, running: true })} className="w-full h-11 rounded-xl border border-white/30 text-[14px] flex items-center justify-center gap-2 disabled:opacity-60">
            <UserX size={16} /> Responsable absent / visite non effectuée
          </button>
        </div>
      ) : (
        <>
          {preselected && (
            <ClientRow name={preselected.name} sub={preselected.city ?? ""} busy={!!busy} highlight
              onStart={() => start(preselected.id, preselected.name)} onAbsent={() => setNotDoneFor({ clientId: preselected.id, clientName: preselected.name, running: false })} />
          )}
          {data.suggestions.length > 0 && (
            <section className="space-y-2">
              <h2 className="label flex items-center gap-1.5"><Sparkles size={13} /> À voir en priorité aujourd&apos;hui</h2>
              {data.suggestions.map((sg) => (
                <ClientRow key={sg.clientId} name={sg.name} sub={sg.reasons.join(" · ")} busy={!!busy} highlight
                  onStart={() => start(sg.clientId, sg.name, sg.plannedVisitId)} onAbsent={() => setNotDoneFor({ clientId: sg.clientId, clientName: sg.name, plannedVisitId: sg.plannedVisitId, running: false })} />
              ))}
            </section>
          )}
          {data.planned.length > 0 && (
            <section className="space-y-2">
              <h2 className="label">Planifiées aujourd&apos;hui ({data.planned.length})</h2>
              {data.planned.map((pl) => (
                <ClientRow key={pl.visitId} name={pl.clientName} sub={pl.city ?? ""} busy={!!busy}
                  onStart={() => start(pl.clientId, pl.clientName, pl.visitId)} onAbsent={() => setNotDoneFor({ clientId: pl.clientId, clientName: pl.clientName, plannedVisitId: pl.visitId, running: false })} />
              ))}
            </section>
          )}
        </>
      )}

      {running && <ClientBrief key={running.doctorId} clientId={running.doctorId} />}

      {data.toComplete.length > 0 && (
        <section className="space-y-2">
          <h2 className="label">Comptes rendus à compléter</h2>
          {data.toComplete.map((v) => (
            <Link key={v.visitId} href={`/clients/visites/${v.visitId}?cr=1`} className="flex items-center justify-between rounded-xl bg-orange-soft border border-orange/30 px-4 py-3 text-[14px]">
              <span>{v.clientName} · {fmtDay(v.date)}</span><ChevronRight size={16} />
            </Link>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="label">Faites aujourd&apos;hui ({data.done.length})</h2>
        {data.done.length === 0 && <div className="text-[13px] text-muted">Pas encore de visite terminée aujourd&apos;hui.</div>}
        {data.done.map((v) => (
          <div key={v.visitId} className="rounded-xl bg-surface border border-line px-4 py-3 text-[13px] flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium text-ink truncate">{v.clientName}</div>
              <div className="text-muted">
                {v.kind !== "VISITE" ? (v.kind === "APPEL" ? "Appel" : "Message") : v.manual ? "Visite saisie sans chrono" : v.status === "NON_EFFECTUEE" ? `Non effectuée · ${v.notDoneReason ?? ""} · ${v.endLabel}` : `${v.startLabel} → ${v.endLabel} · ${v.autoClosed ? "clôture automatique" : v.durationMinutes !== null ? `${v.durationMinutes} min` : "—"}`}
              </div>
            </div>
            {v.reportStatus === "A_COMPLETER" && <Link href={`/clients/visites/${v.visitId}?cr=1`} className="btn-primary btn-sm shrink-0">Compte rendu</Link>}
            {v.reportStatus === "VALIDE" && <Link href={`/clients/visites/${v.visitId}`} className="text-[12px] text-green shrink-0">Compte rendu ✓</Link>}
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="label">Mon portefeuille ({data.clients.length})</h2>
          <Link href="/clients/tournee/contact" className="text-[12px] text-accent font-medium flex items-center gap-1"><Phone size={13} /> Noter un appel</Link>
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Client ou ville…" className="input h-12 pl-9 text-[15px]" />
        </div>
        {filtered.map((g) => (
          <div key={g.city} className="space-y-1.5">
            <div className="text-[12px] font-semibold text-ink-2 pt-1">{g.city} · {g.clients.length}</div>
            {g.clients.map((c) => (
              <PortfolioRow key={c.id} c={c} busy={!!busy || !!running} onStart={() => start(c.id, c.name, c.plannedToday)} onAbsent={() => setNotDoneFor({ clientId: c.id, clientName: c.name, plannedVisitId: c.plannedToday, running: false })} />
            ))}
          </div>
        ))}
        {!query && undefinedFreq.length > 0 && (
          <div>
            <button onClick={() => setShowUndefined((v) => !v)} className="text-[12px] text-muted underline">{showUndefined ? "Masquer" : "Afficher"} les {undefinedFreq.length} client(s) sans fréquence</button>
            {showUndefined && <div className="mt-1.5 space-y-1.5">{undefinedFreq.map((c) => <PortfolioRow key={c.id} c={c} busy={!!busy || !!running} onStart={() => start(c.id, c.name, c.plannedToday)} onAbsent={() => setNotDoneFor({ clientId: c.id, clientName: c.name, running: false })} />)}</div>}
          </div>
        )}
        {otherResults.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[12px] font-semibold text-ink-2 pt-1">Hors de mon portefeuille</div>
            {otherResults.map((c) => (
              <ClientRow key={c.id} name={c.name} sub={c.city ?? ""} busy={!!busy || !!running} onStart={() => start(c.id, c.name)} onAbsent={() => setNotDoneFor({ clientId: c.id, clientName: c.name, running: false })} />
            ))}
          </div>
        )}
        {query && !filtered.length && !otherResults.length && <div className="text-[13px] text-muted">Aucun client trouvé dans votre portée.</div>}
      </section>

      {notDoneFor && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={() => setNotDoneFor(null)}>
          <div className="w-full sm:max-w-md bg-surface rounded-t-2xl sm:rounded-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold text-ink">Visite non effectuée — {notDoneFor.clientName}</div>
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

function ClientRow({ name, sub, onStart, onAbsent, busy, highlight }: { name: string; sub: string; onStart: () => void; onAbsent: () => void; busy: boolean; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 flex items-center gap-2 ${highlight ? "bg-accent-soft border-accent/40" : "bg-surface border-line"}`}>
      <MapPin size={16} className="text-faint shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium text-ink truncate">{name}</div>
        {sub && <div className="text-[12px] text-muted line-clamp-2">{sub}</div>}
      </div>
      <button disabled={busy} onClick={onAbsent} className="btn-ghost h-10 w-10 p-0 rounded-lg shrink-0 disabled:opacity-50" aria-label="Visite non effectuée" title="Responsable absent / non effectuée"><UserX size={17} /></button>
      <button disabled={busy} onClick={onStart} className="btn-primary h-10 px-3 shrink-0 disabled:opacity-50"><Play size={15} /> Démarrer</button>
    </div>
  );
}

function PortfolioRow({ c, onStart, onAbsent, busy }: { c: TourClient; onStart: () => void; onAbsent: () => void; busy: boolean }) {
  const f = c.frequency;
  const badge = f === null ? "fréquence non définie" : f === 0 ? "pas de visite prévue" : `${c.done}/${f} ce mois`;
  const done = f !== null && f > 0 && c.remaining === 0;
  const extras = [
    c.lastVisit ? `dernière visite ${fmtDay(c.lastVisit)}` : "jamais visité",
    c.overdueDays !== null && c.overdueDays > 0 ? `commande attendue depuis ${c.overdueDays} j` : null,
    c.objective && c.objective.pct !== null ? `objectif ${Math.round(c.objective.pct)} %${c.objective.verdict === "EN_RETARD" ? " (en retard)" : ""}` : null,
    c.stockStale ? "relevé à refaire" : null,
    c.plannedToday ? "planifié aujourd'hui" : c.nextPlanned ? `prévu le ${fmtDay(c.nextPlanned)}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="rounded-xl border bg-surface border-line px-3 py-2.5 flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <Link href={`/clients/${c.id}?tab=crm`} className="text-[14px] font-medium text-ink truncate block">{c.name}</Link>
        <div className="text-[12px] text-muted line-clamp-2"><span className={done ? "text-green font-medium" : c.remaining > 0 ? "text-ink-2 font-medium" : ""}>{badge}</span>{extras ? ` · ${extras}` : ""}</div>
      </div>
      <button disabled={busy} onClick={onAbsent} className="btn-ghost h-10 w-10 p-0 rounded-lg shrink-0 disabled:opacity-50" aria-label="Visite non effectuée" title="Responsable absent / non effectuée"><UserX size={17} /></button>
      <button disabled={busy} onClick={onStart} className={`${done ? "btn-secondary" : "btn-primary"} h-10 px-3 shrink-0 disabled:opacity-50`}><Play size={15} /> Démarrer</button>
    </div>
  );
}
