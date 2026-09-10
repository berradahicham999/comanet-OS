/** Export d'un rapport en Markdown (pièce jointe). */
import { getAccess } from "@/lib/permissions";
import { can } from "@/lib/permissions-shared";
import { getReport } from "@/lib/ai/reports";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await getAccess();
  if (!a || !can(a.perms, "rapports", "view")) return new Response("Non autorisé", { status: 403 });
  const { id } = await ctx.params;
  const r = await getReport(id);
  if (!r) return new Response("Introuvable", { status: 404 });
  if (a.scope !== "ALL" && r.brandId && !a.brandIds.includes(r.brandId)) return new Response("Non autorisé", { status: 403 });
  const md = `# ${r.title}\n\n_Statut : ${r.status} · généré le ${r.createdAt.slice(0, 10)}${r.model ? ` · ${r.model}` : ""}_\n\n${r.contentMd}\n`;
  const name = r.title.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return new Response(md, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${name || "rapport"}.md"` } });
}
