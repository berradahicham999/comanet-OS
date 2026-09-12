/**
 * Agent marketing — les six scénarios du cahier des charges, joués avec des doublures (aucune base, aucun
 * appel API) : la mécanique de bout en bout (outils → moteur → réponse) est vérifiée, pas la qualité du modèle.
 *   1. « Analyse Gamarde » lit la donnée réelle des outils (rien de statique).
 *   2. « Quel SKU pousser ? » croise ventes et stock.
 *   3. « Quel produit risque la rupture ? » utilise stock + vitesse de vente.
 *   4. « Quel produit est en surstock ? » utilise la couverture.
 *   5. « Pourquoi ce produit ? » cite les données utilisées, étiquetées.
 *   6. Une marque sans données → DATA MISSING, rien d'inventé.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { noPermissions, type PermissionSet } from "@/lib/permissions-shared";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import type { ProductStock } from "@/lib/stock";
import type { ProductRow } from "@/lib/products";
import type { DimRow } from "@/lib/analytics";
import { runCopilot, type CallModel } from "@/lib/ai/run";
import { executeTool, type ToolContext, type ToolDeps, type ToolResult } from "@/lib/ai/tools";
import { unsourcedNumbers } from "./guardrails.test";

/* ------------------------------ Jeu de données Gamarde (doublures) ------------------------------ */

const REF = new Date("2026-08-31T12:00:00Z");
const BRANDS = [{ id: "b-gamarde", name: "Gamarde" }, { id: "b-alpha", name: "Alphascience" }];

const CUR: DimRow[] = [
  { id: "p1", name: "Crème A", extra: "Gamarde", amount: 30_000, quantity: 375, orders: 20, clients: 15 },
  { id: "p3", name: "SPF C", extra: "Gamarde", amount: 12_000, quantity: 90, orders: 9, clients: 8 },
  { id: "p2", name: "Sérum B", extra: "Gamarde", amount: 8_000, quantity: 60, orders: 6, clients: 5 },
  { id: "p4", name: "Sans photo D", extra: "Gamarde", amount: 1_000, quantity: 10, orders: 1, clients: 1 },
];
const PREV: DimRow[] = [
  { id: "p1", name: "Crème A", extra: "Gamarde", amount: 22_000, quantity: 280, orders: 15, clients: 12 },
  { id: "p3", name: "SPF C", extra: "Gamarde", amount: 9_000, quantity: 70, orders: 7, clients: 6 },
  { id: "p2", name: "Sérum B", extra: "Gamarde", amount: 9_000, quantity: 70, orders: 7, clients: 6 },
];
const sum = (rows: DimRow[]) => ({ amount: rows.reduce((s, r) => s + r.amount, 0), quantity: rows.reduce((s, r) => s + r.quantity, 0), orders: rows.reduce((s, r) => s + r.orders, 0), clients: 15, lines: rows.length * 10 });
const isCur = (start: string) => start >= "2026-08-01";

