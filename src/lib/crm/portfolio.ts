import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { audit, type AuditActor } from "@/lib/audit";
import { pgArray } from "@/lib/sql-array";
import { clientIntel } from "@/lib/clients";
import { getRefDate } from "@/lib/ref-date";
import { agingOf } from "@/lib/client-stock-shared";
import { cityKey, normalizeCity } from "@/lib/animations-shared";
import type { ComanetSettings, CrmSettings } from "@/lib/settings";
import {
  visitProgress, paceVerdict, monthBounds, monthElapsedPct, remainingVisits, suggestTour,
  type Month, type VisitProgress, type PaceVerdict, type TourCandidate,
} from "./portfolio-shared";
import { clientObjectiveProgress, headlineObjective, type ClientObjectiveStatus } from "./objectives";
import { visitOutcomes } from "./visits";
import { canSeePositions, canSeeUser, type CrmViewer } from "./access-shared";

/**
 * CRM commercial — portefeuilles. Le portefeuille d'une commerciale = les clients actifs dont elle est le
 * commercial attitré (`clients.account_manager_id`, un seul par client). La portée des droits (villes,
 * clients assignés) reste ce qu'elle est : elle dit ce qu'on peut voir, pas qui suit le client.
 * Seule écriture d'`account_manager_id` hors de la fiche client : `assignAccountManager()`.
 */

const UUID = /^[0-9a-f-]{36}$/i;

export type PortfolioClient = {
  id: string;
  name: string;
  city: string | null;
  sector: string | null;
  type: string;
  frequency: number | null;
  managerId: string | null;
  managerName: string | null;
  /** Visites comptées ce mois (effectuées, type compté), par n'importe qui. */
  doneThisMonth: number;
  /** Autres contacts du mois (appels, messages). */
  contactsThisMonth: number;
  remaining: number;
  lastVisit: string | null;
  nextPlanned: string | null;
  plannedToday: string | null;
  objective: ClientObjectiveStatus | null;
  /** Rythme de commande (`clientIntel()`) : jours avant la commande théorique, négatif = en retard. */
  daysUntilNextOrder: number | null;
  lastOrder: string | null;
  segment: string | null;
  stockAging: "fresh" | "aging" | "stale" | "never";
  gpsStatus: "A_CONFIRMER" | "VALIDEE" | null;
};

export type CityRow = { city: string; clients: number; progress: VisitProgress };

type ClientRow = { id: string; name: string; city: string | null; sector: string | null; type: string; visit_frequency_monthly: number | null; account_manager_id: string | null; manager_name: string | null; gps_status: "A_CONFIRMER" | "VALIDEE" | null };

async function loadClients(where: ReturnType<typeof sql>): Promise<ClientRow[]> {
  const r = await db.execute<ClientRow>(sql`
    select c.id, c.name, c.city, c.sector, c.type::text as type, c.visit_frequency_monthly, c.account_manager_id, u.name as manager_name, c.gps_status
    from clients c left join users u on u.id = c.account_manager_id
    where c.active and ${where} order by c.city nulls last, c.name`);
  return r.rows;
}

/** Visites du mois par client, dernière visite et prochaine visite planifiée. */
async function visitStats(clientIds: string[], month: Month, today: string, s: CrmSettings) {
  const out = new Map<string, { counted: number; contacts: number; last: string | null; next: string | null; today: string | null }>();
  if (!clientIds.length) return out;
  const b = monthBounds(month);
  const r = await db.execute<{ client_id: string; counted: number; contacts: number; last: string | null; next: string | null; today_id: string | null }>(sql`
    select cv.client_id,
      count(*) filter (where cv.status = 'EFFECTUEE' and cv.kind = any(${pgArray(s.countedKinds, "text")}) and cv.date >= ${b.start}::date and cv.date < ${b.end}::date)::int as counted,
      count(*) filter (where cv.status = 'EFFECTUEE' and not (cv.kind = any(${pgArray(s.countedKinds, "text")})) and cv.date >= ${b.start}::date and cv.date < ${b.end}::date)::int as contacts,
      max(cv.date) filter (where cv.status = 'EFFECTUEE' and cv.kind = any(${pgArray(s.countedKinds, "text")}))::text as last,
      min(cv.date) filter (where cv.status = 'PLANIFIEE' and cv.date >= ${today}::date)::text as next,
      (array_agg(cv.id::text) filter (where cv.status = 'PLANIFIEE' and cv.date = ${today}::date))[1] as today_id
    from client_visits cv where cv.client_id = any(${pgArray(clientIds)}) group by cv.client_id`);
  for (const x of r.rows) out.set(x.client_id, { counted: x.counted, contacts: x.contacts, last: x.last, next: x.next, today: x.today_id });
  return out;
}

