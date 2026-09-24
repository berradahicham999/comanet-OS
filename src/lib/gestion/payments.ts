import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { paymentAllocations, paymentReminders, payments } from "@/db/schema";
import { audit, type AuditActor } from "@/lib/audit";
import { iso, today } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { pgArray } from "@/lib/sql-array";
import { emitsReal } from "./documents-shared";
import { SCALE, formatScaled, parseDecimal } from "./money";
import { allocateNumber } from "./numbering";
import { agingBucket, daysOverdue, initialPaymentStatus, nextPaymentStatuses, reminderLevel, type AgingBucket, type PaymentStatus } from "./receivables-shared";

/**
 * Règlements clients — SEUL module qui écrit `payments`, `payment_allocations` et `payment_reminders`
 * (garde-fou dans `tests/definitions-uniques.test.ts`). Un règlement garde son client, son montant, sa
 * date et son mode (triggers) ; son statut avance ; ses imputations se font et se défont (lettrage),
 * toujours bornées par le solde de la facture et le montant non imputé du règlement.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class PaymentError extends Error {}
const MODULE = "facturation" as const;
const m = (v: string | null | undefined) => parseDecimal(v ?? "0", SCALE.money) ?? 0n;
const f = (v: bigint) => formatScaled(v, SCALE.money);

/** Solde d'une facture en SQL (même définition que `invoiceBalance()`). */
const BALANCE_SQL = sql`(f.ttc - f.reprise_paid - coalesce((select sum(a.amount) from payment_allocations a left join payments p on p.id = a.payment_id
  where a.invoice_id = f.id and (a.credit_note_id is not null or p.status not in ('IMPAYE', 'ANNULE'))), 0))`;

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

export type OpenInvoice = {
  id: string; number: string; date: string; dueDate: string | null; clientId: string; client: string; city: string | null; ttc: string; balance: string;
  isSimulation: boolean; source: string; daysLate: number | null; bucket: AgingBucket;
};

/** Factures validées avec un solde (réelles ou de simulation selon `simulation`, toutes si non précisé). */
export async function openInvoices(opts: { clientId?: string; clientIds?: string[] | null; simulation?: boolean } = {}): Promise<OpenInvoice[]> {
  const t = iso(today());
  const r = await db.execute<Omit<OpenInvoice, "daysLate" | "bucket">>(sql`
    select f.id, f.number, f.date::text as date, f.due_date::text as "dueDate", f.client_id as "clientId", c.name as client, c.city,
      f.ttc::text as ttc, ${BALANCE_SQL}::text as balance, f.is_simulation as "isSimulation", f.source
    from sales_documents f join clients c on c.id = f.client_id
    where f.type = 'FACTURE' and f.status <> 'BROUILLON' and ${BALANCE_SQL} > 0
      ${opts.clientId ? sql`and f.client_id = ${opts.clientId}::uuid` : sql``}
      ${opts.clientIds ? (opts.clientIds.length ? sql`and f.client_id = any(${pgArray(opts.clientIds)})` : sql`and false`) : sql``}
      ${opts.simulation === undefined ? sql`` : sql`and f.is_simulation = ${opts.simulation}`}
    order by coalesce(f.due_date, f.date), f.number`);
  return r.rows.map((x) => ({ ...x, daysLate: daysOverdue(x.dueDate, t), bucket: agingBucket(x.dueDate, t) }));
}

/** Avoirs validés d'un client dont une partie n'est pas encore imputée (crédit disponible). */
export async function openCredits(clientId: string) {
  return (await db.execute<{ id: string; number: string; date: string; ttc: string; left: string; is_simulation: boolean }>(sql`
    select v.id, v.number, v.date::text as date, v.ttc::text as ttc, v.is_simulation,
      (v.ttc - coalesce((select sum(a.amount) from payment_allocations a where a.credit_note_id = v.id), 0))::text as left
    from sales_documents v where v.client_id = ${clientId}::uuid and v.type = 'AVOIR' and v.status <> 'BROUILLON'
      and v.ttc > coalesce((select sum(a.amount) from payment_allocations a where a.credit_note_id = v.id), 0) order by v.date`)).rows;
}

export type PaymentRow = {
  id: string; number: string; date: string; clientId: string; client: string; modeKey: string; mode: string; amount: string; allocated: string;
  reference: string | null; bank: string | null; dueDate: string | null; status: PaymentStatus; isSimulation: boolean;
};

