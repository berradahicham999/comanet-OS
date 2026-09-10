/**
 * Couche outils du copilote — testée avec des doublures, sans base ni appel API.
 * Vérifie : filtrage par permissions, portée marques / clients / OWN, limite de lignes,
 * donnée absente → `available: false`, journalisation, schémas JSON valides.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { noPermissions, type PermissionSet } from "@/lib/permissions-shared";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { MAX_ROWS } from "@/lib/ai/tools/shared";
import { TOOLS, TOOL_NAMES, executeTool, isToolAllowed, toolDefinitions, toolsFor, type ToolAccess, type ToolCallLog, type ToolContext, type ToolDeps } from "@/lib/ai/tools";
import type { ClientIntel } from "@/lib/clients";
import type { ProductStock } from "@/lib/stock";
import type { RecommendationWithState } from "@/lib/rules/types";

/* ------------------------------ Doublures ------------------------------ */

const BRANDS = [{ id: "b-gamarde", name: "Gamarde" }, { id: "b-alpha", name: "Alphascience" }];

function client(over: Partial<ClientIntel>): ClientIntel {
  return {
    id: "c1", code: "C001", name: "Pharmacie Atlas", type: "PHARMACIE", city: "Marrakech", channel: null, salesRep: null, needsReview: false,
    revenue12: 120_000, revenue3: 30_000, revenuePrev3: 25_000, growthPct: 20, orders12: 12, avgBasket: 10_000, avgQtyPerOrder: 30,
    lastOrder: "2026-08-20", prevOrder: "2026-07-20", firstOrder: "2024-01-05", daysSinceLast: 20, avgIntervalDays: 30, nextTheoretical: "2026-09-19", daysUntilNext: 10,
    overdue: false, brands: ["Gamarde"], productCount: 8, segment: "CROISSANCE", highPotential: true, fieldStock: null, fieldSellOut60: 0, lastAnimation: null,
    recommendation: { title: "Développer", detail: "", kind: "DEVELOPPEMENT" }, ...over,
  };
}

function stock(over: Partial<ProductStock>): ProductStock {
  return {
    productId: "p1", sku: "SKU1", name: "Crème A", brandId: "b-gamarde", brandName: "Gamarde", brandColor: null, category: null, stock: 100, stockKnown: true, onOrder: 0,
    stockDate: "2026-09-01", avgMonthly: 50, trendPct: null, coverageMonths: 2, level: "yellow", stockoutDate: "2026-11-01", leadTimeDays: 30, safetyStockDays: 15, moq: null,
    recommendedOrder: 0, targetStock: 150, costPrice: 40, priceWholesale: 80, marginPct: 50, stockValue: 4000, fieldSellOut30d: 0, fieldStockAvg: null, ...over,
  };
}

function rec(over: Partial<RecommendationWithState>): RecommendationWithState {
  return {
    key: "stock:p1", rule: "stock-coverage", category: "STOCK", priority: "HIGH", title: "Gamarde — Crème A", facts: [], why: "Couverture 0,8 mois", action: "Commander 200 unités",
    task: { title: "Commander", dueInDays: 3, role: "ADMIN" }, brandId: "b-gamarde", score: 5000, existingTask: null, ...over,
  };
}

type Calls = { logs: ToolCallLog[]; tasks: unknown[]; reports: unknown[] };