async function lastReadings(clientIds: string[]): Promise<Map<string, string>> {
  if (!clientIds.length) return new Map();
  const r = await db.execute<{ client_id: string; d: string }>(sql`select client_id, max(read_at)::text as d from client_stock_readings where client_id = any(${pgArray(clientIds)}) group by client_id`);
  return new Map(r.rows.map((x) => [x.client_id, x.d]));
}

/** Assemble les lignes de portefeuille (visites, objectifs, rythme de commande, relevé) pour une liste de clients. */
async function assemble(rows: ClientRow[], month: Month, today: string, settings: ComanetSettings): Promise<PortfolioClient[]> {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const { ref } = await getRefDate();
  const todayDate = new Date(`${today}T12:00:00Z`);
  const [stats, objectives, intel, readings] = await Promise.all([
    visitStats(ids, month, today, settings.crm),
    clientObjectiveProgress(ids, month, today, settings.crm),
    clientIntel({ clientIds: ids, includeArchived: false }, ref),
    lastReadings(ids),
  ]);
  const intelById = new Map(intel.map((c) => [c.id, c]));
  return rows.map((c) => {
    const st = stats.get(c.id);
    const it = intelById.get(c.id);
    return {
      id: c.id, name: c.name, city: c.city, sector: c.sector, type: c.type,
      frequency: c.visit_frequency_monthly, managerId: c.account_manager_id, managerName: c.manager_name,
      doneThisMonth: st?.counted ?? 0, contactsThisMonth: st?.contacts ?? 0,
      remaining: remainingVisits(c.visit_frequency_monthly, st?.counted ?? 0),
      lastVisit: st?.last ?? null, nextPlanned: st?.next ?? null, plannedToday: st?.today ?? null,
      objective: objectives.get(c.id) ?? null,
      daysUntilNextOrder: it?.daysUntilNext ?? null, lastOrder: it?.lastOrder ?? null, segment: it?.segment ?? null,
      stockAging: agingOf(readings.get(c.id) ?? null, todayDate, settings.clientStock),
      gpsStatus: c.gps_status,
    };
  });
}

function byCity(list: PortfolioClient[]): CityRow[] {
  const m = new Map<string, PortfolioClient[]>();
  for (const c of list) {
    const k = normalizeCity(c.city) ?? "Ville non renseignée";
    m.set(k, [...(m.get(k) ?? []), c]);
  }
  return [...m].map(([city, cs]) => ({ city, clients: cs.length, progress: visitProgress(cs.map((c) => ({ frequency: c.frequency, done: c.doneThisMonth }))) }))
    .sort((a, b) => b.progress.expected - a.progress.expected || b.clients - a.clients || a.city.localeCompare(b.city));
}

export type Portfolio = {
  month: Month;
  elapsedPct: number;
  clients: PortfolioClient[];
  progress: VisitProgress;
  pace: PaceVerdict;
  byCity: CityRow[];
};

/** Portefeuille d'une commerciale sur un mois. */
export async function portfolioOf(userId: string, month: Month, today: string, settings: ComanetSettings): Promise<Portfolio> {
  const rows = await loadClients(sql`c.account_manager_id = ${userId}::uuid`);
  const clients = await assemble(rows, month, today, settings);
  const progress = visitProgress(clients.map((c) => ({ frequency: c.frequency, done: c.doneThisMonth })));
  const elapsedPct = monthElapsedPct(month, today);
  return { month, elapsedPct, clients, progress, pace: paceVerdict(progress, elapsedPct, settings.crm.paceGapPts), byCity: byCity(clients) };
}

/** Les clients à voir en priorité aujourd'hui, avec leurs raisons (toutes mesurées). */
export function tourSuggestions(p: Portfolio, today: string, s: CrmSettings) {
  const candidates: TourCandidate[] = p.clients.map((c) => {
    const h = headlineObjective(c.objective);
    return {
      clientId: c.id, name: c.name, city: c.city, frequency: c.frequency, doneThisMonth: c.doneThisMonth, lastVisit: c.lastVisit,
      plannedToday: !!c.plannedToday, daysUntilNextOrder: c.daysUntilNextOrder,
      objectiveLate: h && h.verdict === "EN_RETARD" && h.pct !== null ? { pct: h.pct, elapsedPct: p.elapsedPct } : null,
      stockStale: c.stockAging === "stale",
    };
  });
  return suggestTour(candidates, today, s.tourSuggestions);
}

