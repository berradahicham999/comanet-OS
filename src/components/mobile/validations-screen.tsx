"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, CloudOff, X, Check } from "lucide-react";
import { fmtMad } from "@/lib/mobile/format";
import { fmtDate } from "@/lib/format";
import { swipeDecision, UNDO_DELAY_MS, type ValidationDecision, type ValidationItem } from "@/lib/validations/shared";
import { useMobile } from "./mobile-app";
import { Skeleton } from "./mobile-shell";

type Pending = { item: ValidationItem; decision: "OK" | "KO"; comment: string | null };

/** `stale` : déjà tranchée ailleurs (bureau, autre téléphone) ou disparue ; la carte ne revient pas dans la file. */
async function send(p: Pending): Promise<{ error: string; stale: boolean } | null> {
  const body: ValidationDecision = { kind: p.item.kind, id: p.item.id, decision: p.decision, comment: p.comment };
  const res = await fetch("/api/m/validations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (!res) return { error: "Pas de réseau : décision non envoyée.", stale: false };
  const r = (await res.json().catch(() => ({ ok: false, error: "Réponse illisible." }))) as { ok: boolean; error?: string; stale?: boolean };
  return r.ok ? null : { error: r.error ?? "Décision refusée.", stale: !!r.stale };
}

/** Une décision à la fois. Glisser vers la droite valide, vers la gauche renvoie ; les boutons font la même chose. */
function Card({ item, onDecide }: { item: ValidationItem; onDecide: (d: "OK" | "KO") => void }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  return (
    <article
      className="card p-4 space-y-2 touch-pan-y select-none"
      style={{ transform: `translateX(${dx}px) rotate(${dx / 40}deg)`, transition: dragging ? "none" : "transform .2s" }}
      onPointerDown={(e) => { if ((e.target as HTMLElement).closest("a,button")) return; e.currentTarget.setPointerCapture(e.pointerId); start.current = { x: e.clientX, y: e.clientY }; setDragging(true); }}
      onPointerMove={(e) => { if (start.current) setDx(e.clientX - start.current.x); }}
      onPointerCancel={() => { start.current = null; setDragging(false); setDx(0); }}
      onPointerUp={(e) => {
        if (!start.current) return;
        const d = swipeDecision(e.clientX - start.current.x, e.clientY - start.current.y);
        start.current = null;
        setDragging(false);
        setDx(0);
        if (d) onDecide(d);
      }}
    >
      <div className="text-[12.5px] text-muted">{item.context}</div>
      <h2 className="text-[17px] font-semibold text-ink leading-snug">{item.title}</h2>
      {item.amountMad !== null && <div className="text-[20px] font-semibold text-ink">{fmtMad(item.amountMad)}</div>}
      {item.dueDate && <div className="text-[13.5px] text-ink-2">Échéance : {fmtDate(item.dueDate)}</div>}
      {item.why && item.why !== item.detail && <p className="text-[14px] text-ink">{item.why}</p>}
      {item.detail && <p className="text-[14px] text-ink-2 whitespace-pre-wrap">{item.detail}</p>}
      {item.lines.length > 0 && <ul className="text-[13.5px] text-ink-2 space-y-0.5">{item.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
      <Link href={item.href} prefetch={false} className="min-h-11 inline-flex items-center text-[13.5px] text-accent">Voir le détail</Link>
      <div className="flex gap-2">
        <button type="button" onClick={() => onDecide("KO")} className="btn-secondary flex-1 h-12 text-[14px]"><X size={16} /> {item.refuseLabel}</button>
        <button type="button" onClick={() => onDecide("OK")} className="btn-primary flex-1 h-12 text-[14px]"><Check size={16} /> Valider</button>
      </div>
    </article>
  );
}

export function ValidationsScreen() {
  const { online } = useMobile();
  const [items, setItems] = useState<ValidationItem[] | null>(null);
  const [asking, setAsking] = useState<ValidationItem | null>(null);
  const [comment, setComment] = useState("");
  const [undo, setUndo] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  useEffect(() => {
    let stale = false;
    fetch("/api/m/validations", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ items: ValidationItem[] }>) : { items: [] }))
      .catch(() => ({ items: [] as ValidationItem[] }))
      .then((r) => { if (!stale) setItems(r.items); });
    return () => { stale = true; };
  }, []);

  /** Envoie la décision en attente : à l'expiration du délai, ou avant d'en prendre une autre. */
  const commit = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pendingRef.current;
    pendingRef.current = null;
    setUndo(null);
    if (!p) return;
    const err = await send(p);
    if (err) {
      setError(`${p.item.title} : ${err.error}`);
      if (!err.stale) setItems((list) => (list ? [p.item, ...list] : [p.item]));
    }
  }, []);

  useEffect(() => () => { if (pendingRef.current) void commit(); }, [commit]);

  function queue(p: Pending) {
    void commit();
    setError(null);
    pendingRef.current = p;
    setUndo(p);
    setItems((list) => (list ?? []).filter((i) => !(i.id === p.item.id && i.kind === p.item.kind)));
    timer.current = setTimeout(() => void commit(), UNDO_DELAY_MS);
  }

  function decide(item: ValidationItem, d: "OK" | "KO") {
    // Un motif est demandé pour tout refus ; archiver un rapport lu n'en est pas un.
    if (d === "KO" && item.needsReason) { setComment(""); setAsking(item); return; }
    if (d === "KO") { queue({ item, decision: "KO", comment: null }); return; }
    queue({ item, decision: "OK", comment: null });
  }

  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pendingRef.current;
    pendingRef.current = null;
    setUndo(null);
    if (p) setItems((list) => [p.item, ...(list ?? [])]);
  }

  if (items === null) return <Skeleton />;
  const current = items[0] ?? null;

  return (
    <div className="space-y-3">
      <h1 className="text-[20px] font-semibold text-ink">À valider{items.length ? ` (${items.length})` : ""}</h1>
      {!online && <p className="card p-4 text-[14px] text-muted flex items-center gap-2"><CloudOff size={16} /> Les validations demandent du réseau.</p>}
      {error && <p className="rounded-xl bg-red-soft text-red text-[13.5px] px-3 py-2">{error}</p>}
      {!current && <div className="card p-5 flex items-center gap-2 text-[14px] text-muted"><CheckCircle2 size={18} className="text-green" /> Rien à valider.</div>}
      {current && !asking && <Card key={`${current.kind}-${current.id}`} item={current} onDecide={(d) => decide(current, d)} />}
      {current && !asking && <p className="text-center text-[12.5px] text-muted">Glissez vers la droite pour valider, vers la gauche pour renvoyer.</p>}

      {asking && (
        <section className="card p-4 space-y-2">
          <h2 className="font-semibold text-ink text-[15px]">{asking.refuseLabel} : {asking.title}</h2>
          <textarea autoFocus value={comment} onChange={(e) => setComment(e.target.value)} className="textarea" placeholder="Motif (obligatoire)" aria-label="Motif" />
          <div className="flex gap-2">
            <button type="button" onClick={() => setAsking(null)} className="btn-secondary flex-1 h-12">Annuler</button>
            <button type="button" disabled={!comment.trim()} onClick={() => { const it = asking; setAsking(null); queue({ item: it, decision: "KO", comment: comment.trim() }); }} className="btn-primary flex-1 h-12 disabled:opacity-50">Envoyer</button>
          </div>
        </section>
      )}

      {undo && (
        <div className="fixed inset-x-4 bottom-[calc(72px+env(safe-area-inset-bottom))] z-40 rounded-xl bg-ink text-white px-4 min-h-12 py-2 flex items-center justify-between gap-3 text-[14px]">
          <span className="min-w-0 truncate">{undo.decision === "OK" ? "Validé" : undo.item.kind === "RAPPORT" ? "Archivé" : "Renvoyé"} : {undo.item.title}</span>
          <button type="button" onClick={cancel} className="h-11 px-2 font-semibold shrink-0">Annuler</button>
        </div>
      )}
    </div>
  );
}
