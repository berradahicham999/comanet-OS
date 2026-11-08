import type { Metadata } from "next";
import { MobileShell } from "@/components/mobile/mobile-shell";

/**
 * L'app mobile. Layout statique, sans lecture de session : c'est ce qui permet de l'ouvrir sans réseau.
 * Aucune donnée dans le HTML : tout vient de `/api/m/*`, qui vérifient les droits, puis d'IndexedDB.
 */
export const metadata: Metadata = { title: "COMANET" };

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return <MobileShell>{children}</MobileShell>;
}
