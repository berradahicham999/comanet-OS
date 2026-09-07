"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip } from "lucide-react";
import { uploadInChunks } from "@/lib/chunked-upload";

/** Dépôt d'un livrable ou d'une référence, par morceaux (même mécanique que les imports). */
export function ContentUpload({ contentId, kind, label, actions }: {
  contentId: string; kind: "LIVRABLE" | "REFERENCE"; label: string;
  actions: {
    begin: (input: { contentId: string; kind: "LIVRABLE" | "REFERENCE"; name: string; size: number; mime: string }) => Promise<{ id: string; chunkBytes: number }>;
    append: (fd: FormData) => Promise<{ received: number }>;
    finish: (input: { assetId: string }) => Promise<void>;
  };
}) {
  const router = useRouter();
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setError(null); setPct(0);
    try {
      const id = await uploadInChunks(file, { begin: (name, size) => actions.begin({ contentId, kind, name, size, mime: file.type }), append: actions.append }, setPct);
      await actions.finish({ assetId: id });
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setPct(null); e.target.value = ""; }
  }
  return (
    <div className="text-[12.5px]">
      <label className={`btn-secondary btn-sm inline-flex items-center gap-1.5 cursor-pointer ${pct !== null ? "opacity-60 pointer-events-none" : ""}`}>
        <Paperclip size={13} /> {pct === null ? label : `Envoi… ${pct} %`}
        <input type="file" className="hidden" onChange={onChange} disabled={pct !== null} accept="image/*,video/*,.pdf,.ai,.psd,.zip,.mp4,.mov" />
      </label>
      {pct !== null && <div className="mt-1.5 h-1.5 w-full rounded-full bg-black/6 overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>}
      {error && <p className="text-red mt-1">{error}</p>}
    </div>
  );
}
