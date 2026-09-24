/**
 * Recouvrement — règles pures (partagé client / serveur, sans base) : statuts d'un règlement, solde
 * d'une facture, encours de risque, balance âgée, niveau de relance, imputation proposée par
 * échéance, message de relance, contrôles de bascule. L'écriture vit dans `payments.ts`.
 */
import { SCALE, formatScaled, parseDecimal } from "./money";

export const PAYMENT_STATUSES = ["PORTEFEUILLE", "REMIS", "ENCAISSE", "IMPAYE", "ANNULE"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_META: Record<PaymentStatus, { label: string; tone: "gray" | "blue" | "green" | "red" | "orange" }> = {
  PORTEFEUILLE: { label: "En portefeuille", tone: "orange" },
  REMIS: { label: "Remis en banque", tone: "blue" },
  ENCAISSE: { label: "Encaissé", tone: "green" },
  IMPAYE: { label: "Impayé", tone: "red" },
  ANNULE: { label: "Annulé", tone: "gray" },
};

/** Statuts suivants possibles. Un encaissé peut encore revenir impayé (chèque rejeté après crédit). */
export function nextPaymentStatuses(status: PaymentStatus): PaymentStatus[] {
  switch (status) {
    case "PORTEFEUILLE": return ["REMIS", "ENCAISSE", "IMPAYE", "ANNULE"];
    case "REMIS": return ["ENCAISSE", "IMPAYE"];
    case "ENCAISSE": return ["IMPAYE"];
    default: return [];
  }
}
/** Statut à l'enregistrement : encaissé pour un virement ou des espèces, en portefeuille sinon. */
export const initialPaymentStatus = (collectedOnReceipt: boolean): PaymentStatus => (collectedOnReceipt ? "ENCAISSE" : "PORTEFEUILLE");
/** Un règlement impayé ou annulé ne solde plus rien : ses imputations cessent de compter. */
export const paymentSettles = (s: PaymentStatus) => s !== "IMPAYE" && s !== "ANNULE";

const m = (v: string | null | undefined) => parseDecimal(v ?? "0", SCALE.money) ?? 0n;
const f = (v: bigint) => formatScaled(v, SCALE.money);

/**
 * Solde d'une facture = TTC − déjà réglé avant reprise − imputations de règlements valides et d'avoirs.
 * Jamais négatif : un trop-perçu reste sur le règlement (non imputé), pas sur la facture.
 */
export function invoiceBalance(ttc: string, reprisePaid: string, allocations: { amount: string; settles: boolean }[]): string {
  const paid = m(reprisePaid) + allocations.filter((a) => a.settles).reduce((s, a) => s + m(a.amount), 0n);
  const b = m(ttc) - paid;
  return f(b > 0n ? b : 0n);
}

/** Retard en jours à une date (négatif : pas encore échu). */
export function daysOverdue(dueDate: string | null, todayIso: string): number | null {
  if (!dueDate) return null;
  return Math.round((new Date(`${todayIso}T12:00:00Z`).getTime() - new Date(`${dueDate}T12:00:00Z`).getTime()) / 86400000);
}

export const AGING_BUCKETS = ["NON_ECHU", "0_30", "31_60", "61_90", "90P"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];
export const AGING_LABELS: Record<AgingBucket, string> = { NON_ECHU: "Non échu", "0_30": "1 à 30 j", "31_60": "31 à 60 j", "61_90": "61 à 90 j", "90P": "Plus de 90 j" };

/** Tranche de la balance âgée d'après le retard sur l'échéance (sans échéance : non échu). */
export function agingBucket(dueDate: string | null, todayIso: string): AgingBucket {
  const d = daysOverdue(dueDate, todayIso);
  if (d === null || d <= 0) return "NON_ECHU";
  if (d <= 30) return "0_30";
  if (d <= 60) return "31_60";
  if (d <= 90) return "61_90";
  return "90P";
}

/** Balance âgée par client : total par tranche et total général (montants exacts). */
export function agedBalance(rows: { clientId: string; dueDate: string | null; balance: string }[], todayIso: string) {
  const out = new Map<string, Record<AgingBucket | "total", bigint>>();
  for (const r of rows) {
    const b = m(r.balance);
    if (b <= 0n) continue;
    const cur = out.get(r.clientId) ?? { NON_ECHU: 0n, "0_30": 0n, "31_60": 0n, "61_90": 0n, "90P": 0n, total: 0n };
    cur[agingBucket(r.dueDate, todayIso)] += b;
    cur.total += b;
    out.set(r.clientId, cur);
  }
  return new Map([...out].map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([b, x]) => [b, f(x)])) as Record<AgingBucket | "total", string>]));
}

/** Niveau de relance d'après le retard (0 = pas de relance) ; `thresholds` croissants, en jours. */
export function reminderLevel(daysLate: number | null, thresholds: number[]): number {
  if (daysLate === null || daysLate <= 0) return 0;
  let level = 0;
  thresholds.forEach((t, i) => { if (daysLate >= t) level = i + 1; });
  return level;
}

/**
 * Imputation proposée d'un règlement : les factures les plus anciennes d'abord (échéance, puis date),
 * chacune soldée jusqu'à épuisement du montant. Rien n'est imputé au-delà du solde d'une facture.
 */
