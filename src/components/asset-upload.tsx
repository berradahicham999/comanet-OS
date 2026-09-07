"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Camera } from "lucide-react";
import { uploadInChunks } from "@/lib/chunked-upload";

/**
 * Dépôt d'un fichier (devis, facture, photo, visuel, compte rendu…) pour n'importe quel
 * propriétaire, par morceaux. `begin` reçoit le type de fichier choisi ici, l'appelant
 * fixe le propriétaire dans l'action serveur.
 */
export function AssetUpload({ ownerId, kind, label, camera = false, accept, actions, className }: {
  /** Identifiant du propriétaire (activation, article) transmis tel quel à `begin`. */
  ownerId: string; kind: string; label: string; camera?: boolean; accept?: string; className?: string;
  actions: {
    begin: (input: { ownerId: string; kind: string; name: string; size: number; mime: string }) => Promise<{ id: string; chunkBytes: number }>;
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
      const id = await uploadInChunks(file, { begin: (name, size) => actions.begin({ ownerId, kind, name, size, mime: file.type }), append: actions.append }, setPct);
      await actions.finish({ assetId: id });
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setPct(null); e.target.value = ""; }
  }
  return (
    <div className={`text-[12.5px] ${className ?? ""}`}>
      <label className={`btn-secondary btn-sm inline-flex items-center gap-1.5 cursor-pointer ${pct !== null ? "opacity-60 pointer-events-none" : ""}`}>
        {camera ? <Camera size={13} /> : <Paperclip size={13} />} {pct === null ? label : `Envoi… ${pct} %`}
        <input type="file" className="hidden" onChange={onChange} disabled={pct !== null}
          accept={accept ?? (camera ? "image/*" : "image/*,video/*,.pdf,.xlsx,.xls,.docx,.doc,.zip")} capture={camera ? "environment" : undefined} />
      </label>
      {pct !== null && <div className="mt-1.5 h-1.5 w-full rounded-full bg-black/6 overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>}
      {error && <p className="text-red mt-1">{error}</p>}
    </div>
  );
}
