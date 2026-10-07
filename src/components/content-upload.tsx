"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip } from "lucide-react";
import { uploadInChunks } from "@/lib/chunked-upload";

type Kind = "BRIEF" | "LIVRABLE" | "REFERENCE";

/**
 * Dépôt d'un brief PDF, d'un livrable ou d'une référence, par morceaux (même mécanique que les imports).
 * Un brief est lu après l'envoi (le formulaire se remplit) : l'étape « Lecture du brief… » peut durer.
 */
export function ContentUpload({ contentId, kind, label, actions, accept, variant = "secondary" }: {
  contentId: string; kind: Kind; label: string; accept?: string; variant?: "primary" | "secondary";
  actions: {
    begin: (input: { contentId: string; kind: Kind; name: string; size: number; mime: string }) => Promise<{ id: string; chunkBytes: number }>;
    append: (fd: FormData) => Promise<{ received: number }>;
    finish: (input: { assetId: string }) => Promise<{ message?: string; error?: string } | void>;
  };
}) {
  const router = useRouter();
  const [pct, setPct] = useState<number | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setError(null); setInfo(null); setPct(0);
    try {
      const id = await uploadInChunks(file, { begin: (name, size) => actions.begin({ contentId, kind, name, size, mime: file.type }), append: actions.append }, setPct);
      setReading(kind === "BRIEF");
      const res = await actions.finish({ assetId: id });
      if (res?.error) setError(res.error);
      if (res?.message) setInfo(res.message);
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setPct(null); setReading(false); e.target.value = ""; }
  }
  const busy = pct !== null || reading;
  return (
    <div className="text-[12.5px]">
      <label className={`${variant === "primary" ? "btn-primary" : "btn-secondary"} btn-sm inline-flex items-center gap-1.5 cursor-pointer ${busy ? "opacity-60 pointer-events-none" : ""}`}>
        <Paperclip size={13} /> {reading ? "Lecture du brief…" : pct === null ? label : `Envoi… ${pct} %`}
        <input type="file" className="hidden" onChange={onChange} disabled={busy} accept={accept ?? "image/*,video/*,.pdf,.ai,.psd,.zip,.mp4,.mov"} />
      </label>
      {pct !== null && <div className="mt-1.5 h-1.5 w-full rounded-full bg-black/6 overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>}
      {error && <p className="text-red mt-1">{error}</p>}
      {info && <p className="text-green mt-1">{info}</p>}
    </div>
  );
}