export async function listPayments(opts: { clientIds?: string[] | null; status?: PaymentStatus; clientId?: string } = {}): Promise<PaymentRow[]> {
  return (await db.execute<PaymentRow>(sql`
    select p.id, p.number, p.date::text as date, p.client_id as "clientId", c.name as client, p.mode_key as "modeKey", pm.label as mode, p.amount::text as amount,
      coalesce((select sum(a.amount) from payment_allocations a where a.payment_id = p.id), 0)::text as allocated,
      p.reference, p.bank, p.due_date::text as "dueDate", p.status, p.is_simulation as "isSimulation"
    from payments p join clients c on c.id = p.client_id join payment_modes pm on pm.key = p.mode_key
    where true ${opts.status ? sql`and p.status = ${opts.status}` : sql``} ${opts.clientId ? sql`and p.client_id = ${opts.clientId}::uuid` : sql``}
      ${opts.clientIds ? (opts.clientIds.length ? sql`and p.client_id = any(${pgArray(opts.clientIds)})` : sql`and false`) : sql``}
    order by p.date desc, p.created_at desc limit 500`)).rows;
}

export async function getPayment(id: string) {
  const [p] = await db.select().from(payments).where(eq(payments.id, id));
  if (!p) return null;
  const [allocs, client, mode] = await Promise.all([
    db.execute<{ id: string; invoice_id: string; number: string; date: string; due_date: string | null; amount: string; ttc: string }>(sql`
      select a.id, a.invoice_id, f.number, f.date::text as date, f.due_date::text, a.amount::text, f.ttc::text from payment_allocations a
      join sales_documents f on f.id = a.invoice_id where a.payment_id = ${id}::uuid order by f.date`),
    db.execute<{ name: string; legal_name: string | null; city: string | null }>(sql`select name, legal_name, city from clients where id = ${p.clientId}::uuid`),
    db.execute<{ label: string; requires_due_date: boolean }>(sql`select label, requires_due_date from payment_modes where key = ${p.modeKey}`),
  ]);
  const allocated = allocs.rows.reduce((s, a) => s + m(a.amount), 0n);
  return { ...p, allocations: allocs.rows, allocated: f(allocated), unallocated: f(m(p.amount) - allocated), client: client.rows[0], mode: mode.rows[0] };
}

/** Règlements et avoirs imputés sur une facture, et son solde. */
export async function invoiceSettlement(invoiceId: string) {
  const [rows, bal] = await Promise.all([
    db.execute<{ id: string; amount: string; payment_id: string | null; payment_number: string | null; payment_status: PaymentStatus | null; mode: string | null; credit_id: string | null; credit_number: string | null; date: string }>(sql`
      select a.id, a.amount::text, a.payment_id, p.number as payment_number, p.status as payment_status, pm.label as mode, a.credit_note_id as credit_id, v.number as credit_number,
        coalesce(p.date, v.date)::text as date
      from payment_allocations a left join payments p on p.id = a.payment_id left join payment_modes pm on pm.key = p.mode_key left join sales_documents v on v.id = a.credit_note_id
      where a.invoice_id = ${invoiceId}::uuid order by coalesce(p.date, v.date)`),
    db.execute<{ balance: string; reprise: string }>(sql`select ${BALANCE_SQL}::text as balance, f.reprise_paid::text as reprise from sales_documents f where f.id = ${invoiceId}::uuid`),
  ]);
  return { allocations: rows.rows, balance: bal.rows[0]?.balance ?? "0", reprisePaid: bal.rows[0]?.reprise ?? "0" };
}

/* ------------------------------------------------------------------ */
/* Écriture                                                            */
/* ------------------------------------------------------------------ */

async function invoiceForAllocation(t: Tx, invoiceId: string) {
  const r = (await t.execute<{ client_id: string; is_simulation: boolean; type: string; status: string; number: string; balance: string }>(sql`
    select f.client_id, f.is_simulation, f.type, f.status, f.number, ${BALANCE_SQL}::text as balance from sales_documents f where f.id = ${invoiceId}::uuid for update`)).rows[0];
  if (!r || r.type !== "FACTURE" || r.status === "BROUILLON") throw new PaymentError("Facture introuvable ou non validée.");
  return r;
}

export type PaymentInput = {
  clientId: string; date: string; modeKey: string; amount: string; reference?: string | null; bank?: string | null; dueDate?: string | null; notes?: string | null;
  allocations?: { invoiceId: string; amount: string }[];
};

/**
 * Enregistre un règlement (numéro RG pris dans la transaction) et ses imputations. Un virement ou des
 * espèces sont encaissés d'emblée ; un chèque ou un effet entre en portefeuille. Un règlement d'avant la
 * bascule est une simulation : il ne solde que des factures de simulation.
 */
