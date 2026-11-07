/**
 * Sessions par appareil — décisions pures, sans base ni cookie (testées dans `tests/mobile-socle.test.ts`).
 * L'écriture vit dans `src/lib/sessions.ts`, le jeton dans `src/lib/session-token.ts`.
 */

/** Durée d'une session sans activité. Chaque usage la prolonge (voir `renewedToken()`). */
export const SESSION_DAYS = 30;
export const SESSION_MAX_AGE_S = SESSION_DAYS * 86400;
/** Un jeton n'est réémis qu'une fois par jour : pas de cookie réécrit à chaque requête. */
export const RENEW_AFTER_S = 86400;

export type SessionRow = {
  revokedAt: Date | string | null;
  lastSeenAt: Date | string;
  /** Minutes d'inactivité tolérées ; `null` = pas de limite. */
  idleMinutes: number | null;
};

export type SessionVerdict = "OK" | "REVOKED" | "IDLE";

const ms = (d: Date | string) => new Date(d).getTime();

export function sessionVerdict(row: SessionRow, now: Date): SessionVerdict {
  if (row.revokedAt) return "REVOKED";
  if (row.idleMinutes && now.getTime() - ms(row.lastSeenAt) > row.idleMinutes * 60000) return "IDLE";
  return "OK";
}

/** `last_seen_at` n'est pas réécrit à chaque requête : chaque minute sous limite d'inactivité, chaque heure sinon. */
export function touchDue(row: SessionRow, now: Date): boolean {
  const every = row.idleMinutes ? 60000 : 3600000;
  return now.getTime() - ms(row.lastSeenAt) >= every;
}

/** Téléphone ou tablette : la limite d'inactivité ne vise que ces appareils, jamais le poste de bureau. */
export function isPhone(userAgent: string | null | undefined): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent ?? "");
}

/** Libellé lisible par un administrateur (« Android · Chrome »). */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const os = /iPhone/i.test(ua) ? "iPhone"
    : /iPad/i.test(ua) ? "iPad"
    : /Android/i.test(ua) ? "Android"
    : /Mac OS X|Macintosh/i.test(ua) ? "Mac"
    : /Windows/i.test(ua) ? "Windows"
    : /Linux/i.test(ua) ? "Linux"
    : "Appareil inconnu";
  const browser = /EdgA?\//i.test(ua) ? "Edge"
    : /SamsungBrowser/i.test(ua) ? "Samsung Internet"
    : /Firefox|FxiOS/i.test(ua) ? "Firefox"
    : /Chrome|CriOS/i.test(ua) ? "Chrome"
    : /Safari/i.test(ua) ? "Safari"
    : null;
  return browser ? `${os} · ${browser}` : os;
}
