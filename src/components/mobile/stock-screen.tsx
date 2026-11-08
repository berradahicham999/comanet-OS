"use client";

import { useState } from "react";
import type { MobileClient } from "@/lib/mobile/snapshot-shared";
import { ClientPicker } from "./client-picker";
import { useMobile } from "./mobile-app";
import { NoData, Skeleton } from "./mobile-shell";
import { StockEditor } from "./stock-editor";

/** Stock du point de vente, pour l'animatrice : le choix du point de vente, puis le relevé. */
export function StockScreen() {
  const { phase, snapshot, online } = useMobile();
  const t = snapshot?.terrain ?? null;
  const [picked, setPicked] = useState<MobileClient | null>(null);

  if (phase === "LOADING") return <Skeleton />;
  if (!t) return <NoData />;
  const client = picked ?? t.clients.find((c) => c.id === (t.planned[0]?.clientId ?? t.lastClientId)) ?? null;

  return (
    <div className="space-y-4">
      <h1 className="text-[20px] font-semibold text-ink">Stock du point de vente</h1>
      <section>
        <span className="label block mb-1">Point de vente</span>
        <ClientPicker clients={t.clients} value={client} onChange={setPicked} online={online} />
      </section>
      {client && <StockEditor key={client.id} client={client} products={t.products} favoriteIds={t.favoriteIds} last={t.lastStock[client.id] ?? {}} />}
    </div>
  );
}