export async function createPayment(input: PaymentInput, actor: AuditActor): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new PaymentError("Date invalide.");
  if (input.date > iso(today())) throw new PaymentError("Un règlement ne se saisit pas à une date future (l'échéance d'un effet, si).");
  const amount = parseDecimal(input.amount, SCALE.money);
  if (amount === null || amount <= 0n) throw new PaymentError("Montant du règlement invalide.");
  const g = (await getSettings()).gestion;
  return db.transaction(async (tx) => {
    const mode = (await tx.execute<{ label: string; requires_due_date: boolean; collected_on_receipt: boolean; active: boolean }>(sql`
      select label, requires_due_date, collected_on_receipt, active from payment_modes where key = ${input.modeKey}`)).rows[0];
    if (!mode || !mode.active) throw new PaymentError("Mode de règlement inconnu.");
    if (mode.requires_due_date && !input.dueDate) throw new PaymentError(`${mode.label} : indiquez l'échéance.`);
    if (!mode.collected_on_receipt && !input.reference?.trim()) throw new PaymentError(`${mode.label} : indiquez le numéro (chèque, effet, LCN).`);
    const client = (await tx.execute<{ name: string }>(sql`select name from clients where id = ${input.clientId}::uuid`)).rows[0];
    if (!client) throw new PaymentError("Client introuvable.");
    const simulation = !emitsReal(g.cutover, { date: input.date, site: g.cutover.sites[0] ?? "COMANET" });
    const { number, year } = await allocateNumber(tx, "RG", input.date);
    const [p] = await tx.insert(payments).values({
      number, seriesKey: "RG", fiscalYear: year, clientId: input.clientId, date: input.date, modeKey: input.modeKey, amount: f(amount),
      reference: input.reference?.trim() || null, bank: input.bank?.trim() || null, dueDate: input.dueDate || null, status: initialPaymentStatus(mode.collected_on_receipt),
      isSimulation: simulation, collectedAt: mode.collected_on_receipt ? input.date : null, notes: input.notes?.trim() || null, createdById: actor.id,
    }).returning({ id: payments.id });
    let left = amount;
    for (const a of input.allocations ?? []) {
      const amt = parseDecimal(a.amount, SCALE.money) ?? 0n;
      if (amt <= 0n) continue;
      if (amt > left) throw new PaymentError("Imputations supérieures au montant du règlement.");
      await allocateIn(tx, { paymentId: p.id, clientId: input.clientId, simulation, invoiceId: a.invoiceId, amount: amt, actorId: actor.id });
      left -= amt;
    }
    await audit({ actor, action: "CREATE", module: MODULE, entity: "payment", entityId: p.id, label: `${number} — ${client.name}`, after: { amount: f(amount), mode: input.modeKey, allocated: f(amount - left), simulation } }, tx);
    return p.id;
  });
}

async function allocateIn(tx: Tx, a: { paymentId: string; clientId: string; simulation: boolean; invoiceId: string; amount: bigint; actorId: string | null }) {
  const inv = await invoiceForAllocation(tx, a.invoiceId);
  if (inv.client_id !== a.clientId) throw new PaymentError(`La facture ${inv.number} n'est pas de ce client.`);
  if (inv.is_simulation !== a.simulation) throw new PaymentError(`${inv.number} : on n'impute pas un règlement ${a.simulation ? "de simulation sur une facture réelle" : "réel sur une facture de simulation"}.`);
  if (a.amount > m(inv.balance)) throw new PaymentError(`${inv.number} : ${f(a.amount)} MAD dépasse son solde (${inv.balance} MAD).`);
  await tx.insert(paymentAllocations).values({ invoiceId: a.invoiceId, paymentId: a.paymentId, amount: f(a.amount), createdById: a.actorId });
}

/** Impute (lettre) une partie non imputée d'un règlement sur une facture du même client. */
export async function allocatePayment(paymentId: string, invoiceId: string, amountText: string, actor: AuditActor): Promise<void> {
  const amount = parseDecimal(amountText, SCALE.money);
  if (amount === null || amount <= 0n) throw new PaymentError("Montant invalide.");
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!p) throw new PaymentError("Règlement introuvable.");
    if (p.status === "IMPAYE" || p.status === "ANNULE") throw new PaymentError("Un règlement impayé ou annulé ne s'impute plus.");
    const used = m((await tx.execute<{ s: string }>(sql`select coalesce(sum(amount), 0)::text as s from payment_allocations where payment_id = ${paymentId}::uuid`)).rows[0].s);
    if (amount > m(p.amount) - used) throw new PaymentError(`Il reste ${f(m(p.amount) - used)} MAD à imputer sur ce règlement.`);
    await allocateIn(tx, { paymentId, clientId: p.clientId, simulation: p.isSimulation, invoiceId, amount, actorId: actor.id });
    await audit({ actor, action: "ALLOCATE", module: MODULE, entity: "payment", entityId: paymentId, label: p.number, after: { invoiceId, amount: f(amount) } }, tx);
  });
}

