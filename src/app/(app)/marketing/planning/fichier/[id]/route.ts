import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/access";
import { readAsset } from "@/lib/content/assets";

/** Sert un livrable ou une référence (image, vidéo, PDF…) stocké en base. Lecture réservée au module Marketing. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireAccess("marketing");
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Introuvable", { status: 404 });
  const a = await readAsset(id);
  if (!a) return new NextResponse("Introuvable", { status: 404 });
  const inline = a.mime.startsWith("image/") || a.mime.startsWith("video/") || a.mime === "application/pdf";
  return new NextResponse(new Uint8Array(a.data), {
    headers: {
      "Content-Type": a.mime,
      "Content-Length": String(a.data.byteLength),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
