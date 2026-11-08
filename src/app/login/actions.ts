"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, destroySession, verifyCredentials } from "@/lib/auth";
import { homeForUser, isAdmin } from "@/lib/access";
import { resolveAccessFor } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { isPhone } from "@/lib/sessions-shared";

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");
  if (!email || !password) return { error: "Email et mot de passe requis." };
  const user = await verifyCredentials(email, password);
  if (!user) return { error: "Identifiants incorrects." };
  const userAgent = (await headers()).get("user-agent");
  const phone = isPhone(userAgent);
  // Limite d'inactivité : téléphones des administrateurs seulement (un téléphone perdu ouvre tout), jamais le poste de bureau.
  const idleMinutes = phone && isAdmin((await resolveAccessFor(user.id, user.role)).perms) ? (await getSettings()).mobile.adminIdleMinutes : null;
  await createSession(user, { userAgent, idleMinutes });
  if (next.startsWith("/") && !next.startsWith("//")) redirect(next);
  const home = await homeForUser();
  redirect(phone && home === "/terrain/saisie" ? "/m" : home);
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