/* ------------------------------------------------------------------ */
/* Vue équipe (manager, direction)                                     */
/* ------------------------------------------------------------------ */

export type CommercialRow = {
  userId: string;
  name: string;
  clients: number;
  progress: VisitProgress;
  pace: PaceVerdict;
  /** Visites effectuées par elle ce mois (tous clients, portefeuille ou non). */
  visitsDone: number;
  /** Dont chez des clients hors de son portefeuille. */
  visitsOutside: number;
  notDone: number;
  contacts: number;
  ordersInVisits: number;
  objectivesDefined: number;
  objectivesReached: number;
  objectivesLate: number;
  /** Contrôle de présence, seulement pour qui voit les positions (direction, manager). */
  verification: { verified: number; toCheck: number; notVerified: number } | null;
};

/** Personnes suivies : commerciaux attitrés de clients actifs, et toute personne ayant enregistré une visite récente. */
export async function crmUsers(): Promise<{ id: string; name: string; city: string | null }[]> {
  const r = await db.execute<{ id: string; name: string; city: string | null }>(sql`
    select u.id, u.name, u.city from users u
    where u.active and (
      exists (select 1 from clients c where c.account_manager_id = u.id and c.active)
      or exists (select 1 from client_visits cv where cv.user_id = u.id and cv.date >= current_date - 120)
    ) order by u.name`);
  return r.rows;
}

/** Comptes à qui on peut confier un portefeuille : actifs, avec Créer sur Clients ou sur Commandes. */
export async function assignableUsers(): Promise<{ id: string; name: string; city: string | null }[]> {
  const r = await db.execute<{ id: string; name: string; city: string | null }>(sql`
    select u.id, u.name, u.city from users u
    where u.active and exists (select 1 from user_permissions p where p.user_id = u.id and p.module in ('clients', 'commandes') and p.can_create)
    order by u.name`);
  return r.rows;
}

export type TeamOverview = {
  month: Month;
  elapsedPct: number;
  rows: CommercialRow[];
  byCity: CityRow[];
  totals: VisitProgress;
  /** Clients actifs sans commercial attitré (direction et « Valider » seulement). */
  unassigned: number | null;
};

