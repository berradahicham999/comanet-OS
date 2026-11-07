import { swSource } from "@/lib/mobile/sw-source";

// Figé au build : un nouveau déploiement change la version, donc le contenu, et le téléphone installe le nouveau worker.
export const dynamic = "force-static";

const VERSION = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? String(Date.now());

export function GET() {
  return new Response(swSource(VERSION), {
    headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/" },
  });
}
