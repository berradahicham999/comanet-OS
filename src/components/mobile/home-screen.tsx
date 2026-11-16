"use client";

import { ClientsScreen } from "./clients-screen";
import { useMobile } from "./mobile-app";
import { Skeleton } from "./mobile-shell";
import { TodayScreen } from "./today-screen";

/**
 * `/m` est le point d'entrée unique de l'app. Déléguées et direction sont renvoyées vers leur propre écran par `MobileApp`,
 * comme une déléguée qui anime aussi quand son dernier côté était la visite médicale : rien ne s'affiche avant l'aiguillage.
 */
export function HomeScreen() {
  const { snapshot, phase, personas, settled } = useMobile();
  if (phase === "LOADING" || (phase === "READY" && !settled)) return <Skeleton />;
  if (personas.includes("COMMERCIAL")) return <ClientsScreen />;
  if (snapshot && !personas.includes("ANIMATRICE")) return <Skeleton />;
  return <TodayScreen />;
}