export function planAllocation(amount: string, invoices: { id: string; dueDate: string | null; date: string; balance: string }[]): { invoiceId: string; amount: string }[] {
  let left = m(amount);
  const sorted = [...invoices].sort((a, b) => (a.dueDate ?? a.date).localeCompare(b.dueDate ?? b.date) || a.date.localeCompare(b.date));
  const out: { invoiceId: string; amount: string }[] = [];
  for (const i of sorted) {
    if (left <= 0n) break;
    const b = m(i.balance);
    if (b <= 0n) continue;
    const take = b < left ? b : left;
    out.push({ invoiceId: i.id, amount: f(take) });
    left -= take;
  }
  return out;
}

const fr = (v: string) => Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const frDate = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

/** Message de relance (WhatsApp / e-mail), ton gradué selon le niveau. */
export function reminderText(level: number, company: string, client: string, invoices: { number: string; dueDate: string | null; balance: string }[]): string {
  const total = f(invoices.reduce((s, i) => s + m(i.balance), 0n));
  const head = level >= 3
    ? `Bonjour,\n\nMalgré nos précédents rappels, les factures suivantes de ${client} restent impayées :`
    : level === 2
      ? `Bonjour,\n\nSauf erreur de notre part, les factures suivantes de ${client} sont échues et restent à régler :`
      : `Bonjour,\n\nPetit rappel : les factures suivantes de ${client} sont arrivées à échéance :`;
  const lines = invoices.map((i) => `- ${i.number} (échéance ${frDate(i.dueDate)}) : ${fr(i.balance)} MAD`).join("\n");
  const tail = level >= 3
    ? "Merci de procéder au règlement sans délai ou de nous contacter pour convenir d'un échéancier."
    : "Merci de nous indiquer la date de règlement prévue. Si le paiement a déjà été effectué, merci de ne pas tenir compte de ce message.";
  return `${head}\n${lines}\n\nTotal : ${fr(total)} MAD\n\n${tail}\n\nCordialement,\n${company}`;
}

/* ------------------------------------------------------------------ */
/* Bascule                                                             */
/* ------------------------------------------------------------------ */

export type CutoverCheck = { key: string; label: string; ok: boolean; detail: string; blocking: boolean };

/** Ce qui empêche de passer en mode ACTIF (les contrôles non bloquants sont des avertissements). */
export const cutoverBlockers = (checks: CutoverCheck[]) => checks.filter((c) => c.blocking && !c.ok);

/**
 * Comparaison du rapport de contrôle (COMANET OS contre Sage) : un écart d'un centime par pièce au plus
 * est un écart d'arrondi (Sage arrondit autrement ses exports, §1.4 du plan), pas une anomalie.
 */
export function controlGap(os: string, sage: string, pieces: number): { gap: string; rounding: boolean } {
  const g = m(os) - m(sage);
  const abs = g < 0n ? -g : g;
  return { gap: f(g), rounding: abs > 0n && abs <= BigInt(Math.max(1, pieces)) };
}

/* ------------------------------------------------------------------ */
/* Reprise des factures ouvertes de Sage                              */
/* ------------------------------------------------------------------ */

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const REPRISE_SYNONYMS: Record<"accountCode" | "client" | "number" | "date" | "dueDate" | "ttc" | "balance", string[]> = {
  accountCode: ["CODE CLIENT", "N CLIENT", "NUMERO CLIENT", "COMPTE", "CODE TIERS", "TIERS"],
  client: ["CLIENT", "RAISON SOCIALE", "INTITULE", "NOM"],
  number: ["N PIECE", "PIECE", "NUMERO", "N FACTURE", "FACTURE", "NUMERO PIECE", "REFERENCE"],
  date: ["DATE", "DATE PIECE", "DATE FACTURE"],
  dueDate: ["ECHEANCE", "DATE ECHEANCE", "DATE D ECHEANCE"],
  ttc: ["MONTANT TTC", "TTC", "MONTANT", "TOTAL TTC", "NET A PAYER"],
  balance: ["RESTE A PAYER", "SOLDE", "RESTE DU", "RESTE", "MONTANT DU", "A PAYER"],
};
export type RepriseColumns = Partial<Record<keyof typeof REPRISE_SYNONYMS, string>>;

/** Colonnes d'un état Sage des factures non soldées, reconnues par leurs en-têtes (le plus précis d'abord). */
export function repriseColumns(headers: string[]): RepriseColumns {
  const out: RepriseColumns = {};
  const used = new Set<string>();
  const order: (keyof typeof REPRISE_SYNONYMS)[] = ["balance", "dueDate", "accountCode", "ttc", "number", "date", "client"];
  for (const field of order) {
    for (const syn of REPRISE_SYNONYMS[field]) {
      const h = headers.find((x) => !used.has(x) && norm(x) === syn) ?? headers.find((x) => !used.has(x) && norm(x).includes(syn));
      if (h) { out[field] = h; used.add(h); break; }
    }
  }
  return out;
}

/** Champs manquants pour reprendre des factures : n° de pièce, client (code ou nom), date, TTC et reste à payer. */
export function repriseMissing(c: RepriseColumns): string[] {
  const miss: string[] = [];
  if (!c.number) miss.push("N° de pièce");
  if (!c.accountCode && !c.client) miss.push("Code client ou nom du client");
  if (!c.date) miss.push("Date");
  if (!c.ttc) miss.push("Montant TTC");
  if (!c.balance) miss.push("Reste à payer");
  return miss;
}