function stock(over: Partial<ProductStock>): ProductStock {
  return {
    productId: "p1", sku: "SKU1", name: "Crème A", brandId: "b-gamarde", brandName: "Gamarde", brandColor: null, category: null, stock: 850, stockKnown: true, onOrder: 0,
    stockDate: "2026-08-30", avgMonthly: 400, trendPct: 5, coverageMonths: 850 / 400, level: "yellow", stockoutDate: "2026-11-02", leadTimeDays: 60, safetyStockDays: 30, moq: null,
    recommendedOrder: 0, targetStock: 1600, costPrice: 40, priceWholesale: 80, marginPct: 50, stockValue: 34_000, fieldSellOut30d: 0, fieldStockAvg: null, ...over,
  };
}
const STOCKS: ProductStock[] = [
  stock({}),
  stock({ productId: "p2", sku: "SKU2", name: "Sérum B", stock: 1200, avgMonthly: 100, coverageMonths: 12, level: "green", stockoutDate: "2027-08-30", costPrice: 90, priceWholesale: 150, marginPct: 40, stockValue: 108_000 }),
  stock({ productId: "p3", sku: "SKU3", name: "SPF C", stock: 40, avgMonthly: 90, coverageMonths: 40 / 90, level: "red", stockoutDate: "2026-09-13", recommendedOrder: 300, costPrice: 50, priceWholesale: 100, marginPct: 50, stockValue: 2_000 }),
  stock({ productId: "p4", sku: "SKU4", name: "Sans photo D", stock: 0, stockKnown: false, stockDate: null, avgMonthly: 10, coverageMonths: null, level: "unknown", stockoutDate: null, stockValue: 0 }),
];
const catalog = (p: ProductStock): ProductRow => ({ id: p.productId, name: p.name, sku: p.sku, shortName: null, category: null, active: true, needsReview: false, brandId: p.brandId, brandName: p.brandName, brandColor: null, priceWholesale: p.priceWholesale, costPrice: p.costPrice, priceRetail: 150, revenue12: 100_000, qty12: 1_000, revenue3: 30_000, qtyPrev3: 250, qty3: 300, clients12: 20, lastSale: "2026-08-30" });

function deps(): ToolDeps {
  const gamarde = (f: { brandId?: string; brandIds?: string[] }) => f.brandId !== "b-alpha" && !(f.brandIds && !f.brandIds.includes("b-gamarde"));
  return {
    findBrand: async (q) => BRANDS.find((b) => b.name.toLowerCase().includes(q.toLowerCase())) ?? null,
    findClient: async () => null, findProduct: async (q) => STOCKS.map((s) => ({ id: s.productId, name: s.name })).find((p) => p.name.toLowerCase().includes(q.toLowerCase())) ?? null, findUser: async () => null, clientIdsInCity: async () => [],
    salesTotals: async (start, _end, f) => (gamarde(f) ? sum(isCur(start) ? CUR : PREV) : { amount: 0, quantity: 0, orders: 0, clients: 0, lines: 0 }),
    salesByDim: async (dim, start, _end, f) => (gamarde(f) && dim === "product" ? (isCur(start) ? CUR : PREV) : []),
    salesObjective: async (_y, _m, brandId) => (brandId === "b-alpha" ? null : 120_000),
    annualObjective: async (_y, brandId) => (brandId === "b-alpha" ? null : 1_400_000),
    productStocks: async (opts) => (opts.brandId === "b-alpha" ? [] : STOCKS),
    productCatalog: async (_ref, opts) => (opts.brandId === "b-alpha" ? [] : STOCKS.map(catalog)),
    budgetConsumption: async (_y, brandId) => ({ brandId: brandId ?? null, hasBudget: brandId !== "b-alpha", annual: 500_000, planned: 0, committed: 300_000, spent: 250_000, adSpend: 80_000, adSource: "REGIE", manualAdIgnored: 0, samplesValue: 0, consumed: 300_000, remaining: 200_000, consumedPct: 60 }),
    budgetByCategory: async () => [],
    adsByDim: async () => [], adKpis: (r) => ({ ...r, cpm: null, ctr: null, cpc: null, conversionRate: null, cpa: null, roas: null, frequency: null, costPerLead: null, costPerMessage: null, resultKind: "landing", results: 0, costPerResult: null, resultRate: null }) as unknown as ReturnType<ToolDeps["adKpis"]>,
    adDiagnose: () => ({ verdict: "WATCH", headline: "", signals: [], diagnostic: "", actions: [] }), adBrandAverages: () => ({ cpa: null, roas: null, ctr: null }),
    adsProductsToPush: async () => [{ productId: "p1", decision: "PUSH", costPerResult: 5, why: ["coût par résultat sous la référence"] }],
    marketingActivity: async () => ({
      campaigns: [{ id: "c1", name: "Rentrée Gamarde", type: "PROMOTION", channel: "META", status: "ACTIVE", objective: "sell-out pharmacies", offer: "-10 % pharmacien", startDate: "2026-09-01", endDate: "2026-09-30", budget: 20_000, kpiTarget: "300 conversations", kpiActual: null, products: ["Crème A"], spent: 4_000, adSpend: 3_500 }],
      contents: [{ id: "ct1", title: "Reel Crème A", date: "2026-09-15", deadline: "2026-09-12", platform: "INSTAGRAM", format: "REEL", status: "EN_CREATION_X", statusLabel: "En création", isPublished: false, awaitingValidation: false, inProduction: true, product: "Crème A", late: false }],
      collaborations: [], activations: [], brandObjectives: "5 000 unités / mois",
    }),
    adsIntel: {} as ToolDeps["adsIntel"],
    clientIntel: async () => [], animationTotals: async () => ({ revenue: 0, units: 0, days: 0, animations: 0, pos: 0, customers: 0, cost: 0 }), animationsByDim: async () => [], animationObjectives: async () => [], objectiveForRange: () => 0,
    regulatoryFiles: async () => [], recommendations: async () => [], listTasks: async () => [],
    search: async () => ({ products: [], clients: [], brands: [], tasks: [], regulatory: [], campaigns: [], contents: [], users: [] }),
    insertProposedTask: async () => ({ id: "t" }), insertReportDraft: async () => ({ id: "r" }), logToolCall: async () => undefined,
  };
}