function makeDeps(calls: Calls, over: Partial<ToolDeps> = {}): ToolDeps {
  const clients = [client({}), client({ id: "c2", name: "Para Sud", city: "Agadir", segment: "A_RISQUE", daysSinceLast: 95, overdue: true, highPotential: false, revenue12: 40_000 }), client({ id: "c3", name: "Grossiste Nord", city: "Tanger", segment: "INACTIF", daysSinceLast: 200, lastOrder: "2026-02-01", highPotential: false, revenue12: 5_000 })];
  return {
    findBrand: async (q) => BRANDS.find((b) => b.name.toLowerCase().includes(q.toLowerCase())) ?? null,
    findClient: async (q) => { const c = clients.find((c) => c.name.toLowerCase().includes(q.toLowerCase())); return c ? { id: c.id, name: c.name } : null; },
    findProduct: async (q) => (q.toLowerCase().includes("crème") ? { id: "p1", name: "Crème A" } : null),
    findUser: async (q) => (q.toLowerCase().includes("salma") ? { id: "u-salma", name: "Salma" } : null),
    clientIdsInCity: async (city) => clients.filter((c) => c.city?.toLowerCase() === city.toLowerCase()).map((c) => c.id),
    salesTotals: async (start, end, f) => (f.brandId === "b-alpha" ? { amount: 0, quantity: 0, orders: 0, clients: 0, lines: 0 } : { amount: start < "2026-08-01" ? 80_000 : 100_000, quantity: 500, orders: 40, clients: 25, lines: 300 }),
    salesByDim: async (dim, _s, _e, _f, limit) => Array.from({ length: 200 }, (_, i) => ({ id: dim === "brand" ? (i === 0 ? "b-gamarde" : "b-alpha") : `x${i}`, name: `${dim} ${i}`, extra: null, amount: 1000 - i, quantity: 10, orders: 1, clients: 1 })).slice(0, limit),
    salesObjective: async () => 120_000,
    clientIntel: async (opts) => clients.filter((c) => !opts.clientIds || opts.clientIds.includes(c.id)),
    animationTotals: async (_r, filter) => (filter?.city === "Nulle-Part" ? { revenue: 0, units: 0, days: 0, animations: 0, pos: 0, customers: 0, cost: 0 } : { revenue: 34_000, units: 210, days: 20, animations: 20, pos: 6, customers: 400, cost: 6_360 }),
    animationsByDim: async (dim) => (dim === "brand" ? [{ id: "b-gamarde", name: "Gamarde", extra: null, color: null, revenue: 30_000, units: 180, days: 18, animations: 18, prevRevenue: 25_000 }, { id: "b-alpha", name: "Alphascience", extra: null, color: null, revenue: 4_000, units: 30, days: 2, animations: 2, prevRevenue: 0 }]
      : dim === "product" ? [{ id: "p1", name: "Crème A", extra: "Gamarde", color: null, revenue: 20_000, units: 100, days: 10, animations: 10, prevRevenue: 0 }]
      : dim === "animatrice" ? [{ id: "u-salma", name: "Salma", extra: "Casablanca", color: null, revenue: 34_000, units: 210, days: 20, animations: 20, prevRevenue: 30_000 }]
      : [{ id: "Casablanca", name: "Casablanca", extra: null, color: null, revenue: 34_000, units: 210, days: 20, animations: 20, prevRevenue: 30_000 }]),
    animationObjectives: async () => [{ city: "Casablanca", brandId: "b-gamarde", brandName: "Gamarde", color: "#000", yearlyUnits: 3650, monthlyUnits: 304 }],
    objectiveForRange: (objs, range, opts) => objs.filter((o) => !opts?.brandId || o.brandId === opts.brandId).reduce((s, o) => s + (o.yearlyUnits * 30) / 365, 0) * (range ? 1 : 1),
    productStocks: async (opts) => [stock({}), stock({ productId: "p2", sku: "SKU2", name: "Sérum B", brandId: "b-alpha", brandName: "Alphascience", coverageMonths: 0.5, level: "red", recommendedOrder: 300 }), stock({ productId: "p3", sku: "SKU3", name: "Sans photo", stockKnown: false, level: "unknown", coverageMonths: null })].filter((p) => !opts.brandId || p.brandId === opts.brandId),
    budgetConsumption: async (_y, brandId) => (brandId === "b-alpha" ? { brandId, hasBudget: false, annual: 0, planned: 0, committed: 0, spent: 0, adSpend: 0, adSource: "AUCUNE", manualAdIgnored: 0, samplesValue: 0, consumed: 0, remaining: null, consumedPct: null }
      : { brandId: brandId ?? null, hasBudget: true, annual: 500_000, planned: 20_000, committed: 300_000, spent: 250_000, adSpend: 80_000, adSource: "REGIE", manualAdIgnored: 5_000, samplesValue: 0, consumed: 300_000, remaining: 200_000, consumedPct: 60 }),
    budgetByCategory: async () => [{ category: "META", planned: 200_000, committed: 150_000, spent: 120_000 }, { category: "ANIMATION", planned: 100_000, committed: 90_000, spent: 90_000 }],
    adsByDim: async (_d, range) => (range.start >= "2026-09-01" ? [] : [{ key: "META|Été", platform: "META", campaignName: "Été Gamarde", campaignId: null, brandId: "b-gamarde", brandName: "Gamarde", brandColor: null, spend: 12_000, impressions: 400_000, reach: 200_000, clicks: 6_000, linkClicks: 5_000, landingPageViews: 3_000, leads: 0, purchases: 40, messagingStarted: 300, revenue: 30_000, days: 28, objective: "OUTCOME_SALES" }]),
    adKpis: (r) => ({ ...r, cpm: 30, ctr: 1.25, cpc: 2.4, conversionRate: 0.8, cpa: 300, roas: 2.5, frequency: 2, costPerLead: null, costPerMessage: 40, resultKind: "purchase", results: r.purchases, costPerResult: 300, resultRate: 0.8 }),
    adDiagnose: () => ({ verdict: "SCALE", headline: "ROAS 2,5", signals: [], diagnostic: "Achat rentable", actions: ["Augmenter de 20 %"] }),
    adBrandAverages: () => ({ cpa: 300, roas: 2.5, ctr: 1.25 }),
    adsIntel: {
      get_current_ads_performance: async () => ({ period: { key: "30d", start: "2026-08-12", end: "2026-09-11", label: "30 derniers jours", prevLabel: "30 j précédents", days: 30 }, snapshot: { spend: 6500, spendDelta: 10, results: 1200, resultsDelta: 5, resultKind: "landing", resultLabel: "vues de page", costPerResult: 5.4, costDelta: -8, costLabel: "coût / vue de page", messages: 374, landing: 1200, clicks: 3000, impressions: 900_000, reach: 600_000, revenue: 0, roas: null, activeCampaigns: 3 }, health: { score: 72, tone: "green", why: ["2 winners actifs"], components: [] }, allocation: [], budget: { monthSpend: 2000, monthlyBudget: null, consumedPct: null, projected: 6000, status: "UNDEFINED", daysElapsed: 10, daysInMonth: 30 }, impact: { spend: 6500, results: 1200, resultKind: "landing", costPerResult: 5.4, measuredRevenue: 0, roas: null, sellIn: 100_000, sellInPrev: 80_000, sellInDeltaPct: 25, spendToSalesPct: 6.5, estimatedValue: null, contribution: null, notes: [] }, data: { connected: true, verdict: "LIVE", lastSuccessfulSync: "2026-09-10T08:00:00Z", lastSyncError: null, accounts: [], historyFirstDay: "2023-08-01", historyLastDay: "2026-09-09", closedRows: 5000, backfill: [], unavailableMonths: [] } }),
      get_historical_performance: async () => [],
      get_top_winners: async () => ({ winners: { campaigns: [], creatives: [], products: [], offers: [] }, verdicts: {} }),
      get_underperformers: async () => [],
      detect_anomalies: async () => [],
      detect_creative_fatigue: async () => [],
      recommend_budget_allocation: async () => ({ allocation: [], actions: [], budget: { monthSpend: 0, monthlyBudget: null, consumedPct: null, projected: null, status: "UNDEFINED", daysElapsed: 1, daysInMonth: 30 } }),
      recommend_products_to_push: async () => [{ productId: "p1", productName: "Crème A", brandId: "b-gamarde", brandName: "Gamarde", decision: "PUSH", score: 66, why: ["Coût par résultat -20 % vs moyenne Gamarde"], spend: 2000, results: 400, resultKind: "landing", costPerResult: 5, winners: 1, stockNote: null }],
      recommend_content_to_create: async () => ({ opportunities: [], patterns: [], memory: [] }),
      explain_campaign_performance: async () => null,
      compare_with_historical_benchmark: async () => null,
    },
    regulatoryFiles: async () => [
      { id: "r1", dossier: "D-1", reference: "REF1", variant_type: "MODELE_VENTE", size: "50 ml", status: "VALIDE", blocked: false, expiry_date: "2026-09-30", certificate_status: "CE_OBTENU", product_name: "Crème A", brand_name: "Gamarde", brand_id: "b-gamarde", responsible: "Nadia" },
      { id: "r2", dossier: "D-2", reference: "REF2", variant_type: "ECHANTILLON", size: null, status: "A_DEPOSER", blocked: false, expiry_date: null, certificate_status: null, product_name: "Sérum B", brand_name: "Alphascience", brand_id: "b-alpha", responsible: null },
      { id: "r3", dossier: "D-3", reference: "REF3", variant_type: "MODELE_VENTE", size: null, status: "VALIDE", blocked: false, expiry_date: "2028-01-01", certificate_status: "CE_OBTENU", product_name: "Crème C", brand_name: "Gamarde", brand_id: "b-gamarde", responsible: "Nadia" },
    ],
    recommendations: async () => [rec({}), rec({ key: "reg:r2", category: "REGLEMENTAIRE", priority: "CRITICAL", title: "Alphascience — Sérum B", brandId: "b-alpha", score: 9000 }), rec({ key: "stock:p9", priority: "LOW", title: "Gamarde — Crème Z", existingTask: { id: "t9", status: "TODO", assignee: "Ali" } })],
    listTasks: async (opts) => [
      { id: "t1", title: "Relancer Para Sud", status: "TODO" as const, priority: "HIGH" as const, dueDate: "2026-09-01", source: "ACTION_CENTER", assigneeId: "u-salma", assignee: "Salma", brand: "Gamarde", brandColor: null, entityType: null, entityId: null, comments: 0, createdAt: "2026-08-30" },
      { id: "t2", title: "Tâche proposée", status: "PROPOSED" as const, priority: "MEDIUM" as const, dueDate: "2026-09-20", source: "AI", assigneeId: null, assignee: null, brand: null, brandColor: null, entityType: null, entityId: null, comments: 0, createdAt: "2026-09-08" },
    ].filter((t) => !opts.assigneeId || t.assigneeId === opts.assigneeId),
    search: async (q) => ({ products: [{ id: "p1", label: "Crème A", sub: "Gamarde", href: "/produits/p1" }], clients: q ? [{ id: "c1", label: "Pharmacie Atlas", sub: "Marrakech", href: "/clients/c1" }] : [], brands: [{ id: "b-gamarde", label: "Gamarde", sub: null, href: "/marques/b-gamarde" }], tasks: [], regulatory: [{ id: "r1", label: "Crème A", sub: null, href: "/reglementaire/r1" }], campaigns: [], contents: [], users: [] }),
    insertProposedTask: async (input) => { calls.tasks.push(input); return { id: "task-new" }; },
    insertReportDraft: async (input) => { calls.reports.push(input); return { id: "report-new" }; },
    logToolCall: async (e) => { calls.logs.push(e); },
    ...over,
  };
}

