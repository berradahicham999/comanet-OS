"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next ?? ""} />
      <div>
        <label className="label block mb-1.5" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required className="input" placeholder="prenom@comanet.ma" />
      </div>
      <div>
        <label className="label block mb-1.5" htmlFor="password">Mot de passe</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </div>
      {state.error && <p className="text-sm text-red">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn-primary w-full mt-2">
        {pending ? "Connexion…" : "Se connecter"}
      </button>
    </form>
  );
}