export async function teamOverview(viewer: CrmViewer, month: Month, today: string, settings: ComanetSettings, opts: { city?: string | null } = {}): Promise<TeamOverview> {
  const s = settings.crm;
  const b = monthBounds(month);
  const users = (await crmUsers()).filter((u) => canSeeUser(viewer, u.id));
  const ids = users.map((u) => u.id);
  const elapsedPct = monthElapsedPct(month, today);
  if (!ids.length) return { month, elapsedPct, rows: [], byCity: [], totals: visitProgress([]), unassigned: viewer.all ? await unassignedCount() : null };

  const rows = await loadClients(sql`c.account_manager_id = any(${pgArray(ids)})`);
  const filtered = opts.city ? rows.filter((c) => cityKey(c.city) === cityKey(opts.city)) : rows;
  const clients = await assemble(filtered, month, today, settings);

  const visits = await db.execute<{ id: string; user_id: string; client_id: string; status: string; kind: string; verification_status: string; in_portfolio: boolean; client_city: string | null }>(sql`
    select cv.id, cv.user_id, cv.client_id, cv.status, cv.kind, cv.verification_status, (c.account_manager_id is not distinct from cv.user_id) as in_portfolio, c.city as client_city
    from client_visits cv join clients c on c.id = cv.client_id
    where cv.user_id = any(${pgArray(ids)}) and cv.date >= ${b.start}::date and cv.date < ${b.end}::date and cv.status in ('EFFECTUEE', 'NON_EFFECTUEE')`);
  // Filtre par ville : les visites chez les clients de cette ville seulement.
  const visitRows = opts.city ? visits.rows.filter((v) => cityKey(v.client_city) === cityKey(opts.city)) : visits.rows;
  const outcomes = await visitOutcomes(visitRows.filter((v) => v.status === "EFFECTUEE").map((v) => v.id), s);

  const out: CommercialRow[] = users.map((u) => {
    const mine = clients.filter((c) => c.managerId === u.id);
    const progress = visitProgress(mine.map((c) => ({ frequency: c.frequency, done: c.doneThisMonth })));
    const vs = visitRows.filter((v) => v.user_id === u.id);
    const done = vs.filter((v) => v.status === "EFFECTUEE" && (s.countedKinds as string[]).includes(v.kind));
    const objs = mine.map((c) => headlineObjective(c.objective)).filter((x) => !!x);
    const seesGps = canSeePositions(viewer, u.id);
    return {
      userId: u.id, name: u.name, clients: mine.length, progress, pace: paceVerdict(progress, elapsedPct, s.paceGapPts),
      visitsDone: done.length, visitsOutside: done.filter((v) => !v.in_portfolio).length,
      notDone: vs.filter((v) => v.status === "NON_EFFECTUEE").length,
      contacts: vs.filter((v) => v.status === "EFFECTUEE" && !(s.countedKinds as string[]).includes(v.kind)).length,
      ordersInVisits: done.reduce((a, v) => a + (outcomes.get(v.id)?.orders.length ?? 0), 0),
      objectivesDefined: objs.length,
      objectivesReached: objs.filter((o) => o!.verdict === "ATTEINT").length,
      objectivesLate: objs.filter((o) => o!.verdict === "EN_RETARD").length,
      verification: seesGps ? {
        verified: done.filter((v) => v.verification_status === "VERIFIEE").length,
        toCheck: done.filter((v) => v.verification_status === "A_VERIFIER").length,
        notVerified: done.filter((v) => v.verification_status === "NON_VERIFIEE").length,
      } : null,
    };
  }).filter((r) => r.clients > 0 || r.visitsDone > 0 || r.notDone > 0 || r.contacts > 0)
    .sort((a, b2) => (a.progress.pct ?? -1) - (b2.progress.pct ?? -1) || a.name.localeCompare(b2.name));

  return {
    month, elapsedPct, rows: out, byCity: byCity(clients),
    totals: visitProgress(clients.map((c) => ({ frequency: c.frequency, done: c.doneThisMonth }))),
    unassigned: viewer.all ? await unassignedCount() : null,
  };
}

async function unassignedCount(): Promise<number> {
  const r = await db.execute<{ n: number }>(sql`select count(*)::int as n from clients where active and account_manager_id is null`);
  return r.rows[0]?.n ?? 0;
}

/** Détail d'une commerciale pour le suivi : son portefeuille (mêmes lignes que Ma tournée). */
export async function commercialDetail(viewer: CrmViewer, userId: string, month: Month, today: string, settings: ComanetSettings): Promise<(Portfolio & { name: string }) | null> {
  if (!canSeeUser(viewer, userId)) return null;
  const u = await db.execute<{ name: string }>(sql`select name from users where id = ${userId}::uuid`);
  if (!u.rows[0]) return null;
  return { ...(await portfolioOf(userId, month, today, settings)), name: u.rows[0].name };
}

/* ------------------------------------------------------------------ */
/* Écritures : affectation, fréquence                                  */
/* ------------------------------------------------------------------ */

const validIds = (ids: string[]) => [...new Set(ids.filter((x) => UUID.test(x)))].slice(0, 2000);

/** Confie des clients à une commerciale (ou les retire : `userId` null). Une trace par client modifié. */
export async function assignAccountManager(actor: AuditActor, clientIds: string[], userId: string | null): Promise<number> {
  const ids = validIds(clientIds);
  if (!ids.length) return 0;
  if (userId !== null && !UUID.test(userId)) throw new Error("Commerciale inconnue.");
  return db.transaction(async (tx) => {
    if (userId) {
      const u = await tx.execute(sql`select 1 from users where id = ${userId}::uuid and active`);
      if (!u.rows.length) throw new Error("Ce compte est suspendu ou n'existe pas.");
    }
    const before = await tx.execute<{ id: string; name: string; account_manager_id: string | null }>(sql`
      select id, name, account_manager_id from clients where id = any(${pgArray(ids)}) for update`);
    const changed = before.rows.filter((c) => c.account_manager_id !== userId);
    if (!changed.length) return 0;
    await tx.execute(sql`update clients set account_manager_id = ${userId}::uuid, updated_at = now() where id = any(${pgArray(changed.map((c) => c.id))})`);
    for (const c of changed) {
      await audit({ actor, action: "UPDATE", module: "clients", entity: "client", entityId: c.id, label: `${c.name} — commercial attitré`, before: { accountManagerId: c.account_manager_id }, after: { accountManagerId: userId } }, tx);
    }
    return changed.length;
  });
}