function perms(...modules: (keyof PermissionSet)[]): PermissionSet {
  const p = noPermissions();
  for (const m of modules) { p[m].view = true; p[m].create = true; }
  return p;
}

function access(over: Partial<ToolAccess> = {}): ToolAccess {
  return { userId: "u-hicham", userName: "Hicham", perms: perms("ventes", "clients", "produits", "stock", "marketing", "budgets", "terrain", "reglementaire", "taches", "rapports"), scope: "ALL", brandIds: null, clientIds: null, ownOnly: false, seeInternalCosts: true, ...over };
}

function ctx(over: Partial<ToolContext> = {}, calls: Calls = { logs: [], tasks: [], reports: [] }, deps: Partial<ToolDeps> = {}): ToolContext & { calls: Calls } {
  return { access: access(), refDate: new Date("2026-08-31T12:00:00Z"), now: new Date("2026-09-09T12:00:00Z"), settings: DEFAULT_SETTINGS, deps: makeDeps(calls, deps), ...over, calls };
}

const ok = <T,>(r: { available: boolean }): T => { assert.equal(r.available, true, JSON.stringify(r)); return r as unknown as T; };
type Ok = { available: true; source: string; scope: string; data: Record<string, unknown>; rowCount: number; notes?: string[]; links?: { href: string }[] };
type Ko = { available: false; reason: string; howToFix: string };

