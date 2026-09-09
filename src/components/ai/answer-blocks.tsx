"use client";

/**
 * Rendu d'une réponse du copilote : Markdown réduit (titres, listes, gras, tableaux, liens) avec les
 * quatre blocs Donnée / Analyse / Hypothèse / Recommandation mis en évidence. Même vocabulaire visuel
 * que le bloc « Poser une question » de l'analytics marketing. Aucun HTML brut n'est interprété.
 */
import Link from "next/link";
import { Fragment } from "react";

const BLOCK_TONE: Record<string, string> = {
  donnée: "bg-surface-2 border-line",
  analyse: "bg-surface border-line",
  hypothèse: "bg-amber-50 border-amber-200",
  recommandation: "bg-emerald-50 border-emerald-200",
};

type Node = { kind: "h"; level: number; text: string } | { kind: "p"; text: string } | { kind: "ul"; items: string[] } | { kind: "ol"; items: string[] } | { kind: "table"; rows: string[][] };

function parse(md: string): Node[] {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: Node[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push({ kind: "h", level: h[1].length, text: h[2].trim() }); i++; continue; }
    if (/^\s*\|/.test(l)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      out.push({ kind: "table", rows });
      continue;
    }
    if (/^\s*[-*•]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*•]\s+/, "")); i++; }
      out.push({ kind: "ul", items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, "")); i++; }
      out.push({ kind: "ol", items });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4})\s|^\s*\||^\s*[-*•]\s+|^\s*\d+[.)]\s+/.test(lines[i])) { buf.push(lines[i].trim()); i++; }
    out.push({ kind: "p", text: buf.join(" ") });
  }
  return out;
}

/** Gras, italique, code et liens internes ; tout le reste est du texte. */
export function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith("`") && p.endsWith("`")) return <code key={i} className="px-1 rounded bg-black/5 text-[12px]">{p.slice(1, -1)}</code>;
        const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          const href = link[2];
          const internal = href.startsWith("/");
          return internal ? <Link key={i} href={href} className="text-accent underline underline-offset-2">{link[1]}</Link> : <span key={i} className="underline">{link[1]}</span>;
        }
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

function Body({ nodes }: { nodes: Node[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.kind === "h") return <div key={i} className="font-semibold mt-2 mb-1"><Inline text={n.text} /></div>;
        if (n.kind === "p") return <p key={i} className="my-1 leading-relaxed"><Inline text={n.text} /></p>;
        if (n.kind === "ul") return <ul key={i} className="list-disc pl-5 my-1 space-y-0.5">{n.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ul>;
        if (n.kind === "ol") return <ol key={i} className="list-decimal pl-5 my-1 space-y-0.5">{n.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ol>;
        const [head, ...rows] = n.rows;
        return (
          <div key={i} className="overflow-x-auto my-2">
            <table className="text-[12.5px] min-w-full border-collapse">
              {head && <thead><tr>{head.map((c, j) => <th key={j} className="text-left font-semibold px-2 py-1 border-b border-line">{c}</th>)}</tr></thead>}
              <tbody>{rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} className="px-2 py-1 border-b border-line/60 align-top"><Inline text={c} /></td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

const BLOCK_RE = /^(donnée|données|analyse|hypothèse|hypothèses|recommandation|recommandations)\s*:?\s*$/i;
const canon = (t: string) => { const k = t.toLowerCase().replace(/s$/, "").replace(/\s*:$/, ""); return k === "donnee" ? "donnée" : k; };

/** Découpe la réponse en blocs étiquetés ; le texte hors bloc est rendu tel quel. */
export function AnswerBlocks({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const nodes = parse(text);
  const sections: { title: string | null; nodes: Node[] }[] = [];
  for (const n of nodes) {
    if (n.kind === "h" && BLOCK_RE.test(n.text)) { sections.push({ title: canon(n.text.replace(/\s*:$/, "")), nodes: [] }); continue; }
    if (!sections.length) sections.push({ title: null, nodes: [] });
    sections[sections.length - 1].nodes.push(n);
  }
  return (
    <div className="text-[13.5px] text-ink space-y-2">
      {sections.map((s, i) => s.title ? (
        <section key={i} className={`rounded-lg border px-3 py-2 ${BLOCK_TONE[s.title] ?? "bg-surface border-line"}`}>
          <div className="label mb-1 capitalize">{s.title}</div>
          <Body nodes={s.nodes} />
        </section>
      ) : <div key={i}><Body nodes={s.nodes} /></div>)}
      {streaming && <span className="inline-block w-2 h-4 bg-accent/70 animate-pulse align-middle" aria-hidden />}
    </div>
  );
}