function fullPerms(): PermissionSet { const p = noPermissions(); for (const m of Object.keys(p) as (keyof typeof p)[]) { p[m].view = true; p[m].create = true; p[m].edit = true; p[m].validate = true; } return p; }
function ctx(over: Partial<ToolContext["access"]> = {}): ToolContext {
  return { access: { userId: "u1", userName: "Hicham", perms: fullPerms(), scope: "ALL", brandIds: null, clientIds: null, ownOnly: false, seeInternalCosts: true, ...over }, refDate: REF, now: new Date("2026-09-10T12:00:00Z"), settings: DEFAULT_SETTINGS, deps: deps() };
}
type Ok = { available: true; source: string; scope: string; data: Record<string, unknown>; rowCount: number; notes?: string[] };
type Ko = { available: false; reason: string; howToFix: string };
const ok = (r: ToolResult): Ok => { assert.equal(r.available, true, JSON.stringify(r).slice(0, 300)); return r as Ok; };

/* ------------------------------ Les six scénarios ------------------------------ */

describe("TEST 1 — « Analyse Gamarde » : l'agent lit la donnée réelle, rien de statique", () => {
  test("get_brand_overview renvoie ventes, croissance, objectif, stock, top et fraîcheur, avec les étiquettes", async () => {
    const r = ok(await executeTool("get_brand_overview", { brand: "Gamarde", period: "30d" }, ctx()));
    const sales = r.data.sales as { revenue_mad: number; growth_pct: number; tags: Record<string, string> };
    assert.equal(sales.revenue_mad, 51_000);
    assert.equal(sales.growth_pct, 27.5);
    assert.equal(sales.tags.revenue_mad, "CONFIRMED");
    assert.equal(sales.tags.growth_pct, "CALCULATED");
    const obj = r.data.objectives as { month: { objective_mad: number; completion_pct: number } };
    assert.equal(obj.month.objective_mad, 120_000);
    assert.equal(obj.month.completion_pct, 42.5);
    const st = r.data.stock as { total_units: number; avg_days_of_stock: number; with_snapshot: number; products: number; stock_date: string; thresholds_days: { criticalBelowDays: number } };
    assert.equal(st.total_units, 2090);
    assert.equal(st.with_snapshot, 3);
    assert.equal(st.products, 4);
    assert.equal(st.stock_date, "2026-08-30");
    assert.equal(st.thresholds_days.criticalBelowDays, 30, "seuil lu dans Paramètres, converti en jours");
    const top = r.data.top_products as { product: string; category: string }[];
    assert.equal(top[0].product, "Crème A");
    assert.equal(top[0].category, "STAR");
    const risk = r.data.risk_products as { product: string }[];
    assert.deepEqual(risk.map((x) => x.product), ["SPF C"]);
    assert.ok(r.notes?.some((n) => /à jour au 2026-08-31/.test(n)), "fraîcheur des ventes annoncée");
    assert.ok(r.notes?.some((n) => /10 jour\(s\) de retard/.test(n)), "retard d'import signalé");
    assert.equal((r.data.marketing_activity as { activeCampaigns: number }).activeCampaigns, 1);
  });
  test("le contexte est filtré par les droits : sans module Stock, le bloc est « non accessible », jamais deviné", async () => {
    const p = noPermissions(); p.ventes.view = true;
    const r = ok(await executeTool("get_brand_overview", { brand: "Gamarde" }, ctx({ perms: p, seeInternalCosts: false })));
    assert.equal(r.data.stock, "non accessible");
    assert.equal(r.data.margin, "non accessible");
    assert.equal(r.data.marketing_activity, "non accessible");
    const top = r.data.top_products as { stock_units: number | null; margin_pct: number | null }[];
    assert.equal(top[0].stock_units, null);
    assert.equal(top[0].margin_pct, null);
  });
});