/* ------------------------------ Registre ------------------------------ */

describe("registre des outils", () => {
  test("les douze outils du plan (plus get_ads_intelligence) sont présents, triés par nom", () => {
    assert.deepEqual(TOOL_NAMES, [...TOOL_NAMES].sort());
    for (const n of ["get_sales_summary", "get_client_intelligence", "get_terrain_summary", "get_stock_coverage", "get_marketing_budget", "get_ads_performance", "get_regulatory_alerts", "get_action_center", "get_tasks", "search_entities", "propose_task", "propose_report"]) assert.ok(TOOL_NAMES.includes(n), n);
    assert.equal(TOOLS.length, 13);
  });
  test("chaque schéma JSON est un objet fermé sans $schema, avec descriptions", () => {
    for (const d of toolDefinitions(TOOLS)) {
      assert.equal(d.input_schema.type, "object");
      assert.equal(d.input_schema.additionalProperties, false);
      assert.ok(!("$schema" in d.input_schema));
      assert.ok(d.description.length > 40, d.name);
      for (const [k, v] of Object.entries(d.input_schema.properties)) assert.ok(typeof v === "object" && v && "type" in v || "enum" in (v as object), `${d.name}.${k}`);
    }
    const t = toolDefinitions(TOOLS).find((d) => d.name === "propose_task")!;
    assert.ok(t.input_schema.required?.includes("due_date"));
    assert.ok(!t.input_schema.required?.includes("brand"));
  });
  test("seuls propose_task et propose_report écrivent", () => {
    assert.deepEqual(TOOLS.filter((t) => t.writes).map((t) => t.name).sort(), ["propose_report", "propose_task"]);
    const a = access();
    assert.ok(!toolsFor(a, { allowWrites: false }).some((t) => t.writes));
  });
});

