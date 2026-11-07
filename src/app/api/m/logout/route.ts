import { redirect } from "next/navigation";
import { destroySession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Déconnexion depuis la coquille `/m`, qui n'a pas de server action : ses écrans restent ouvrables sans réseau. */
export async function GET() {
  await destroySession();
  redirect("/login");
}