/** Fixe la fréquence de visite mensuelle (null = non définie). */
export async function setVisitFrequency(actor: AuditActor, clientIds: string[], frequency: number | null): Promise<number> {
  const ids = validIds(clientIds);
  if (!ids.length) return 0;
  if (frequency !== null && (!Number.isInteger(frequency) || frequency < 0 || frequency > 31)) throw new Error("Fréquence invalide : un nombre entier de visites par mois, de 0 à 31.");
  return db.transaction(async (tx) => {
    const before = await tx.execute<{ id: string; name: string; f: number | null }>(sql`
      select id, name, visit_frequency_monthly as f from clients where id = any(${pgArray(ids)}) for update`);
    const changed = before.rows.filter((c) => c.f !== frequency);
    if (!changed.length) return 0;
    await tx.execute(sql`update clients set visit_frequency_monthly = ${frequency}, updated_at = now() where id = any(${pgArray(changed.map((c) => c.id))})`);
    for (const c of changed) {
      await audit({ actor, action: "UPDATE", module: "clients", entity: "client", entityId: c.id, label: `${c.name} — fréquence de visite`, before: { visitFrequencyMonthly: c.f }, after: { visitFrequencyMonthly: frequency } }, tx);
    }
    return changed.length;
  });
}

/**
 * Applique la fréquence par défaut de leur type (`settings.crm.defaultFrequencyByType`) aux clients
 * sélectionnés qui n'en ont pas encore : jamais d'écrasement d'une fréquence saisie.
 */
export async function applyDefaultFrequency(actor: AuditActor, clientIds: string[], s: CrmSettings): Promise<number> {
  const ids = validIds(clientIds);
  if (!ids.length) return 0;
  const r = await db.execute<{ id: string; type: keyof CrmSettings["defaultFrequencyByType"] }>(sql`
    select id, type::text as type from clients where id = any(${pgArray(ids)}) and visit_frequency_monthly is null`);
  let n = 0;
  for (const type of Object.keys(s.defaultFrequencyByType) as (keyof CrmSettings["defaultFrequencyByType"])[]) {
    const group = r.rows.filter((c) => c.type === type).map((c) => c.id);
    if (group.length) n += await setVisitFrequency(actor, group, s.defaultFrequencyByType[type]);
  }
  return n;
}

export type ManagerProposal = { clientId: string; clientName: string; city: string | null; candidates: { id: string; name: string; via: "client" | "ville" }[] };

/**
 * Reprise : propose un commercial attitré aux clients qui n'en ont pas, d'après les affectations des droits
 * (clients assignés, puis villes assignées) des comptes qui prennent des commandes ou travaillent les clients,
 * en portée « les siens » ou « assignés ». Une proposition unique s'applique d'un clic ; plusieurs candidats
 * restent à trancher à la main. Rien n'est appliqué sans action.
 */
export async function managerProposals(): Promise<ManagerProposal[]> {
  const [clientsRes, users, byClient, byCity] = await Promise.all([
    db.execute<{ id: string; name: string; city: string | null }>(sql`select id, name, city from clients where active and account_manager_id is null order by city nulls last, name`),
    db.execute<{ id: string; name: string }>(sql`
      select u.id, u.name from users u join user_scope us on us.user_id = u.id and us.scope in ('OWN', 'ASSIGNED')
      where u.active and exists (select 1 from user_permissions p where p.user_id = u.id and p.module in ('clients', 'commandes') and p.can_create)`),
    db.execute<{ user_id: string; client_id: string }>(sql`select user_id, client_id from user_client_assignments`),
    db.execute<{ user_id: string; city: string }>(sql`select user_id, city from user_city_assignments`).catch(() => ({ rows: [] as { user_id: string; city: string }[] })),
  ]);
  const names = new Map(users.rows.map((u) => [u.id, u.name]));
  const out: ManagerProposal[] = [];
  for (const c of clientsRes.rows) {
    const direct = byClient.rows.filter((a) => a.client_id === c.id && names.has(a.user_id)).map((a) => a.user_id);
    const viaCity = c.city ? byCity.rows.filter((a) => names.has(a.user_id) && cityKey(a.city) === cityKey(c.city)).map((a) => a.user_id) : [];
    // Une affectation nominative l'emporte sur une affectation par ville.
    const pick = direct.length ? [...new Set(direct)].map((id) => ({ id, via: "client" as const })) : [...new Set(viaCity)].map((id) => ({ id, via: "ville" as const }));
    if (!pick.length) continue;
    out.push({ clientId: c.id, clientName: c.name, city: c.city, candidates: pick.map((p) => ({ id: p.id, name: names.get(p.id)!, via: p.via })) });
  }
  return out;
}