/* ------------------------------ Permissions ------------------------------ */

describe("filtrage par permissions", () => {
  test("un profil marketing ne reçoit ni ventes, ni stock, ni réglementaire", () => {
    const a = access({ perms: perms("marketing", "budgets") });
    const names = toolsFor(a).map((t) => t.name);
    assert.ok(names.includes("get_ads_performance"));
    assert.ok(names.includes("get_marketing_budget"));
    assert.ok(names.includes("get_action_center"));
    assert.ok(!names.includes("get_sales_summary"));
    assert.ok(!names.includes("get_stock_coverage"));
    assert.ok(!names.includes("get_regulatory_alerts"));
    assert.ok(!names.includes("propose_task"), "Créer sur Tâches requis");
  });
  test("propose_task exige Créer sur Tâches, propose_report exige Créer sur Rapports", () => {
    const p = perms("taches"); p.taches.create = false; p.rapports.view = true;
    const a = access({ perms: p });
    assert.equal(isToolAllowed(TOOLS.find((t) => t.name === "propose_task")!, a), false);
    assert.equal(isToolAllowed(TOOLS.find((t) => t.name === "propose_report")!, a), false);
  });
  test("aucun module → aucun outil, même search et action center", () => {
    assert.deepEqual(toolsFor(access({ perms: noPermissions() })), []);
  });
  test("executeTool refuse un outil hors permissions et le journalise", async () => {
    const c = ctx({ access: access({ perms: perms("marketing") }) });
    const r = (await executeTool("get_sales_summary", { period: "month" }, c)) as Ko;
    assert.equal(r.available, false);
    assert.match(r.reason, /accès/);
    assert.equal(c.calls.logs.length, 1);
    assert.equal(c.calls.logs[0].tool, "get_sales_summary");
    assert.match(c.calls.logs[0].error ?? "", /permissions/);
  });
  test("executeTool refuse un outil inconnu (pas de SQL libre)", async () => {
    const c = ctx();
    const r = (await executeTool("run_sql", { query: "update sales set amount = 0" }, c)) as Ko;
    assert.equal(r.available, false);
    assert.equal(c.calls.tasks.length + c.calls.reports.length, 0);
  });
  test("paramètres invalides → indisponible, explication, journal", async () => {
    const c = ctx();
    const r = (await executeTool("get_sales_summary", { period: "trimestre-dernier" }, c)) as Ko;
    assert.equal(r.available, false);
    assert.match(r.reason, /period/);
    assert.match(c.calls.logs[0].error ?? "", /invalides/);
  });
  test("une exception d'un outil devient un résultat indisponible, jamais une erreur remontée", async () => {
    const c = ctx({}, undefined, { salesTotals: async () => { throw new Error("connexion perdue"); } });
    const r = (await executeTool("get_sales_summary", {}, c)) as Ko;
    assert.equal(r.available, false);
    assert.match(r.reason, /connexion perdue/);
    assert.equal(c.calls.logs[0].error, "connexion perdue");
  });
});

