/**
 * Liaison des outils aux fonctions métier réelles (serveur uniquement).
 *
 * Chaque entrée renvoie vers la définition officielle ; ce fichier ne contient que des requêtes de
 * résolution de noms, une lecture d'appoint (dossiers réglementaires), le câblage partagé avec la couche
 * Marketing Intelligence (`realIntelDeps`) et les trois écritures autorisées (tâche proposée, brouillon
 * de rapport, journal des appels).
 */
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { aiReports, aiToolCalls, tasks } from "@/db/schema";
import { clientIntel } from "@/lib/clients";
import { animationObjectives, animationTotals, animationsByDim, objectiveForRange } from "@/lib/animations";
import { budgetByCategory } from "@/lib/budget";
import { ADS_AGENT_API } from "@/lib/ads-intel/agent";
import { realIntelDeps } from "@/lib/marketing-intel/server";
import { getPlan, listPlans } from "@/lib/marketing-plan/plan";
import { listActions } from "@/lib/marketing-plan/actions";
import { buildUnifiedDecisions } from "@/lib/decisions/build";
import { getRecommendations } from "@/lib/rules";
import { listTasks } from "@/lib/tasks";
import { searchEntities } from "@/lib/search";
import { normKey } from "@/lib/import/normalize";
import type { CrmToolDeps, MedicalToolDeps, Ref, RegulatoryRow, ToolDeps } from "./types";
import { getSettings } from "@/lib/settings";
import { iso, today } from "@/lib/format";
import { crmViewerFor } from "@/lib/crm/access";
import { portfolioOf, teamOverview, tourSuggestions } from "@/lib/crm/portfolio";
import { clientTimeline } from "@/lib/crm/timeline";
import { clientVisitBrief } from "@/lib/crm/intelligence";
import { doctorNameScore, doctorNameTokens } from "@/lib/medical/matching";
import { doctorBrief } from "@/lib/medical/prescriptions";
import { fieldScopeOfUser } from "@/lib/medical/field-access";
import { fieldDelegates, fieldKpis, fieldVisits } from "@/lib/medical/field-report";

type Row = Record<string, unknown>;
const first = (rows: Row[]): Ref | null => (rows[0] ? { id: String(rows[0].id), name: String(rows[0].name) } : null);

/** Nom exact d'abord, puis contenance ; une marque fusionnée renvoie sa marque cible. */
async function findBrand(query: string): Promise<Ref | null> {
  const key = normKey(query);
  if (!key) return null;
  const r = await db.execute(sql`
    select coalesce(t.id, b.id) as id, coalesce(t.name, b.name) as name
    from brands b left join brands t on t.id = b.merged_into_id
    where upper(b.name) = ${key} or exists (select 1 from jsonb_array_elements_text(b.aliases) a where upper(a) = ${key})
    order by b.active desc limit 1`);
  if (r.rows[0]) return first(r.rows as Row[]);
  const like = `%${key}%`;
  const r2 = await db.execute(sql`
    select coalesce(t.id, b.id) as id, coalesce(t.name, b.name) as name
    from brands b left join brands t on t.id = b.merged_into_id
    where b.active and (upper(b.name) like ${like} or exists (select 1 from jsonb_array_elements_text(b.aliases) a where upper(a) like ${like}))
    order by length(b.name) limit 1`);
  return first(r2.rows as Row[]);
}

async function findClient(query: string): Promise<Ref | null> {
  const key = normKey(query);
  if (!key) return null;
  const like = `%${key}%`;
  const r = await db.execute(sql`
    select c.id, c.name from clients c
    where c.name_key = ${key} or upper(coalesce(c.code,'')) = ${key} or c.name_key like ${like}
       or exists (select 1 from client_aliases a where a.client_id = c.id and a.alias like ${like})
    order by (c.name_key = ${key}) desc, (select coalesce(sum(amount),0) from sales s where s.client_id = c.id and s.date >= current_date - 365) desc limit 1`);
  return first(r.rows as Row[]);
}

async function findProduct(query: string): Promise<Ref | null> {
  const key = normKey(query);
  if (!key) return null;
  const like = `%${key}%`;
  const r = await db.execute(sql`
    select p.id, p.name from products p
    where p.name_key = ${key} or p.sku = ${key} or p.name_key like ${like} or p.sku like ${like}
       or exists (select 1 from product_aliases a where a.product_id = p.id and a.alias like ${like})
    order by (p.name_key = ${key} or p.sku = ${key}) desc, (select coalesce(sum(amount),0) from sales s where s.product_id = p.id and s.date >= current_date - 365) desc limit 1`);
  return first(r.rows as Row[]);
}

