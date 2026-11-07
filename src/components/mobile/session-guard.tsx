"use client";

import { useEffect } from "react";
import { syncLocalUser } from "@/lib/mobile/local-data";

/**
 * Sur les pages de la version complète : garde le téléphone aligné sur la personne connectée (rien du compte précédent ne
 * reste affichable) et installe le service worker. Sur grand écran, le worker ne sert à rien : pas de préchargement.
 */
export function SessionGuard({ userId }: { userId: string }) {
  useEffect(() => {
    void syncLocalUser(userId);
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator && window.matchMedia("(max-width: 1023px)").matches) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, [userId]);
  return null;
}
