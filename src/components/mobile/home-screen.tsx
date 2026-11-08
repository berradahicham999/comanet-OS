"use client";

import { ClientsScreen } from "./clients-screen";
import { useMobile } from "./mobile-app";
import { Skeleton } from "./mobile-shell";
import { TodayScreen } from "./today-screen";

/** `/m` est le point d'entrée unique de l'app. Déléguées et direction sont renvoyées vers leur propre écran par `MobileApp`. */
export function HomeScreen() {
  const { snapshot, phase } = useMobile();
  if (phase === "LOADING" || snapshot?.persona === "DELEGUE" || snapshot?.persona === "DIRECTION") return <Skeleton />;
  return snapshot?.persona === "COMMERCIAL" ? <ClientsScreen /> : <TodayScreen />;
}