/* ------------------------------ Portée ------------------------------ */

describe("portée marques / clients / OWN", () => {
  test("marque hors des marques assignées : refus explicite", async () => {
    const c = ctx({ access: access({ scope: "ASSIGNED", brandIds: ["b-gamarde"] }) });
    const r = (await executeTool("get_sales_summary", { brand: "Alphascience" }, c)) as Ko;
    assert.equal(r.available, false);
    assert.match(r.reason, /périmètre/);
  });
  test("sans marque demandée, la portée marques est transmise au filtre de ventes", async () => {
    let seen: unknown;
    const c = ctx({ access: access({ scope: "ASSIGNED", brandIds: ["b-gamarde"] }) }, undefined, { salesTotals: async (_s, _e, f) => { seen = f; return { amount: 10, quantity: 1, orders: 1, clients: 1, lines: 1 }; } });
    ok(await executeTool("get_sales_summary", { compare_to: "none" }, c));
    assert.deepEqual((seen as { brandIds: string[] }).brandIds, ["b-gamarde"]);
  });
  test("le stock ne montre que les marques assignées", async () => {
    const c = ctx({ access: access({ scope: "ASSIGNED", brandIds: ["b-alpha"] }) });
    const r = ok<Ok>(await executeTool("get_stock_coverage", {}, c));
    const rows = r.data.rows as { brand: string }[];
    assert.ok(rows.every((x) => x.brand === "Alphascience"));
    assert.equal(r.data.products, 1);
  });
  test("l'Action Center est filtré par modules visibles et marques assignées", async () => {
    const c = ctx({ access: access({ perms: perms("stock"), scope: "ASSIGNED", brandIds: ["b-gamarde"] }) });
    const r = ok<Ok>(await executeTool("get_action_center", {}, c));
    const rows = r.data.rows as { key: string; category: string }[];
    assert.deepEqual(rows.map((x) => x.key), ["stock:p1"]);
  });
  test("portée OWN : le terrain est restreint à ses propres animations et sans classement des autres", async () => {
    let seen: unknown;
    const c = ctx({ access: access({ scope: "OWN", ownOnly: true, userId: "u-salma", seeInternalCosts: false }) }, undefined, { animationTotals: async (_r, f) => { seen = f; return { revenue: 100, units: 2, days: 1, animations: 1, pos: 1, customers: 3, cost: 318 }; } });
    const r = ok<Ok>(await executeTool("get_terrain_summary", { animatrice: "Quelqu'un d'autre" }, c));
    assert.deepEqual(seen, { animatriceId: "u-salma" });
    assert.deepEqual(r.data.animatrices, []);
    assert.equal(r.data.cost_mad, null, "coût interne masqué sans l'interrupteur");
  });
  test("portée OWN : les tâches sont les siennes", async () => {
    const c = ctx({ access: access({ scope: "OWN", ownOnly: true, userId: "u-salma" }) });
    const r = ok<Ok>(await executeTool("get_tasks", { assignee: "Hicham" }, c));
    assert.equal(r.data.count, 1);
  });
  test("clients assignés : un client hors portée est refusé, la liste est restreinte", async () => {
    const c = ctx({ access: access({ scope: "ASSIGNED", clientIds: ["c1"] }) });
    const r = (await executeTool("get_sales_summary", { client: "Para Sud" }, c)) as Ko;
    assert.match(r.reason, /périmètre/);
    const r2 = ok<Ok>(await executeTool("get_client_intelligence", {}, c));
    assert.equal(r2.data.total_clients, 1);
  });
});

/* ------------------------------ Contenu et limites ------------------------------ */