async function findUser(query: string): Promise<Ref | null> {
  const key = normKey(query);
  if (!key) return null;
  const like = `%${key}%`;
  const r = await db.execute(sql`select id, name from users where active and (upper(name) = ${key} or upper(name) like ${like}) order by (upper(name) = ${key}) desc, length(name) limit 1`);
  return first(r.rows as Row[]);
}

async function clientIdsInCity(city: string): Promise<string[]> {
  const key = normKey(city);
  if (!key) return [];
  const r = await db.execute(sql`select id from clients where upper(coalesce(city,'')) like ${`%${key}%`}`);
  return (r.rows as Row[]).map((x) => String(x.id));
}

async function regulatoryFiles(): Promise<RegulatoryRow[]> {
  const r = await db.execute(sql`
    select rf.id, rf.dossier, rf.reference, rf.variant_type, rf.size, rf.status::text as status, rf.blocked, rf.expiry_date::text as expiry_date,
      rf.certificate_status, p.name as product_name, b.name as brand_name, b.id as brand_id, u.name as responsible
    from regulatory_files rf
    left join products p on p.id = rf.product_id
    left join brands b on b.id = rf.brand_id
    left join users u on u.id = rf.responsible_id
    order by rf.expiry_date asc nulls last`);
  return (r.rows as Row[]).map((x) => ({
    id: String(x.id), dossier: x.dossier ? String(x.dossier) : null, reference: x.reference ? String(x.reference) : null, variant_type: x.variant_type ? String(x.variant_type) : null,
    size: x.size ? String(x.size) : null, status: String(x.status), blocked: !!x.blocked, expiry_date: x.expiry_date ? String(x.expiry_date) : null,
    certificate_status: x.certificate_status ? String(x.certificate_status) : null, product_name: x.product_name ? String(x.product_name) : null,
    brand_name: x.brand_name ? String(x.brand_name) : null, brand_id: x.brand_id ? String(x.brand_id) : null, responsible: x.responsible ? String(x.responsible) : null,
  }));
}

/** Médecin le plus proche du nom saisi (même rapprochement que les ordonnances), dans la portée de la personne. */
async function findDoctor(query: string, userId: string, ownOnly: boolean): Promise<Ref | null> {
  const toks = doctorNameTokens(query);
  if (!toks.length) return null;
  const r = await db.execute<{ id: string; first_name: string; last_name: string; city: string | null }>(sql`
    select d.id, d.first_name, d.last_name, d.city from doctors d
    where true ${ownOnly ? sql`and (d.delegate_id = ${userId}::uuid or d.sector_id in (select ds.sector_id from medical_delegate_sectors ds join medical_delegates md on md.id = ds.delegate_id where md.user_id = ${userId}::uuid))` : sql``}`);
  let best: { id: string; name: string; score: number } | null = null;
  for (const d of r.rows) {
    const score = doctorNameScore(toks, doctorNameTokens(`${d.first_name} ${d.last_name}`));
    if (score >= 0.75 && (!best || score > best.score)) best = { id: d.id, name: `Dr ${d.first_name} ${d.last_name}${d.city ? ` — ${d.city}` : ""}`, score };
  }
  return best ? { id: best.id, name: best.name } : null;
}

const medicalDeps: MedicalToolDeps = {
  findDoctor,
  doctorBrief: (id) => doctorBrief(id),
  async fieldSummary(userId, admin, delegateQuery, from, to) {
    const scope = await fieldScopeOfUser(userId, admin);
    if (!scope.all && !scope.delegateIds.length) return null;
    const delegates = await fieldDelegates(scope);
    const delegate = delegateQuery ? delegates.find((d) => normKey(d.name).includes(normKey(delegateQuery))) ?? null : null;
    if (delegateQuery && !delegate) return null;
    const filters = { delegateId: delegate?.id ?? null, from, to };
    const visits = await fieldVisits(scope, filters);
    const kpis = await fieldKpis(scope, visits, filters);
    const byStatus: Record<string, number> = {};
    const reasons = new Map<string, number>();
    for (const v of visits) {
      byStatus[v.verificationStatus] = (byStatus[v.verificationStatus] ?? 0) + 1;
      // Motif sans chiffres (« Démarrage à … du cabinet ») pour regrouper ; jamais de coordonnées.
      for (const m of v.reasons) {
        const k = m.replace(/\d+([,.]\d+)?/g, "…").replace(/par .* :/, "par … :");
        reasons.set(k, (reasons.get(k) ?? 0) + 1);
      }
    }
    return { delegate: delegate?.name ?? null, kpis, byStatus, topReasons: [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([reason, count]) => ({ reason, count })) };
  },
};

