"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { uploadInChunks } from "@/lib/chunked-upload";
import { appendImportChunk, beginImportUpload } from "./actions";

export function ImportUploadForm({ types, defaultType }: { types: { key: string; label: string }[]; defaultType: string }) {
  const router = useRouter();
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = pct !== null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const file = (form.elements.namedItem("file") as HTMLInputElement).files?.[0];
    const type = (form.elements.namedItem("type") as HTMLSelectElement).value;
    if (!file) return;
    setError(null);
    setPct(0);
    try {
      const id = await uploadInChunks(file, { begin: beginImportUpload, append: appendImportChunk }, setPct);
      router.push(`/imports/nouveau?file=${id}&type=${type}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPct(null);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 text-[13px]">
      <label className="block"><span className="label block mb-1">Type de données</span>
        <select name="type" defaultValue={defaultType} className="select h-10" disabled={busy}>{types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
      </label>
      <label className="block"><span className="label block mb-1">Fichier (.xlsx, .xls, .csv)</span><input type="file" name="file" accept=".xlsx,.xls,.csv,.txt" className="block w-full text-[13px] file:mr-3 file:rounded-lg file:border-0 file:bg-accent-soft file:px-3 file:py-2 file:text-accent-2 file:font-medium" required disabled={busy} /></label>
      {error && <p className="text-red">{error}</p>}
      <button className="btn-primary w-full" type="submit" disabled={busy}>{busy ? (pct! < 100 ? `Téléversement… ${pct} %` : "Lecture du fichier…") : "Continuer → mapping des colonnes"}</button>
      {busy && <div className="h-1.5 w-full rounded-full bg-black/6 overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>}
    </form>
  );
}
