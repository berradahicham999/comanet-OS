"use server";

import { redirect } from "next/navigation";
import { createSession, destroySession, verifyCredentials } from "@/lib/auth";
import { homeForUser } from "@/lib/access";

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");
  if (!email || !password) return { error: "Email et mot de passe requis." };
  const user = await verifyCredentials(email, password);
  if (!user) return { error: "Identifiants incorrects." };
  await createSession(user);
  redirect(next && next.startsWith("/") ? next : await homeForUser());
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