/** CRM commercial : mêmes fonctions que les écrans (`src/lib/crm/`), sans aucune position GPS. */
const crmDeps: CrmToolDeps = {
  viewer: (userId, userName, perms) => crmViewerFor(userId, userName, perms),
  async findCommercial(query) {
    const r = await db.execute<{ id: string; name: string }>(sql`
      select u.id, u.name from users u where u.active and (
        exists (select 1 from clients c where c.account_manager_id = u.id) or exists (select 1 from client_visits cv where cv.user_id = u.id))`);
    const k = normKey(query);
    const hit = r.rows.find((u) => normKey(u.name) === k) ?? r.rows.find((u) => normKey(u.name).includes(k));
    return hit ? { id: hit.id, name: hit.name } : null;
  },
  async portfolio(userId, month) {
    return portfolioOf(userId, month, iso(today()), await getSettings());
  },
  async suggestions(p) {
    const s = (await getSettings()).crm;
    return tourSuggestions(p, iso(today()), { ...s, tourSuggestions: Math.max(5, s.tourSuggestions) }).map((x) => ({ clientId: x.clientId, name: x.name, city: x.city, reasons: x.reasons }));
  },
  async team(viewer, month, city) {
    return teamOverview(viewer, month, iso(today()), await getSettings(), { city });
  },
  timeline: (clientId, limit) => clientTimeline(clientId, { limit }),
  async brief(clientId) {
    return clientVisitBrief(clientId, await getSettings());
  },
};

export const realDeps: ToolDeps = {
  medical: medicalDeps,
  // Marketing OS : plan, actions et décisions unifiées (lecture seule ; `src/lib/marketing-plan/`, `src/lib/decisions/`).
  marketingPlan: { listPlans: (ids) => listPlans(ids), getPlan: (id) => getPlan(id), listActions: (f) => listActions(f), decisions: (scope) => buildUnifiedDecisions(scope) },
  crm: crmDeps,
  // Ventes, objectifs, stock, catalogue, budget consommé, publicité, activité marketing : câblage de la couche Marketing Intelligence.
  ...realIntelDeps,
  findBrand, findClient, findProduct, findUser, clientIdsInCity,
  clientIntel: (opts, ref) => clientIntel(opts, ref),
  animationTotals, animationsByDim, animationObjectives, objectiveForRange,
  budgetByCategory: (year, brandId, brandIds) => budgetByCategory(year, brandId, brandIds),
  adsIntel: ADS_AGENT_API,
  regulatoryFiles,
  recommendations: () => getRecommendations(),
  listTasks: (opts) => listTasks(opts),
  search: (q) => searchEntities(q),
  async insertProposedTask(input) {
    const [row] = await db.insert(tasks).values({
      title: input.title, description: input.description, status: "PROPOSED", priority: input.priority, dueDate: input.dueDate, brandId: input.brandId,
      assigneeId: input.assigneeId, source: "AI", entityType: input.entityType, entityId: input.entityId, expectedImpact: input.expectedImpact, createdById: input.createdById,
    }).returning({ id: tasks.id });
    return { id: row.id };
  },
  async insertReportDraft(input) {
    const [row] = await db.insert(aiReports).values({
      type: input.type, brandId: input.brandId, periodStart: input.periodStart, periodEnd: input.periodEnd, title: input.title, contentMd: input.contentMd,
      sources: input.sources, status: "DRAFT", createdById: input.createdById, model: input.model,
    }).returning({ id: aiReports.id });
    return { id: row.id };
  },
  async logToolCall(e) {
    await db.insert(aiToolCalls).values({ messageId: e.messageId ?? null, userId: e.userId, tool: e.tool, params: e.params ?? {}, durationMs: e.durationMs, rowCount: e.rowCount, error: e.error });
  },
};
