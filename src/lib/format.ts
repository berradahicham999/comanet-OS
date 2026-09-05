const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 0 });

export function n(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const x = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(x) ? x : 0;
}

export function fmtNum(v: unknown, digits = 0) {
  return (digits ? nf1 : nf0).format(n(v));
}

/** 425 605 MAD */
export function fmtMAD(v: unknown, opts: { compact?: boolean; suffix?: boolean } = {}) {
  const x = n(v);
  const suffix = opts.suffix === false ? "" : " MAD";
  if (opts.compact) {
    const abs = Math.abs(x);
    if (abs >= 1_000_000) return `${nf1.format(x / 1_000_000)} M${suffix}`;
    if (abs >= 10_000) return `${nf0.format(x / 1000)} k${suffix}`;
    if (abs >= 1_000) return `${nf1.format(x / 1000)} k${suffix}`;
  }
  return `${nf0.format(x)}${suffix}`;
}

export function fmtPct(v: unknown, digits = 0, signed = false) {
  const x = n(v);
  const s = (digits ? nf1 : nf0).format(x);
  return `${signed && x > 0 ? "+" : ""}${s} %`;
}

/** Variation en % entre a (nouveau) et b (référence). null si b = 0. */
export function delta(a: unknown, b: unknown): number | null {
  const x = n(a), y = n(b);
  if (!y) return null;
  return ((x - y) / Math.abs(y)) * 100;
}

const df = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const dfShort = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const dfLong = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const dfMonth = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

export function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = typeof v === "string" ? new Date(v.length === 10 ? v + "T12:00:00Z" : v) : v;
  return Number.isNaN(d.getTime()) ? null : d;
}
export function fmtDate(v: string | Date | null | undefined) {
  const d = toDate(v);
  return d ? df.format(d) : "—";
}
export function fmtDateShort(v: string | Date | null | undefined) {
  const d = toDate(v);
  return d ? dfShort.format(d) : "—";
}
export function fmtDateLong(v: string | Date | null | undefined) {
  const d = toDate(v);
  return d ? dfLong.format(d) : "—";
}
export function fmtMonth(v: string | Date | null | undefined) {
  const d = toDate(v);
  if (!d) return "—";
  const s = dfMonth.format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
export function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 86400000);
}
export function startOfMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
export function addMonths(d: Date, m: number) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, 1));
}
export function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
/** Fuseau de l'entreprise : les serveurs cloud tournent en UTC, la journée métier est celle de Casablanca. */
export const BUSINESS_TZ = process.env.BUSINESS_TZ || "Africa/Casablanca";

const ymdInTz = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** Date du jour (à midi UTC, sans composante horaire) dans le fuseau de l'entreprise. */
export function today() {
  const [y, m, d] = ymdInTz.format(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function months(v: number) {
  if (!Number.isFinite(v)) return "∞";
  return `${nf1.format(v)} mois`;
}

export function initials(name: string) {
  return name
    .split(/[\s-]+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function plural(count: number, one: string, many = one + "s") {
  return `${fmtNum(count)} ${count > 1 ? many : one}`;
}