describe("TEST 2 — « Quel SKU Gamarde pousser ? » : ventes × stock", () => {
  test("le moteur pousse Crème A (+36 %, 64 j de stock) et refuse SPF C (+33 % mais 13 j de stock)", async () => {
    const r = ok(await executeTool("get_marketing_recommendations", { brand: "Gamarde", period: "30d" }, ctx()));
    const recos = r.data.recommendations as { priority: number; action: string; product: string; why: string[]; confidence: string }[];
    assert.equal(recos[0].priority, 1);
    assert.equal(recos[0].action, "PUSH");
    assert.equal(recos[0].product, "Crème A");
    assert.equal(recos[0].confidence, "HIGH");
    assert.ok(!recos.some((x) => x.product === "SPF C" && x.action === "PUSH"), "un produit en rupture n'est jamais PUSH malgré sa croissance");
    const dnp = r.data.do_not_push as { action: string; product: string; why: string[] }[];
    assert.equal(dnp[0].product, "SPF C");
    assert.equal(dnp[0].action, "RESTOCK");
    assert.ok(dnp[0].why.some((w) => /13 jours/.test(w)));
    assert.ok(recos.some((x) => x.product === "Sérum B" && x.action === "CREATE_PROMOTION"), "surstock + baisse = promotion");
    assert.equal(r.data.ads_signal, "READ");
  });
});

describe("TEST 3 — « Quel produit risque la rupture ? » : stock + vitesse de vente", () => {
  test("get_stock_risk classe SPF C en rupture (40 unités, 90/mois → 13 jours) et pas les autres", async () => {
    const r = ok(await executeTool("get_stock_risk", { brand: "Gamarde", risk: "RUPTURE_RISQUE" }, ctx()));
    const rows = r.data.rupture_risk as { product: string; days_of_stock: number; avg_daily_sales: number; stock_units: number; stockout_date: string }[];
    assert.deepEqual(rows.map((x) => x.product), ["SPF C"]);
    assert.equal(rows[0].days_of_stock, 13);
    assert.equal(rows[0].stock_units, 40);
    assert.equal(rows[0].avg_daily_sales, 3);
    assert.equal(rows[0].stockout_date, "2026-09-13");
    assert.equal(r.data.revenue_last_30d_at_rupture_risk_mad, 12_000);
    assert.ok(r.notes?.some((n) => /1 produit\(s\) sans photo de stock/.test(n)));
  });
});

