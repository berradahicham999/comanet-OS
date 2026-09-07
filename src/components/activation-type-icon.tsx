"use client";

import { PartyPopper, Handshake, Landmark, LayoutPanelTop, FlaskConical, Gift, Store, Newspaper, UserRound, Sparkles, type LucideProps } from "lucide-react";

const ICONS = { PartyPopper, Handshake, Landmark, LayoutPanelTop, FlaskConical, Gift, Store, Newspaper, UserRound, Sparkles } as const;

/** Pictogramme d'un type d'activation (clé lucide stockée dans `activation_types.icon`). */
export function ActivationTypeIcon({ icon, ...props }: { icon: string | null | undefined } & LucideProps) {
  const Icon = ICONS[(icon ?? "") as keyof typeof ICONS] ?? Sparkles;
  return <Icon {...props} />;
}
