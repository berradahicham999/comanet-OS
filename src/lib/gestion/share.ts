import "server-only";
import { SignJWT, jwtVerify } from "jose";

/**
 * Lien public d'une pièce validée (WhatsApp, e-mail) : jeton signé, limité à UNE pièce et à une
 * durée (`settings.gestion.shareLinkDays`). Clé dérivée distincte de celle des sessions : un lien
 * partagé ne peut jamais servir de session.
 */
function key() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET manquant ou trop court");
  return new TextEncoder().encode(`${s}:partage-piece`);
}

export async function shareToken(documentId: string, days: number): Promise<string> {
  return new SignJWT({ k: "piece" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(documentId)
    .setAudience("piece")
    .setIssuedAt()
    .setExpirationTime(`${Math.max(1, Math.round(days))}d`)
    .sign(key());
}

/** Identifiant de la pièce, ou null si le jeton est invalide ou expiré. */
export async function readShareToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { audience: "piece" });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