describe("TEST 4 — « Quel produit est en surstock ? » : couverture", () => {
  test("get_inventory_status : Sérum B est OVERSTOCK (360 jours), Crème A HEALTHY, Sans photo D UNKNOWN", async () => {
    const r = ok(await executeTool("get_inventory_status", { brand: "Gamarde", status: "OVERSTOCK" }, ctx()));
    const rows = r.data.rows as { product: string; days_of_stock: number; status: string }[];
    assert.deepEqual(rows.map((x) => [x.product, x.days_of_stock, x.status]), [["Sérum B", 360, "OVERSTOCK"]]);
    const all = ok(await executeTool("get_inventory_status", { brand: "Gamarde" }, ctx()));
    const byStatus = all.data.by_status as Record<string, number>;
    assert.equal(byStatus["OVERSTOCK (surstock)"], 1);
    assert.equal(byStatus["CRITICAL (critique)"], 1);
    assert.equal(byStatus["UNKNOWN (stock non renseigné)"], 1);
    const unknown = (all.data.rows as { product: string; stock_units: number | null; days_of_stock: number | null }[]).find((x) => x.product === "Sans photo D")!;
    assert.equal(unknown.stock_units, null, "sans photo : null, jamais 0");
    assert.equal(unknown.days_of_stock, null);
  });
});

describe("TEST 5 — « Pourquoi recommandes-tu ce produit ? » : les données citées, étiquetées", () => {
  test("chaque décision porte 3 à 5 raisons chiffrées et des faits CONFIRMED / CALCULATED / MISSING", async () => {
    const r = ok(await executeTool("get_marketing_recommendations", { brand: "Gamarde" }, ctx()));
    const first = (r.data.recommendations as { why: string[]; data: string[]; expected_impact: string; confidence_why: string[] }[])[0];
    assert.ok(first.why.length >= 3 && first.why.length <= 5);
    assert.ok(first.why.some((w) => /\+36/.test(w)), "croissance citée");
    assert.ok(first.why.some((w) => /64 jours/.test(w)), "couverture citée (850 ÷ 400 mois × 30 = 64 jours)");
    assert.ok(first.why.some((w) => /58,8 %|58.8 %/.test(w)), "contribution citée");
    assert.ok(first.data.some((d) => /\[CONFIRMED\]/.test(d)) && first.data.some((d) => /\[CALCULATED\]/.test(d)));
    assert.ok(first.expected_impact.length > 20);
    assert.ok((r.data.legend as Record<string, string>).MISSING);
    const perf = ok(await executeTool("get_product_performance", { brand: "Gamarde", product: "Crème A" }, ctx()));
    const row = (perf.data.rows as { reasons: string[]; category: string; history: { trend_3m_pct: number } }[])[0];
    assert.equal(row.category, "STAR");
    assert.equal(row.history.trend_3m_pct, 20);
    assert.ok(row.reasons.length >= 2);
  });
});

describe("TEST 6 — marque sans données : DATA MISSING, rien d'inventé", () => {
  test("Alphascience : chaque outil renvoie indisponible avec l'import à faire", async () => {
    const r1 = (await executeTool("get_brand_overview", { brand: "Alphascience" }, ctx())) as Ko;
    assert.equal(r1.available, false);
    assert.match(r1.howToFix, /Imports → Ventes/);
    const r2 = (await executeTool("get_stock_risk", { brand: "Alphascience" }, ctx())) as Ko;
    assert.equal(r2.available, false);
    assert.match(r2.howToFix, /Imports → (Produits|Stock)/);
    const r3 = (await executeTool("get_sales_targets", { brand: "Alphascience" }, ctx())) as Ko;
    assert.equal(r3.available, false);
    assert.match(r3.reason, /Aucun objectif/);
    const r4 = (await executeTool("get_marketing_recommendations", { brand: "Alphascience" }, ctx())) as Ko;
    assert.equal(r4.available, false);
  });
  test("de bout en bout : le modèle factice répond « donnée non disponible » et ne cite aucun chiffre non sourcé", async () => {
    let turn = 0;
    const msg = (content: Anthropic.ContentBlock[], stop: Anthropic.Message["stop_reason"]) => ({ id: "m", type: "message", role: "assistant", model: "fake", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }) as unknown as Anthropic.Message;
    const callModel: CallModel = async (p) => {
      turn++;
      if (turn === 1) return msg([{ type: "tool_use", id: "t1", name: "get_brand_overview", input: { brand: "Alphascience" } } as Anthropic.ToolUseBlock], "tool_use");
      const last = p.messages.at(-1)!;
      const block = (last.content as Anthropic.ToolResultBlockParam[]).find((b) => b.type === "tool_result")!;
      const r = JSON.parse(block.content as string) as ToolResult;
      const text = r.available ? "### Donnée\nok\n\n### Analyse\n—\n\n### Hypothèse\n—\n\n### Recommandation\n—" : `### Donnée\nDATA MISSING — donnée non disponible dans COMANET OS : ${r.reason}\n\n### Analyse\nJe ne dispose pas des données nécessaires pour conclure.\n\n### Hypothèse\nAucune hypothèse solide avec les données disponibles.\n\n### Recommandation\n${r.howToFix}`;
      return msg([{ type: "text", text, citations: null } as Anthropic.TextBlock], "end_turn");
    };
    const out = await runCopilot({ model: "fake", system: [], history: [], question: "Analyse Alphascience et dis-moi quoi pousser", toolCtx: ctx(), maxToolCalls: 8, timeoutMs: 5000, allowWrites: false, callModel });
    assert.equal(out.toolCalls[0].ok, false);
    assert.match(out.text, /DATA MISSING/);
    assert.match(out.text, /Imports → Ventes/);
    assert.deepEqual(unsourcedNumbers(out.text, out.toolResults), []);
  });
});

