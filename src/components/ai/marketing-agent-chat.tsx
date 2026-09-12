"use client";

/**
 * Chat de l'Agent marketing : même API que le panneau Copilote (/api/ai/chat en SSE), même rendu des
 * réponses (AnswerBlocks), mais la surface « marketing » et la marque sélectionnée sont transmises à
 * chaque question : le modèle sait quelle marque lire, la personne n'a rien à recopier.
 */
import { useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowUp, Loader2, Sparkles, X } from "lucide-react";
import { AnswerBlocks } from "./answer-blocks";
import { TOOL_LABEL } from "./copilot-panel";

type ToolStep = { id: string; name: string; ok: boolean | null; summary: string; links?: { label: string; href: string }[] };
type Turn = { id: string; role: "user" | "assistant"; content: string; tools?: ToolStep[]; notices?: string[]; streaming?: boolean; error?: string | null; meta?: { latencyMs: number; model: string } };

export function MarketingAgentChat({ configured, brandName, periodKey, suggestions }: { configured: boolean; brandName: string | null; periodKey: string; suggestions: string[] }) {
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setQ("");
    const userId = `u-${Date.now()}`, asstId = `a-${Date.now()}`;
    setTurns((t) => [...t, { id: userId, role: "user", content: text }, { id: asstId, role: "assistant", content: "", tools: [], notices: [], streaming: true }]);
    setBusy(true);
    const patch = (fn: (a: Turn) => Turn) => setTurns((t) => t.map((x) => (x.id === asstId ? fn(x) : x)));
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, conversationId, contextPath: "/marketing/agent", agent: "marketing", brand: brandName, period: periodKey }),
        signal: controller.signal,
      });
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
    } catch (e) {
      patch((a) => ({ ...a, streaming: false, error: (e as Error).name === "AbortError" ? "Arrêté." : "Connexion interrompue." }));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  if (!configured) {
    return (
      <div className="text-[13px] space-y-1">
        <div className="font-semibold">Agent non configuré</div>
        <p className="text-ink-2">La clé <code className="px-1 rounded bg-black/5">ANTHROPIC_API_KEY</code> n&apos;est pas renseignée sur le serveur. Le contexte métier et les recommandations du moteur ci-dessus restent disponibles : ils ne dépendent pas du modèle.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {turns.length === 0 && (
        <div className="space-y-2">
          <p className="text-[13px] text-ink-2">{brandName ? <>Questions sur <b>{brandName}</b> : l&apos;agent lit ventes, stock, objectifs et activité marketing par les outils avant de répondre. Rien n&apos;est recopié, rien n&apos;est inventé.</> : "Choisissez une marque ci-dessus, ou nommez-la dans la question."}</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => <button key={s} type="button" onClick={() => ask(s)} className="text-left text-[13px] px-3 py-1.5 rounded-lg border border-line bg-surface-2 hover:border-line-2">{s}</button>)}
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
            <div className="flex flex-wrap gap-1.5">{uniq.map((l) => <Link key={l.href} href={l.href} className="text-[12px] px-2 py-1 rounded border border-line hover:border-line-2">{l.label} →</Link>)}</div>
          ) : null; })()}
          {t.meta && !t.streaming && <div className="text-[11px] text-faint">{(t.meta.latencyMs / 1000).toFixed(1)} s · {t.meta.model}</div>}
        </div>
      ))}
      <form onSubmit={(e) => { e.preventDefault(); void ask(q); }} className="border-t border-line pt-3">
        <div className="flex items-end gap-2">
          <textarea value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(q); } }} rows={2}
            placeholder={brandName ? `Demander à l'agent marketing (${brandName})…` : "Demander à l'agent marketing…"} className="input flex-1 resize-none text-[13.5px] py-2" disabled={busy} />
          {busy ? (
            <button type="button" className="btn-secondary h-9 w-9 p-0 rounded-full" onClick={() => abortRef.current?.abort()} aria-label="Arrêter"><X size={16} /></button>
          ) : (
            <button type="submit" className="btn-primary h-9 w-9 p-0 rounded-full" disabled={!q.trim()} aria-label="Envoyer"><ArrowUp size={16} /></button>
          )}
        </div>
        <div className="text-[11px] text-faint mt-1.5 flex items-center gap-1"><Sparkles size={11} /> Lecture seule : l&apos;agent recommande, vous validez. Chaque chiffre porte son niveau de fiabilité (confirmé, calculé, déduit, manquant).</div>
      </form>
    </div>
  );
}
