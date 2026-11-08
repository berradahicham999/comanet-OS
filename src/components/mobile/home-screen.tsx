"use client";

import { ClientsScreen } from "./clients-screen";
import { useMobile } from "./mobile-app";
import { TodayScreen } from "./today-screen";

/** `/m` est l'unique point d'entrée de l'app : l'écran dépend du métier de la personne connectée. */
export function HomeScreen() {
  const { snapshot } = useMobile();
  return snapshot?.persona === "COMMERCIAL" ? <ClientsScreen /> : <TodayScreen />;
}
