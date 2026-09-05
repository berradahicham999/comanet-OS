"use client";

/**
 * Téléversement par morceaux (côté navigateur) : contourne la limite de taille des requêtes
 * des hébergeurs serverless (Vercel : 4,5 Mo). `begin` crée le fichier en base, `append` ajoute
 * chaque morceau (FormData : `id` + `chunk`).
 */
export type ChunkActions = {
  begin: (name: string, size: number) => Promise<{ id: string; chunkBytes: number }>;
  append: (formData: FormData) => Promise<{ received: number }>;
};

export async function uploadInChunks(file: File, actions: ChunkActions, onProgress?: (pct: number) => void): Promise<string> {
  const { id, chunkBytes } = await actions.begin(file.name, file.size);
  let offset = 0;
  while (offset < file.size) {
    const slice = file.slice(offset, Math.min(offset + chunkBytes, file.size));
    const fd = new FormData();
    fd.set("id", id);
    fd.set("chunk", slice, "chunk.bin");
    const { received } = await actions.append(fd);
    if (received <= offset) throw new Error("Téléversement interrompu.");
    offset = received;
    onProgress?.(Math.round((offset / file.size) * 100));
  }
  onProgress?.(100);
  return id;
}
