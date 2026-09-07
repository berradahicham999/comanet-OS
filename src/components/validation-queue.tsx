"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Check, ChevronDown, ChevronUp, MessageSquareWarning } from "lucide-react";
import { BrandDot } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import type { ContentRefs } from "@/lib/content/shared";

/**
 * File de validation du DG : un contenu à la fois, visuel et légende côte à côte,
 * Valider / Corriger, navigation clavier (↑/↓ ou j/k, V = valider, C = corriger, Échap = annuler).
 * Sur téléphone, le visuel passe au-dessus de la légende et les boutons restent sous le pouce.
 */
export type QueueItem = {
  id: string; date: string; title: string; brand: string; color: string; brandId: string; platform: string | null; format: string | null;
  caption: string | null; hashtags: string | null; responsible: string | null; since: string; assetId: string | null; assetMime: string | null; assetName: string | null;
};

export function ValidationQueue({ items, refs, initialId, validateKey, correctKey, action, canAct, nowIso }: {
  items: QueueItem[]; refs: ContentRefs; initialId?: string | null; nowIso: string;
  /** Clés de statut cibles (référentiel) pour « Valider » et « Corriger ». */
  validateKey: string | null; correctKey: string | null;
  action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>;
  canAct: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [idx, setIdx] = useState(() => Math.max(0, items.findIndex((i) => i.id === initialId)));
  const [correct, setCorrect] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cur = items[Math.min(idx, items.length - 1)];
  const pf = useMemo(() => refs.platforms.find((p) => p.key === cur?.platform), [refs.platforms, cur?.platform]);
  const fmtLabel = refs.formats.find((f) => f.key === cur?.format)?.label;

  function submit(to: string | null, c?: string) {
    if (!cur || !to) return;
    setError(null);
    const fd = new FormData(); fd.set("id", cur.id); fd.set("to", to); if (c) fd.set("comment", c);
    start(async () => {
      const r = await action(fd).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      if (!r.ok) { setError(r.error ?? "Refusé."); return; }
      setCorrect(false); setComment("");
      router.refresh();
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") { if (e.key === "Escape") { setCorrect(false); setComment(""); } return; }
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); setCorrect(false); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); setCorrect(false); }
      else if ((e.key === "v" || e.key === "V") && canAct) submit(validateKey);
      else if ((e.key === "c" || e.key === "C") && canAct) setCorrect(true);
      else if (e.key === "Escape") { setCorrect(false); setComment(""); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, cur?.id, canAct, validateKey]);

  if (!items.length) return null;
  const since = Math.round((new Date(nowIso).getTime() - new Date(cur.since).getTime()) / 86400000);

  return (
    <div className="grid lg:grid-cols-[280px_1fr] gap-4 items-start">
      {/* Liste */}
      <ol className="card overflow-hidden divide-y divide-line max-h-[70dvh] overflow-y-auto order-2 lg:order-1">
        {items.map((it, i) => (
          <li key={it.id}>
            <button type="button" onClick={() => { setIdx(i); setCorrect(false); }} className={clsx("w-full text-left px-3 py-2 text-[12.5px] hover:bg-surface-2", i === idx && "bg-accent-soft")}>
              <div className="flex items-center gap-1.5 min-w-0"><BrandDot color={it.color} /><span className="truncate font-medium">{it.title}</span></div>
              <div className="text-muted text-[11px] mt-0.5">{it.brand} · {new Date(it.date + "T12:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}{it.responsible ? ` · ${it.responsible}` : ""}{!it.assetId && " · sans visuel"}</div>
            </button>
          </li>
        ))}
      </ol>

      {/* Détail */}
      <div className="card card-pad order-1 lg:order-2">
        <div className="flex items-start gap-2 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-muted flex items-center gap-1.5"><BrandDot color={cur.color} />{cur.brand}{pf && <span className="inline-flex items-center gap-1">· <PlatformIcon icon={pf.icon} label={pf.label} size={12} />{pf.label}</span>}{fmtLabel && <span>· {fmtLabel}</span>} · publication le {new Date(cur.date + "T12:00:00Z").toLocaleDateString("fr-FR")}</div>
            <h2 className="font-semibold text-[16px] leading-tight mt-0.5"><Link href={`/marketing/planning/${cur.id}`} className="hover:underline">{cur.title}</Link></h2>
            <div className="text-[11.5px] text-muted mt-0.5">En attente depuis {since <= 0 ? "aujourd'hui" : `${since} j`}{cur.responsible ? ` · créé par ${cur.responsible}` : ""} · {idx + 1}/{items.length}</div>
          </div>
          <div className="hidden sm:flex items-center gap-1">
            <button type="button" className="btn-secondary btn-sm h-8 w-8 p-0" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} aria-label="Précédent"><ChevronUp size={14} /></button>
            <button type="button" className="btn-secondary btn-sm h-8 w-8 p-0" onClick={() => setIdx((i) => Math.min(items.length - 1, i + 1))} disabled={idx >= items.length - 1} aria-label="Suivant"><ChevronDown size={14} /></button>
          </div>
        </div>

        <div className="mt-3 grid md:grid-cols-2 gap-3">
          <div className="rounded-xl border border-line bg-black/5 min-h-[220px] flex items-center justify-center overflow-hidden">
            {cur.assetId && cur.assetMime?.startsWith("image/") ? <img src={`/marketing/planning/fichier/${cur.assetId}`} alt={cur.assetName ?? ""} className="max-h-[480px] w-full object-contain" />
              : cur.assetId && cur.assetMime?.startsWith("video/") ? <video src={`/marketing/planning/fichier/${cur.assetId}`} controls className="max-h-[480px] w-full" />
              : cur.assetId ? <a href={`/marketing/planning/fichier/${cur.assetId}`} target="_blank" rel="noreferrer" className="text-[13px] text-accent underline p-4">{cur.assetName}</a>
              : <div className="text-[13px] text-muted p-4 text-center">Aucun livrable déposé.<br />La légende seule est soumise.</div>}
          </div>
          <div className="text-[13.5px] whitespace-pre-wrap leading-relaxed">
            {cur.caption ? cur.caption : <span className="text-muted">Pas de légende.</span>}
            {cur.hashtags && <div className="mt-2 text-accent">{cur.hashtags}</div>}
          </div>
        </div>

        {canAct && (
          <div className="mt-4 sticky bottom-0 bg-surface pt-2 -mx-4 px-4 pb-1 sm:static sm:m-0 sm:p-0">
            {!correct ? (
              <div className="flex gap-2">
                <button type="button" className="btn-primary flex-1 h-11 inline-flex items-center justify-center gap-2" disabled={pending || !validateKey} onClick={() => submit(validateKey)}><Check size={16} /> Valider <kbd className="hidden sm:inline text-[10px] opacity-70 ml-1">V</kbd></button>
                <button type="button" className="btn-secondary flex-1 h-11 inline-flex items-center justify-center gap-2" disabled={pending || !correctKey} onClick={() => setCorrect(true)}><MessageSquareWarning size={16} /> Corriger <kbd className="hidden sm:inline text-[10px] opacity-70 ml-1">C</kbd></button>
              </div>
            ) : (
              <div className="space-y-2">
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} className="textarea min-h-[80px]" placeholder="Ce qui doit être corrigé (obligatoire, envoyé au créateur)…" autoFocus />
                <div className="flex gap-2">
                  <button type="button" className="btn-primary h-10 flex-1" disabled={!comment.trim() || pending} onClick={() => submit(correctKey, comment)}>Envoyer les corrections</button>
                  <button type="button" className="btn-secondary h-10" onClick={() => { setCorrect(false); setComment(""); }}>Annuler</button>
                </div>
              </div>
            )}
            {error && <p className="text-[12.5px] text-red mt-1">{error}</p>}
            <p className="hidden sm:block text-[11px] text-faint mt-1.5">↑ ↓ ou J / K pour naviguer · V valider · C corriger · Échap annuler</p>
          </div>
        )}
        {!canAct && <p className="mt-3 text-[12.5px] text-muted">Vous consultez la file en lecture : la validation est réservée aux validateurs de la marque et à la Direction.</p>}
      </div>
    </div>
  );
}