/** Impute un avoir (crédit client) sur une facture du même client. Utilisé aussi à la validation d'un avoir. */
export async function allocateCreditIn(tx: Tx, creditNoteId: string, invoiceId: string, amount: bigint, actorId: string | null): Promise<string> {
  const v = (await tx.execute<{ client_id: string; is_simulation: boolean; type: string; status: string; number: string; left: string }>(sql`
    select v.client_id, v.is_simulation, v.type, v.status, v.number, (v.ttc - coalesce((select sum(a.amount) from payment_allocations a where a.credit_note_id = v.id), 0))::text as left
    from sales_documents v where v.id = ${creditNoteId}::uuid`)).rows[0];
  if (!v || v.type !== "AVOIR" || v.status === "BROUILLON") throw new PaymentError("Avoir introuvable ou non validé.");
  const inv = await invoiceForAllocation(tx, invoiceId);
  if (inv.client_id !== v.client_id || inv.is_simulation !== v.is_simulation) throw new PaymentError("L'avoir et la facture ne sont pas du même client ou de la même nature.");
  const take = [amount, m(v.left), m(inv.balance)].reduce((a, b) => (b < a ? b : a));
  if (take <= 0n) return "0.00";
  await tx.insert(paymentAllocations).values({ invoiceId, creditNoteId, amount: f(take), createdById: actorId });
  return f(take);
}

export async function allocateCredit(creditNoteId: string, invoiceId: string, amountText: string, actor: AuditActor): Promise<void> {
  const amount = parseDecimal(amountText, SCALE.money);
  if (amount === null || amount <= 0n) throw new PaymentError("Montant invalide.");
  await db.transaction(async (tx) => {
    const done = await allocateCreditIn(tx, creditNoteId, invoiceId, amount, actor.id);
    await audit({ actor, action: "ALLOCATE", module: MODULE, entity: "sales_document", entityId: creditNoteId, after: { invoiceId, amount: done } }, tx);
  });
}

/** Défait une imputation (erreur de lettrage). La facture retrouve son solde, le règlement son disponible. */
export async function unallocate(allocationId: string, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const [a] = await tx.select().from(paymentAllocations).where(eq(paymentAllocations.id, allocationId)).for("update");
    if (!a) throw new PaymentError("Imputation introuvable.");
    await tx.delete(paymentAllocations).where(eq(paymentAllocations.id, allocationId));
    await audit({ actor, action: "UNALLOCATE", module: MODULE, entity: a.paymentId ? "payment" : "sales_document", entityId: a.paymentId ?? a.creditNoteId, after: { invoiceId: a.invoiceId, amount: a.amount } }, tx);
  });
}

/** Fait avancer un règlement : remis en banque, encaissé, impayé (avec motif), annulé (depuis le portefeuille). */
export async function setPaymentStatus(id: string, to: PaymentStatus, input: { date: string; reason?: string | null }, actor: AuditActor): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new PaymentError("Date invalide.");
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, id)).for("update");
    if (!p) throw new PaymentError("Règlement introuvable.");
    if (!nextPaymentStatuses(p.status as PaymentStatus).includes(to)) throw new PaymentError(`Passage impossible de « ${p.status} » à « ${to} ».`);
    if ((to === "IMPAYE" || to === "ANNULE") && !input.reason?.trim()) throw new PaymentError("Indiquez le motif (rejet de la banque, erreur de saisie…).");
    await tx.update(payments).set({
      status: to, updatedAt: new Date(),
      ...(to === "REMIS" ? { depositedAt: input.date } : {}), ...(to === "ENCAISSE" ? { collectedAt: input.date } : {}),
      ...(to === "IMPAYE" ? { bouncedAt: input.date } : {}), ...(input.reason ? { statusReason: input.reason.trim() } : {}),
    }).where(eq(payments.id, id));
    await audit({ actor, action: to === "IMPAYE" ? "BOUNCE" : to === "ANNULE" ? "CANCEL" : to === "REMIS" ? "DEPOSIT" : "COLLECT", module: MODULE, entity: "payment", entityId: id, label: p.number, before: { status: p.status }, after: { status: to, reason: input.reason ?? undefined } }, tx);
  });
}

