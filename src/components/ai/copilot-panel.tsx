"use client";

/**
 * Panneau Copilote global : bouton flottant + raccourci ⌘K, panneau latéral droit, questions suggérées
 * selon la page, historique des conversations, réponse en streaming (SSE depuis /api/ai/chat).
 * Sans clé configurée, le panneau explique quoi renseigner ; il ne casse rien.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { ArrowUp, History, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import { suggestionsFor } from "@/lib/ai/suggestions-shared";
import { AnswerBlocks } from "./answer-blocks";

type ToolStep = { id: string; name: string; ok: boolean | null; summary: string; links?: { label: string; href: string }[] };
type Turn = { id: string; role: "user" | "assistant"; content: string; tools?: ToolStep[]; notices?: string[]; streaming?: boolean; error?: string | null; meta?: { latencyMs: number; model: string } };
type ConversationSummary = { id: string; title: string | null; contextPath: string | null; updatedAt: string };

const TOOL_LABEL: Record<string, string> = {
  get_sales_summary: "Ventes sell-in", get_client_intelligence: "Clients", get_terrain_summary: "Terrain sell-out", get_stock_coverage: "Stock", get_marketing_budget: "Budget marketing",
  get_ads_performance: "Digital Ads", get_regulatory_alerts: "Réglementaire", get_action_center: "Action Center", get_tasks: "Tâches", search_entities: "Recherche", propose_task: "Tâche proposée", propose_report: "Brouillon de rapport",
};

export function CopilotPanel({ enabled, configured }: { enabled: boolean; configured: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((v) => !v); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [turns]);

  const loadHistory = useCallback(async () => {
    try { const r = await fetch("/api/ai/conversations"); if (r.ok) setHistory((await r.json()).conversations ?? []); } catch { /* silencieux */ }
  }, []);
  useEffect(() => { if (open && configured) void loadHistory(); }, [open, configured, loadHistory]);

  async function openConversation(id: string) {
    try {
      const r = await fetch(`/api/ai/conversations?id=${encodeURIComponent(id)}`);
      if (!r.ok) return;
      const c = (await r.json()) as { id: string; messages: { id: string; role: "user" | "assistant"; content: string; toolCalls: ToolStep[] | null; latencyMs: number | null; model: string | null }[] };
      setConversationId(c.id);
      setTurns(c.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, tools: m.toolCalls ?? undefined, meta: m.role === "assistant" && m.latencyMs ? { latencyMs: m.latencyMs, model: m.model ?? "" } : undefined })));
      setShowHistory(false);
    } catch { /* silencieux */ }
  }

  async function removeConversation(id: string) {
    await fetch(`/api/ai/conversations?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
    if (conversationId === id) newConversation();
    void loadHistory();
  }

  function newConversation() { setConversationId(null); setTurns([]); setShowHistory(false); setTimeout(() => inputRef.current?.focus(), 50); }

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setQ("");
    setShowHistory(false);
    const userId = `u-${Date.now()}`, asstId = `a-${Date.now()}`;
    setTurns((t) => [...t, { id: userId, role: "user", content: text }, { id: asstId, role: "assistant", content: "", tools: [], notices: [], streaming: true }]);
    setBusy(true);
    const patch = (fn: (a: Turn) => Turn) => setTurns((t) => t.map((x) => (x.id === asstId ? fn(x) : x)));
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text, conversationId, contextPath: pathname }), signal: controller.signal });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({ error: "Erreur réseau." })); patch((a) => ({ ...a, streaming: false, error: j.error ?? "Erreur." })); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const ev = chunk.match(/^event: (.+)$/m)?.[1];
          const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!ev || !dataLine) continue;
          let data: Record<string, unknown>;
          try { data = JSON.parse(dataLine.slice(6)); } catch { continue; }
          if (ev === "text") patch((a) => ({ ...a, content: a.content + String(data.delta ?? "") }));
          else if (ev === "tool_start") patch((a) => ({ ...a, tools: [...(a.tools ?? []), { id: String(data.id), name: String(data.name), ok: null, summary: "…" }] }));
          else if (ev === "tool_end") patch((a) => ({ ...a, tools: (a.tools ?? []).map((s) => (s.id === data.id ? { ...s, ok: !!data.ok, summary: String(data.summary ?? ""), links: data.links as ToolStep["links"] } : s)) }));
          else if (ev === "notice") patch((a) => ({ ...a, notices: [...(a.notices ?? []), String(data.message ?? "")] }));
          else if (ev === "error") patch((a) => ({ ...a, streaming: false, error: String(data.message ?? "Erreur.") }));
          else if (ev === "done") {
            if (data.conversationId) setConversationId(String(data.conversationId));
            patch((a) => ({ ...a, streaming: false, content: String(data.text ?? a.content), meta: { latencyMs: Number(data.latencyMs ?? 0), model: String(data.model ?? "") } }));
          }
        }
      }
      patch((a) => ({ ...a, streaming: false }));
      void loadHistory();
    } catch (e) {
      patch((a) => ({ ...a, streaming: false, error: (e as Error).name === "AbortError" ? "Arrêté." : "Connexion interrompue." }));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  if (!enabled) return null;
  const suggestions = suggestionsFor(pathname);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx("fixed z-40 right-4 bottom-20 lg:bottom-6 h-12 px-4 rounded-full shadow-[var(--shadow-pop)] flex items-center gap-2 text-[13px] font-medium transition-colors", open ? "bg-ink text-white" : "bg-accent text-white hover:bg-accent-2")}
        aria-label="Demander au copilote (⌘K)"
        title="Demander au copilote (⌘K)"
      >
        <Sparkles size={16} /> Copilote
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20 lg:bg-transparent" onClick={() => setOpen(false)} />
          <aside className="relative h-full w-full sm:w-[460px] lg:w-[520px] bg-surface border-l border-line shadow-[var(--shadow-pop)] flex flex-col" role="dialog" aria-label="Copilote IA">
            <header className="h-14 px-4 flex items-center gap-2 border-b border-line">
              <Sparkles size={16} className="text-accent" />
              <div className="font-semibold text-[14px]">Copilote</div>
              <span className="text-[11px] text-faint hidden sm:inline">⌘K</span>
              <div className="flex-1" />
              <button type="button" className="btn-ghost h-8 w-8 p-0 rounded-lg" onClick={newConversation} title="Nouvelle conversation" aria-label="Nouvelle conversation"><Plus size={16} /></button>
              <button type="button" className={clsx("btn-ghost h-8 w-8 p-0 rounded-lg", showHistory && "bg-black/5")} onClick={() => setShowHistory((v) => !v)} title="Historique" aria-label="Historique"><History size={16} /></button>
              <button type="button" className="btn-ghost h-8 w-8 p-0 rounded-lg" onClick={() => setOpen(false)} aria-label="Fermer"><X size={16} /></button>
            </header>

            {!configured ? (
              <div className="p-5 text-[13.5px] space-y-2">
                <div className="font-semibold">Copilote non configuré</div>
                <p className="text-ink-2">La clé d&apos;accès au modèle n&apos;est pas renseignée sur le serveur. Un administrateur doit ajouter la variable d&apos;environnement <code className="px-1 rounded bg-black/5">ANTHROPIC_API_KEY</code> (Vercel → Settings → Environment Variables), puis redéployer.</p>
                <p className="text-muted">Le reste de COMANET OS fonctionne normalement.</p>
              </div>
            ) : showHistory ? (
              <div className="flex-1 overflow-y-auto p-3 space-y-1">
                <div className="label px-1 mb-2">Conversations récentes</div>
                {history.length === 0 && <div className="text-[13px] text-muted px-1">Aucune conversation.</div>}
                {history.map((c) => (
                  <div key={c.id} className={clsx("flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-black/5", c.id === conversationId && "bg-black/5")}>
                    <button type="button" className="flex-1 text-left text-[13px] truncate" onClick={() => openConversation(c.id)} title={c.title ?? ""}>{c.title ?? "Sans titre"}</button>
                    <span className="text-[11px] text-faint whitespace-nowrap">{new Date(c.updatedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}</span>
                    <button type="button" className="btn-ghost h-7 w-7 p-0 rounded" onClick={() => removeConversation(c.id)} aria-label="Supprimer" title="Supprimer"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {turns.length === 0 && (
                  <div className="space-y-3">
                    <p className="text-[13px] text-ink-2">Posez une question sur les données de COMANET OS. La réponse cite ses sources (sell-in Sage, sell-out animatrices, régie, stock, réglementaire) et se structure en Donnée / Analyse / Hypothèse / Recommandation.</p>
                    <div className="label">Suggestions pour cette page</div>
                    <div className="flex flex-col gap-1.5">
                      {suggestions.map((s) => (
                        <button key={s} type="button" onClick={() => ask(s)} className="text-left text-[13px] px-3 py-2 rounded-lg border border-line bg-surface-2 hover:border-line-2">{s}</button>
                      ))}
                    </div>
                  </div>
                )}
                {turns.map((t) => t.role === "user" ? (
                  <div key={t.id} className="flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent text-white px-3.5 py-2 text-[13.5px] whitespace-pre-wrap">{t.content}</div></div>
                ) : (
                  <div key={t.id} className="space-y-2">
                    {t.tools && t.tools.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {t.tools.map((s) => (
                          <span key={s.id} title={s.summary} className={clsx("inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border", s.ok === null ? "border-line text-muted" : s.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800")}>
                            {s.ok === null && <Loader2 size={11} className="animate-spin" />}
                            {TOOL_LABEL[s.name] ?? s.name}
                          </span>
                        ))}
                      </div>
                    )}
                    {t.content ? <AnswerBlocks text={t.content} streaming={!!t.streaming} /> : t.streaming ? <div className="text-[13px] text-muted flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Lecture des données…</div> : null}
                    {t.notices?.map((n, i) => <div key={i} className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">{n}</div>)}
                    {t.error && <div className="text-[12.5px] text-red bg-red-50 border border-red-200 rounded px-2 py-1">{t.error}</div>}
                    {(() => { const links = (t.tools ?? []).flatMap((s) => s.links ?? []); const uniq = links.filter((l, i) => links.findIndex((x) => x.href === l.href) === i); return uniq.length > 0 && !t.streaming ? (
                      <div className="flex flex-wrap gap-1.5">{uniq.map((l) => <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="text-[12px] px-2 py-1 rounded border border-line hover:border-line-2">{l.label} →</Link>)}</div>
                    ) : null; })()}
                    {t.meta && !t.streaming && <div className="text-[11px] text-faint">{(t.meta.latencyMs / 1000).toFixed(1)} s · {t.meta.model}</div>}
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            )}

            {configured && !showHistory && (
              <form onSubmit={(e) => { e.preventDefault(); void ask(q); }} className="border-t border-line p-3">
                <div className="flex items-end gap-2">
                  <textarea
                    ref={inputRef}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(q); } }}
                    rows={2}
                    placeholder="Demander au copilote… (Entrée pour envoyer)"
                    className="input flex-1 resize-none text-[13.5px] py-2"
                    disabled={busy}
                  />
                  {busy ? (
                    <button type="button" className="btn-secondary h-9 w-9 p-0 rounded-full" onClick={() => abortRef.current?.abort()} aria-label="Arrêter"><X size={16} /></button>
                  ) : (
                    <button type="submit" className="btn-primary h-9 w-9 p-0 rounded-full" disabled={!q.trim()} aria-label="Envoyer"><ArrowUp size={16} /></button>
                  )}
                </div>
                <div className="text-[11px] text-faint mt-1.5">Lecture seule. Le copilote ne cite que des chiffres lus dans COMANET OS ; toute tâche qu&apos;il propose reste à valider.</div>
              </form>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