describe("résultats compacts et sourcés", () => {
  test("ventes : sell-in nommé, période, comparaison, objectif, top limité", async () => {
    const c = ctx();
    const r = ok<Ok>(await executeTool("get_sales_summary", { period: "month", top: "product", limit: 50 }, c));
    assert.match(r.source, /sell-in/i);
    assert.equal(r.data.revenue_mad, 100_000);
    assert.equal((r.data.comparison as { revenue_change_pct: number }).revenue_change_pct, 25);
    assert.equal(r.data.objective_completion_pct, 83.3);
    assert.equal((r.data.top as unknown[]).length, MAX_ROWS, "limite plafonnée à MAX_ROWS");
    const tooBig = (await executeTool("get_sales_summary", { top: "product", limit: 500 }, ctx())) as Ko;
    assert.match(tooBig.reason, /limit/);
    assert.equal(c.calls.logs[0].rowCount, 1 + MAX_ROWS);
    assert.ok(c.calls.logs[0].durationMs >= 0);
  });
  test("ventes : ville → clients de la ville", async () => {
    let seen: unknown;
    const c = ctx({}, undefined, { salesTotals: async (_s, _e, f) => { seen = f; return { amount: 5, quantity: 1, orders: 1, clients: 1, lines: 1 }; } });
    ok(await executeTool("get_sales_summary", { city: "Marrakech", compare_to: "none" }, c));
    assert.deepEqual((seen as { clientIds: string[] }).clientIds, ["c1"]);
    const r = (await executeTool("get_sales_summary", { city: "Atlantide" }, c)) as Ko;
    assert.match(r.reason, /Aucun client/);
  });
  test("ventes : aucune ligne → indisponible avec l'import à faire", async () => {
    const r = (await executeTool("get_sales_summary", { brand: "Alphascience" }, ctx())) as Ko;
    assert.equal(r.available, false);
    assert.match(r.howToFix, /Imports → Ventes/);
  });
  test("terrain : sell-out nommé, objectif d'unités, palmarès", async () => {
    const r = ok<Ok>(await executeTool("get_terrain_summary", { brand: "Gamarde" }, ctx()));
    assert.match(r.source, /sell-out/i);
    assert.ok(!/sell-in/i.test(r.source));
    assert.equal(r.data.sell_out_ttc_mad, 30_000);
    assert.equal(r.data.objective_units, 300);
    assert.equal(r.data.objective_completion_pct, 60);
    assert.equal((r.data.top_products as unknown[]).length, 1);
    const ko = (await executeTool("get_terrain_summary", { city: "Nulle-Part" }, ctx())) as Ko;
    assert.match(ko.howToFix, /Saisie/);
  });
  test("stock : niveaux, produit sans photo signalé, tri par couverture", async () => {
    const r = ok<Ok>(await executeTool("get_stock_coverage", {}, ctx()));
    assert.equal(r.data.at_risk_count, 1);
    const rows = r.data.rows as { product: string; coverage_months: number | null }[];
    assert.equal(rows[0].product, "Sérum B");
    assert.ok(r.notes?.[0].includes("sans photo"));
    const red = ok<Ok>(await executeTool("get_stock_coverage", { level: "red" }, ctx()));
    assert.equal(red.rowCount, 1);
  });
  test("stock : aucune photo → indisponible, jamais estimé", async () => {
    const r = (await executeTool("get_stock_coverage", {}, ctx({}, undefined, { productStocks: async () => [stock({ stockKnown: false, level: "unknown", coverageMonths: null })] }))) as Ko;
    assert.equal(r.available, false);
    assert.match(r.howToFix, /Imports → Stock/);
  });
  test("clients : segments, filtres, tri", async () => {
    const r = ok<Ok>(await executeTool("get_client_intelligence", { segment: "EN_RETARD" }, ctx()));
    assert.equal((r.data.filter as { matched: number }).matched, 1);
    const inactive = ok<Ok>(await executeTool("get_client_intelligence", { min_days_since_last_order: 90, sort: "days_since_last" }, ctx()));
    const rows = inactive.data.top as { name: string }[];
    assert.deepEqual(rows.map((x) => x.name), ["Grossiste Nord", "Para Sud"]);
  });
  test("budget : prévu / engagé / dépensé / restant et catégories", async () => {
    const r = ok<Ok>(await executeTool("get_marketing_budget", { brand: "Gamarde" }, ctx()));
    assert.equal(r.data.remaining_mad, 200_000);
    assert.equal(r.data.consumed_pct, 60);
    assert.equal((r.data.by_category as { category: string }[])[0].category, "Meta Ads");
    const ko = (await executeTool("get_marketing_budget", { brand: "Alphascience" }, ctx())) as Ko;
    assert.match(ko.howToFix, /Budgets/);
  });
  test("publicité : verdict et CA mesuré, période sans journée close → indisponible", async () => {
    const r = ok<Ok>(await executeTool("get_ads_performance", { period: "prevMonth" }, ctx()));
    assert.equal((r.data.rows as { verdict: string }[])[0].verdict, "SCALE");
    assert.equal(r.data.measured_revenue_mad, 30_000);
    const ko = (await executeTool("get_ads_performance", { period: "month" }, ctx())) as Ko;
    assert.match(ko.reason, /Aucune journée/);
  });
  test("réglementaire : situations calculées au jour réel, tri par urgence", async () => {
    const r = ok<Ok>(await executeTool("get_regulatory_alerts", {}, ctx()));
    const rows = r.data.rows as { situation: string; days_to_expiry: number | null }[];
    assert.deepEqual(rows.map((x) => x.situation), ["CRITIQUE", "NON_DEPOSE"]);
    assert.equal(rows[0].days_to_expiry, 21);
    assert.equal(r.data.total_files, 3);
  });
  test("action center : tri priorité puis enjeu, exclusion des recommandations déjà en tâche", async () => {
    const r = ok<Ok>(await executeTool("get_action_center", {}, ctx()));
    const rows = r.data.rows as { key: string }[];
    assert.deepEqual(rows.map((x) => x.key), ["reg:r2", "stock:p1"]);
    const all = ok<Ok>(await executeTool("get_action_center", { include_with_task: true }, ctx()));
    assert.equal(all.rowCount, 3);
  });
  test("tâches : les proposées ne comptent pas dans les ouvertes", async () => {
    const open = ok<Ok>(await executeTool("get_tasks", {}, ctx()));
    assert.equal(open.data.count, 1);
    assert.equal(open.data.overdue, 1);
    const proposed = ok<Ok>(await executeTool("get_tasks", { status: "proposed" }, ctx()));
    assert.equal(proposed.data.count, 1);
  });
  test("recherche : sections limitées aux modules visibles", async () => {
    const r = ok<Ok>(await executeTool("search_entities", { query: "crème" }, ctx({ access: access({ perms: perms("produits") }) })));
    assert.deepEqual(Object.keys(r.data), ["marques", "produits"]);
  });
});