/** Applique les propositions à candidat unique pour les clients sélectionnés. */
export async function applyManagerProposals(actor: AuditActor, clientIds: string[]): Promise<number> {
  const wanted = new Set(validIds(clientIds));
  const props = (await managerProposals()).filter((p) => wanted.has(p.clientId) && p.candidates.length === 1);
  const byUser = new Map<string, string[]>();
  for (const p of props) byUser.set(p.candidates[0].id, [...(byUser.get(p.candidates[0].id) ?? []), p.clientId]);
  let n = 0;
  for (const [userId, ids] of byUser) n += await assignAccountManager(actor, ids, userId);
  return n;
}

/** Liste des clients pour l'écran d'affectation (filtres simples, portée de la personne appliquée par l'appelant). */
export async function portfolioAdminList(f: { q?: string | null; city?: string | null; managerId?: string | "none" | null; type?: string | null; frequency?: "none" | "set" | null; scopeClientIds: string[] | null }) {
  const parts = [sql`c.active`];
  if (f.scopeClientIds) parts.push(sql`c.id = any(${pgArray(f.scopeClientIds)})`);
  if (f.managerId === "none") parts.push(sql`c.account_manager_id is null`);
  else if (f.managerId && UUID.test(f.managerId)) parts.push(sql`c.account_manager_id = ${f.managerId}::uuid`);
  if (f.type && ["PHARMACIE", "PARAPHARMACIE", "GROSSISTE", "AUTRE"].includes(f.type)) parts.push(sql`c.type = ${f.type}`);
  if (f.frequency === "none") parts.push(sql`c.visit_frequency_monthly is null`);
  if (f.frequency === "set") parts.push(sql`c.visit_frequency_monthly is not null`);
  if (f.q) parts.push(sql`(c.name ilike ${"%" + f.q + "%"} or c.legal_name ilike ${"%" + f.q + "%"})`);
  const r = await db.execute<{ id: string; name: string; city: string | null; type: string; f: number | null; manager_id: string | null; manager: string | null; revenue12: number }>(sql`
    select c.id, c.name, c.city, c.type::text as type, c.visit_frequency_monthly as f, c.account_manager_id as manager_id, u.name as manager,
      coalesce((select sum(s.amount) from sales s where s.client_id = c.id and s.date >= current_date - 365), 0)::float8 as revenue12
    from clients c left join users u on u.id = c.account_manager_id
    where ${sql.join(parts, sql` and `)}
    order by c.city nulls last, c.name limit 1500`);
  const rows = f.city ? r.rows.filter((c) => cityKey(c.city) === cityKey(f.city)) : r.rows;
  return rows.map((c) => ({ id: c.id, name: c.name, city: c.city, type: c.type, frequency: c.f, managerId: c.manager_id, manager: c.manager, revenue12: Number(c.revenue12) }));
}

/* ------------------------------------------------------------------ */
/* Visites d'un mois (suivi, export, carte)                            */
/* ------------------------------------------------------------------ */

export type MonthVisit = {
  id: string; date: string; clientId: string; clientName: string; city: string | null; userId: string | null; userName: string | null;
  status: string; kind: string; startedAt: string | null; endedAt: string | null; durationMinutes: number | null; timingSource: string;
  result: string | null; reportStatus: string | null; notDoneReason: string | null; autoClosed: boolean;
  verificationStatus: string; verificationReasons: string[]; inPortfolio: boolean;
  place: { lat: number; lng: number; validated: boolean } | null;
  events: { type: string; lat: number | null; lng: number | null; accuracyM: number | null; at: string }[];
};

