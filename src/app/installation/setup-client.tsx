"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadInChunks } from "@/lib/chunked-upload";
import type { WorkbookResult } from "@/lib/import/workbook";
import { appendWorkbookChunk, beginWorkbookUpload, enterSetupKeyAction, runWorkbookAction, type ActionResult } from "./actions";

/* ------------------------------ Clé d'accès ------------------------------ */

export function SetupKeyForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(enterSetupKeyAction, null);
  return (
    <form action={action} className="space-y-3">
      <div>
        <label className="label block mb-1.5" htmlFor="key">Clé d&apos;installation</label>
        <input id="key" name="key" type="password" autoComplete="off" required className="input" placeholder="Valeur de SETUP_KEY" />
        <p className="text-[11.5px] text-faint mt-1">Définie dans les variables d&apos;environnement de l&apos;hébergeur (Vercel → Settings → Environment Variables).</p>
      </div>
      {state && !state.ok && <p className="text-sm text-red">{state.message}</p>}
      <button type="submit" disabled={pending} className="btn-primary w-full">{pending ? "Vérification…" : "Continuer"}</button>
    </form>
  );
}

/* ---------------------------- Bouton d'action ---------------------------- */

export function ActionButton({ action, label, pendingLabel, secondary, confirm }: { action: () => Promise<ActionResult>; label: string; pendingLabel?: string; secondary?: boolean; confirm?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        className={secondary ? "btn-secondary" : "btn-primary"}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const r = await action();
            setResult(r);
            router.refresh();
          });
        }}
      >
        {pending ? (pendingLabel ?? "En cours…") : label}
      </button>
      {result && (
        <div className={`mt-2 text-[12.5px] ${result.ok ? "text-green" : "text-red"}`}>
          {result.message}
          {result.details?.length ? <ul className="mt-1 text-muted list-disc pl-4">{result.details.map((d, i) => <li key={i}>{d}</li>)}</ul> : null}
        </div>
      )}
    </div>
  );
}

/* ---------------------------- Classeur compilé --------------------------- */

const n = (v: number) => v.toLocaleString("fr-FR");

type Phase = { kind: "idle" } | { kind: "upload"; pct: number } | { kind: "import" } | { kind: "done"; result: WorkbookResult; log: string[] } | { kind: "error"; message: string; log: string[] };

export function WorkbookUploader({ hasData }: { hasData: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [reset, setReset] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const busy = phase.kind === "upload" || phase.kind === "import";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (reset && !window.confirm("Toutes les données importées (ventes, stock, clients, produits, budgets, tâches…) seront supprimées avant le chargement. Continuer ?")) return;
    try {
      setPhase({ kind: "upload", pct: 0 });
      const id = await uploadInChunks(file, { begin: beginWorkbookUpload, append: appendWorkbookChunk }, (pct) => setPhase({ kind: "upload", pct }));
      setPhase({ kind: "import" });
      const r = await runWorkbookAction(id, reset);
      if (r.ok) setPhase({ kind: "done", result: r.result, log: r.log });
      else setPhase({ kind: "error", message: r.message, log: r.log });
      router.refresh();
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err), log: [] });
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 text-[13px]">
      <label className="block"><span className="label block mb-1">Classeur « Compilé 2026 » (.xlsx)</span><input type="file" name="file" accept=".xlsx,.xls" required disabled={busy} className="block w-full text-[13px] file:mr-3 file:rounded-lg file:border-0 file:bg-accent-soft file:px-3 file:py-2 file:text-accent-2 file:font-medium" /></label>
      <p className="text-[11.5px] text-faint">Feuilles lues : « Correspondance CLIENTS », « Correspondance MARQUES », « Compil a a date » (ventes 2025-2026), « Sheet3 » (ventes 2024), « stock », « objectif 2026 » (objectifs + budgets). Une feuille absente est simplement ignorée. Les lignes déjà présentes sont dédoublonnées : recharger le même classeur est sans risque.</p>
      {hasData && (
        <label className="flex items-start gap-2 text-[12.5px]"><input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} disabled={busy} className="mt-0.5" /><span><b>Réinitialiser avant chargement</b> — supprime toutes les données importées (ventes, stock, clients, produits, budgets, terrain, tâches). Utilisateurs, marques et paramètres sont conservés.</span></label>
      )}
      <button type="submit" disabled={busy} className="btn-primary w-full">
        {phase.kind === "upload" ? `Téléversement… ${phase.pct} %` : phase.kind === "import" ? "Chargement en cours (1 à 5 min)…" : "Charger le classeur"}
      </button>
      {phase.kind === "upload" && <div className="h-1.5 w-full rounded-full bg-black/6 overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${phase.pct}%` }} /></div>}
      {phase.kind === "import" && <p className="text-[12px] text-muted">Ne fermez pas cette page. Le moteur rapproche les désignations, dédoublonne et calcule les agrégats.</p>}
      {phase.kind === "error" && <div className="rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{phase.message}</div>}
      {phase.kind === "done" && (
        <div className="space-y-2">
          <div className="rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green">
            Chargement terminé : {n(phase.result.stats.sales)} lignes de vente ({n(Math.round(phase.result.stats.ca))} MAD), {phase.result.stats.products} produits ({phase.result.stats.productsReview} à qualifier), {phase.result.stats.clients} clients ({phase.result.stats.clientsReview} à qualifier).
          </div>
          <div className="table-wrap"><table className="tbl text-[12px]"><thead><tr><th>Étape</th><th className="num">Insérés</th><th className="num">MAJ</th><th className="num">Doublons</th><th className="num">Erreurs</th></tr></thead><tbody>
            {phase.result.steps.map((s) => (
              <tr key={s.label}><td>{s.label}{s.skipped && <span className="text-faint"> — ignoré ({s.skipped})</span>}{s.warnings.length > 0 && <div className="text-[11px] text-orange">{s.warnings.slice(0, 3).join(" · ")}</div>}{s.firstErrors.length > 0 && <div className="text-[11px] text-red">{s.firstErrors.join(" · ")}</div>}</td><td className="num">{n(s.inserted)}</td><td className="num">{n(s.updated)}</td><td className="num">{n(s.duplicates)}</td><td className={`num ${s.errors ? "text-red" : ""}`}>{n(s.errors)}</td></tr>
            ))}
          </tbody></table></div>
        </div>
      )}
      {(phase.kind === "done" || phase.kind === "error") && phase.log.length > 0 && (
        <div>
          <button type="button" className="text-[12px] text-muted hover:underline" onClick={() => setShowLog((v) => !v)}>{showLog ? "Masquer" : "Afficher"} le journal détaillé</button>
          {showLog && <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-black/5 p-3 text-[11px] leading-relaxed whitespace-pre-wrap">{phase.log.join("\n")}</pre>}
        </div>
      )}
    </form>
  );
}