/* ------------------------------------------------------------------ */
/* Relances                                                            */
/* ------------------------------------------------------------------ */

export type ReminderCandidate = {
  clientId: string; client: string; phone: string | null; email: string | null; overdue: string; oldestDays: number; level: number;
  invoices: { id: string; number: string; dueDate: string | null; balance: string; daysLate: number }[];
  lastReminder: { level: number; sentAt: string } | null; due: boolean;
};

/**
 * Clients à relancer : factures réelles échues avec un solde, niveau d'après le retard le plus ancien
 * (`settings.gestion.receivables.reminderDays`). Une relance du même niveau ne se refait pas avant le
 * délai réglé ; un niveau supérieur, si.
 */
export async function reminderCandidates(opts: { clientIds?: string[] | null; simulation?: boolean } = {}): Promise<ReminderCandidate[]> {
  const g = (await getSettings()).gestion.receivables;
  const invoices = (await openInvoices({ clientIds: opts.clientIds, simulation: opts.simulation ?? false })).filter((i) => (i.daysLate ?? 0) > 0);
  if (!invoices.length) return [];
  const ids = [...new Set(invoices.map((i) => i.clientId))];
  const [contacts, last] = await Promise.all([
    db.execute<{ id: string; phone: string | null; email: string | null }>(sql`select id, phone, email from clients where id = any(${pgArray(ids)})`),
    db.execute<{ client_id: string; level: number; sent_at: string }>(sql`
      select distinct on (client_id) client_id, level, sent_at::text from payment_reminders where client_id = any(${pgArray(ids)}) order by client_id, sent_at desc`),
  ]);
  const c = new Map(contacts.rows.map((r) => [r.id, r]));
  const l = new Map(last.rows.map((r) => [r.client_id, r]));
  const now = Date.now();
  return ids.map((id) => {
    const inv = invoices.filter((i) => i.clientId === id);
    const oldest = Math.max(...inv.map((i) => i.daysLate ?? 0));
    const level = reminderLevel(oldest, g.reminderDays);
    const prev = l.get(id);
    const since = prev ? (now - new Date(prev.sent_at).getTime()) / 86400000 : Infinity;
    return {
      clientId: id, client: inv[0].client, phone: c.get(id)?.phone ?? null, email: c.get(id)?.email ?? null,
      overdue: f(inv.reduce((s, i) => s + m(i.balance), 0n)), oldestDays: oldest, level,
      invoices: inv.map((i) => ({ id: i.id, number: i.number, dueDate: i.dueDate, balance: i.balance, daysLate: i.daysLate ?? 0 })),
      lastReminder: prev ? { level: prev.level, sentAt: prev.sent_at } : null,
      due: level > 0 && (!prev || level > prev.level || since >= g.reminderCooldownDays),
    };
  }).sort((a, b) => b.oldestDays - a.oldestDays);
}

export async function recordReminder(clientId: string, level: number, channel: "WHATSAPP" | "EMAIL" | "TELEPHONE" | "COURRIER", invoices: { id: string; number: string; dueDate: string | null; balance: string }[], actor: AuditActor, notes?: string | null): Promise<void> {
  const amount = f(invoices.reduce((s, i) => s + m(i.balance), 0n));
  await db.insert(paymentReminders).values({ clientId, level, channel, amount, invoices, notes: notes ?? null, sentById: actor.id });
  await audit({ actor, action: "REMIND", module: MODULE, entity: "client", entityId: clientId, after: { level, channel, amount, invoices: invoices.length } });
}

/** Effets et chèques en portefeuille à remettre à la banque (échéance dans N jours ou dépassée). */
export async function toDeposit(leadDays: number) {
  const limit = iso(new Date(today().getTime() + leadDays * 86400000));
  return (await db.execute<{ id: string; number: string; client: string; mode: string; amount: string; reference: string | null; due_date: string | null; date: string }>(sql`
    select p.id, p.number, c.name as client, pm.label as mode, p.amount::text, p.reference, p.due_date::text, p.date::text
    from payments p join clients c on c.id = p.client_id join payment_modes pm on pm.key = p.mode_key
    where p.status = 'PORTEFEUILLE' and coalesce(p.due_date, p.date) <= ${limit}::date order by coalesce(p.due_date, p.date)`)).rows;
}