describe("outils ventes et contexte marketing", () => {
  test("get_sales_performance : N-1 « pas encore comparable » quand la fenêtre est vide, ventilations par SKU et canal", async () => {
    const d = deps();
    const r = ok(await executeTool("get_sales_performance", { brand: "Gamarde", period: "30d", breakdown: ["sku"] }, { ...ctx(), deps: { ...d, salesTotals: async (start, end, f) => (start < "2026-01-01" ? { amount: 0, quantity: 0, orders: 0, clients: 0, lines: 0 } : d.salesTotals(start, end, f)) } }));
    assert.equal(r.data.revenue_mad, 51_000);
    assert.equal(r.data.vs_n1, "pas encore comparable");
    const sku = r.data.by_sku as { name: string; growth_pct: number | string; share_pct: number }[];
    assert.equal(sku[0].name, "Crème A");
    assert.equal(sku[0].growth_pct, 36.4);
    assert.equal(sku[3].growth_pct, "nouveau");
  });
  test("get_marketing_context : campagnes actives, promotions, contenus, objectifs de la fiche marque, budget", async () => {
    const r = ok(await executeTool("get_marketing_context", { brand: "Gamarde" }, ctx()));
    const c = r.data.campaigns as { active: { name: string; products: string[] }[] };
    assert.equal(c.active[0].name, "Rentrée Gamarde");
    assert.deepEqual(c.active[0].products, ["Crème A"]);
    assert.equal((r.data.promotions as unknown[]).length, 1);
    assert.equal((r.data.editorial_calendar as { upcoming: unknown[] }).upcoming.length, 1);
    assert.equal(r.data.brand_marketing_objectives, "5 000 unités / mois");
    assert.equal((r.data.budget as { consumed_pct: number }).consumed_pct, 60);
    assert.equal(r.data.ads_30d, "aucune journée publicitaire close sur 30 jours");
  });
  test("get_top_skus par marge exige les coûts internes ; par croissance exclut les produits nouveaux", async () => {
    const ko = (await executeTool("get_top_skus", { brand: "Gamarde", metric: "margin" }, ctx({ seeInternalCosts: false, perms: (() => { const p = noPermissions(); p.ventes.view = true; p.stock.view = true; return p; })() }))) as Ko;
    assert.equal(ko.available, false);
    const r = ok(await executeTool("get_top_skus", { brand: "Gamarde", metric: "growth" }, ctx()));
    const names = (r.data.top as { product: string }[]).map((x) => x.product);
    assert.ok(!names.includes("Sans photo D"), "pas de période précédente : pas de croissance fabriquée");
    assert.equal(names[0], "Crème A");
  });
});