/** Visites d'un mois pour des commerciales (planifiées comprises). Positions jointes seulement si `withPositions`. */
export async function visitsOfMonth(userIds: string[], month: Month, opts: { withPositions: boolean }): Promise<MonthVisit[]> {
  if (!userIds.length) return [];
  const b = monthBounds(month);
  const r = await db.execute<{
    id: string; date: string; client_id: string; client_name: string; city: string | null; user_id: string | null; user_name: string | null; status: string; kind: string;
    started_at: string | null; ended_at: string | null; duration_minutes: number | null; timing_source: string; result: string | null; report_status: string | null;
    not_done_reason: string | null; auto_closed: boolean; verification_status: string; verification_reasons: string[]; in_portfolio: boolean;
    gps_lat: string | null; gps_lng: string | null; gps_status: string | null;
  }>(sql`
    select cv.id, cv.date::text as date, cv.client_id, c.name as client_name, c.city, cv.user_id, u.name as user_name, cv.status, cv.kind,
      cv.started_at, cv.ended_at, cv.duration_minutes, cv.timing_source, cv.result, cv.report_status, cv.not_done_reason, cv.auto_closed,
      cv.verification_status, cv.verification_reasons, (c.account_manager_id is not distinct from cv.user_id) as in_portfolio, c.gps_lat, c.gps_lng, c.gps_status
    from client_visits cv join clients c on c.id = cv.client_id left join users u on u.id = cv.user_id
    where cv.user_id = any(${pgArray(userIds)}) and cv.date >= ${b.start}::date and cv.date < ${b.end}::date and cv.status <> 'ANNULEE'
    order by cv.date desc, cv.started_at desc nulls last`);
  const events = opts.withPositions && r.rows.length
    ? (await db.execute<{ client_visit_id: string; type: string; lat: string | null; lng: string | null; accuracy_m: number | null; server_time: string }>(sql`
        select client_visit_id, type, lat, lng, accuracy_m, server_time from visit_events
        where client_visit_id = any(${pgArray(r.rows.map((x) => x.id))}) order by server_time, id`)).rows
    : [];
  return r.rows.map((x) => ({
    id: x.id, date: x.date, clientId: x.client_id, clientName: x.client_name, city: x.city, userId: x.user_id, userName: x.user_name,
    status: x.status, kind: x.kind, startedAt: x.started_at ? new Date(x.started_at).toISOString() : null, endedAt: x.ended_at ? new Date(x.ended_at).toISOString() : null,
    durationMinutes: x.duration_minutes, timingSource: x.timing_source, result: x.result, reportStatus: x.report_status, notDoneReason: x.not_done_reason,
    autoClosed: x.auto_closed, verificationStatus: opts.withPositions ? x.verification_status : "HORS_CONTROLE", verificationReasons: opts.withPositions ? x.verification_reasons : [],
    inPortfolio: x.in_portfolio,
    place: opts.withPositions && x.gps_lat !== null && x.gps_lng !== null ? { lat: Number(x.gps_lat), lng: Number(x.gps_lng), validated: x.gps_status === "VALIDEE" } : null,
    events: events.filter((e) => e.client_visit_id === x.id).map((e) => ({ type: e.type, lat: e.lat === null ? null : Number(e.lat), lng: e.lng === null ? null : Number(e.lng), accuracyM: e.accuracy_m, at: new Date(e.server_time).toISOString() })),
  }));
}

/** Points de vente dont la position attend une validation, visités par ces commerciales. */
export async function placesToValidate(userIds: string[]): Promise<{ id: string; name: string; lat: number; lng: number }[]> {
  if (!userIds.length) return [];
  const r = await db.execute<{ id: string; name: string; gps_lat: string; gps_lng: string }>(sql`
    select c.id, c.name, c.gps_lat, c.gps_lng from clients c
    where c.gps_status = 'A_CONFIRMER' and c.gps_lat is not null
      and exists (select 1 from client_visits cv where cv.client_id = c.id and cv.user_id = any(${pgArray(userIds)}))
    order by c.name`);
  return r.rows.map((x) => ({ id: x.id, name: x.name, lat: Number(x.gps_lat), lng: Number(x.gps_lng) }));
}

/** Ligne de portefeuille d'un seul client (fiche client) ; null pour un client archivé. */
export async function clientCrmSummary(clientId: string, month: Month, today: string, settings: ComanetSettings): Promise<PortfolioClient | null> {
  if (!UUID.test(clientId)) return null;
  const rows = await loadClients(sql`c.id = ${clientId}::uuid`);
  return (await assemble(rows, month, today, settings))[0] ?? null;
}