/* ------------------------------ Écritures ------------------------------ */

describe("écritures : uniquement des propositions", () => {
  test("propose_task crée une tâche PROPOSED avec la donnée d'origine", async () => {
    const c = ctx();
    const r = ok<Ok>(await executeTool("propose_task", { title: "Relancer Grossiste Nord", description: "Inactif depuis 200 jours, CA 12 mois 5 000 MAD. Appeler et proposer une offre de réactivation.", due_date: "2026-09-16", module: "clients", brand: "Gamarde", source_insight: "get_client_intelligence, 12 mois au 31/08/2026", assignee: "Salma" }, c));
    assert.equal(r.data.status, "PROPOSED");
    assert.equal(c.calls.tasks.length, 1);
    const t = c.calls.tasks[0] as { brandId: string; assigneeId: string; description: string };
    assert.equal(t.brandId, "b-gamarde");
    assert.equal(t.assigneeId, "u-salma");
    assert.match(t.description, /Donnée à l'origine/);
  });
  test("propose_task refuse une échéance passée", async () => {
    const c = ctx();
    const r = (await executeTool("propose_task", { title: "Titre valide", description: "Description assez longue.", due_date: "2026-01-01", module: "ventes", source_insight: "outil x" }, c)) as Ko;
    assert.equal(r.available, false);
    assert.equal(c.calls.tasks.length, 0);
  });
  test("propose_report : revue mensuelle sans marque refusée, brouillon sinon", async () => {
    const c = ctx();
    const base = { period_start: "2026-08-01", period_end: "2026-09-01", title: "Revue Gamarde août 2026", content_md: "# Revue\n\n## Ventes (get_sales_summary, août 2026)\n\nCA sell-in 100 000 MAD." };
    const ko = (await executeTool("propose_report", { type: "MONTHLY_BRAND_REVIEW", ...base }, c)) as Ko;
    assert.match(ko.reason, /marque/);
    const r = ok<Ok>(await executeTool("propose_report", { type: "MONTHLY_BRAND_REVIEW", brand: "Gamarde", ...base }, c));
    assert.equal(r.data.status, "DRAFT");
    assert.equal(c.calls.reports.length, 1);
  });
});
