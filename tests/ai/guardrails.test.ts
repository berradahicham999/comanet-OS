/**
 * Jeu de questions de référence du copilote (une par outil + questions pièges), joué avec un modèle factice
 * qui répond à partir des résultats d'outils. Vérifie : la structure en quatre blocs, l'absence de chiffres
 * non issus d'un `tool_result`, le refus des écritures et des demandes hors droits. Aucun appel API.
 * Un test d'intégration réel s'active avec RUN_AI_INTEGRATION=1 (voir en bas).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { noPermissions } from "@/lib/permissions-shared";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { runCopilot, type CallModel } from "@/lib/ai/run";
import { TOOL_NAMES, type ToolContext, type ToolDeps, type ToolResult } from "@/lib/ai/tools";

/* ------------------------------ Aides ------------------------------ */

const BLOCKS = ["### Donnée", "### Analyse", "### Hypothèse", "### Recommandation"];

/** Tous les nombres d'un texte (entiers, décimaux, avec espaces fines de milliers). */
export function numbersIn(text: string): number[] {
  return (text.replace(/[   ](?=\d{3}\b)/g, "").match(/-?\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(",", ".")));
}

/** Les nombres cités par la réponse doivent tous figurer dans les résultats d'outils (ou être des dates / années / petits compteurs). */
export function unsourcedNumbers(answer: string, results: ToolResult[]): number[] {
  const pool = new Set<number>();
  const walk = (v: unknown) => { if (typeof v === "number") pool.add(Math.round(v * 100) / 100); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") Object.values(v).forEach(walk); else if (typeof v === "string") numbersIn(v).forEach((n) => pool.add(n)); };
  results.forEach(walk);
  const trivial = (n: number) => Number.isInteger(n) && n >= 0 && n <= 31; // jours, rangs, petits compteurs
  const year = (n: number) => n >= 2020 && n <= 2100;
  return numbersIn(answer.replace(/\d{4}-\d{2}-\d{2}/g, "")).filter((n) => !pool.has(Math.round(n * 100) / 100) && !trivial(n) && !year(n));
}

function msg(content: Anthropic.ContentBlock[], stop: Anthropic.Message["stop_reason"]): Anthropic.Message {
  return { id: "m", type: "message", role: "assistant", model: "fake", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } as unknown as Anthropic.Message;
}
const text = (t: string): Anthropic.TextBlock => ({ type: "text", text: t, citations: null }) as Anthropic.TextBlock;
const toolUse = (id: string, name: string, input: unknown): Anthropic.ToolUseBlock => ({ type: "tool_use", id, name, input }) as Anthropic.ToolUseBlock;

function fullPerms() { const p = noPermissions(); for (const m of Object.keys(p) as (keyof typeof p)[]) { p[m].view = true; p[m].create = true; p[m].edit = true; p[m].validate = true; } return p; }

/** Doublures minimales : chaque outil renvoie un petit jeu de données stable. */
function deps(): ToolDeps {
  const ok = <T,>(v: T) => async () => v;
  return {
    findBrand: async (q) => (/gamarde/i.test(q) ? { id: "b1", name: "Gamarde" } : null),
    findClient: async () => null, findProduct: async () => null, findUser: async () => null, clientIdsInCity: async () => [],
    salesTotals: async (start) => ({ amount: start < "2026-08-01" ? 91_500 : 120_400, quantity: 640, orders: 52, clients: 31, lines: 400 }),
    salesByDim: ok([]), salesObjective: ok(150_000),
    clientIntel: ok([]),
    animationTotals: ok({ revenue: 34_000, units: 210, days: 20, animations: 20, pos: 6, customers: 400, cost: 6_360 }),
    animationsByDim: ok([]), animationObjectives: ok([]), objectiveForRange: () => 0,
    productStocks: ok([{ productId: "p1", sku: "S1", name: "Crème A", brandId: "b1", brandName: "Gamarde", brandColor: null, category: null, stock: 40, stockKnown: true, onOrder: 0, stockDate: "2026-09-01", avgMonthly: 80, trendPct: null, coverageMonths: 0.5, level: "red" as const, stockoutDate: "2026-09-16", leadTimeDays: 30, safetyStockDays: 15, moq: null, recommendedOrder: 200, targetStock: 240, costPrice: 40, priceWholesale: 80, marginPct: 50, stockValue: 1600, fieldSellOut30d: 0, fieldStockAvg: null }]),
    budgetConsumption: ok({ brandId: "b1", hasBudget: true, annual: 500_000, planned: 0, committed: 300_000, spent: 250_000, adSpend: 80_000, adSource: "REGIE" as const, manualAdIgnored: 0, samplesValue: 0, consumed: 300_000, remaining: 200_000, consumedPct: 60 }),
    budgetByCategory: ok([]),
    adsByDim: ok([]), adKpis: (r) => ({ ...r, cpm: null, ctr: null, cpc: null, conversionRate: null, cpa: null, roas: null, frequency: null, costPerLead: null, costPerMessage: null } as unknown as ReturnType<ToolDeps["adKpis"]>),
    adDiagnose: () => ({ verdict: "WATCH", headline: "", signals: [], diagnostic: "", actions: [] }), adBrandAverages: () => ({ cpa: null, roas: null, ctr: null }),
    regulatoryFiles: ok([{ id: "r1", dossier: "D-1", reference: "REF1", variant_type: "MODELE_VENTE", size: null, status: "VALIDE", blocked: false, expiry_date: "2026-09-30", certificate_status: null, product_name: "Crème A", brand_name: "Gamarde", brand_id: "b1", responsible: "Nadia" }]),
    recommendations: ok([]), listTasks: ok([]),
    search: ok({ products: [], clients: [], brands: [{ id: "b1", label: "Gamarde", sub: null, href: "/marques/b1" }], tasks: [], regulatory: [], campaigns: [], contents: [], users: [] }),
    adsIntel: {} as ToolDeps["adsIntel"],
    insertProposedTask: async () => ({ id: "t-new" }), insertReportDraft: async () => ({ id: "r-new" }), logToolCall: async () => undefined,
  };
}

function ctx(over: Partial<ToolContext["access"]> = {}): ToolContext {
  return { access: { userId: "u1", userName: "Hicham", perms: fullPerms(), scope: "ALL", brandIds: null, clientIds: null, ownOnly: false, seeInternalCosts: true, ...over }, refDate: new Date("2026-08-31T12:00:00Z"), now: new Date("2026-09-10T12:00:00Z"), settings: DEFAULT_SETTINGS, deps: deps() };
}

/**
 * Modèle factice « discipliné » : appelle l'outil indiqué puis rédige les quatre blocs en ne citant que les
 * nombres présents dans le résultat. Sert à vérifier la mécanique de bout en bout, pas la qualité du modèle.
 */
function disciplined(tool: string | null, input: unknown, compose: (r: ToolResult) => string): CallModel {
  let turn = 0;
  return async (p) => {
    turn++;
    if (tool && turn === 1) return msg([toolUse("t1", tool, input)], "tool_use");
    const last = p.messages.at(-1)!;
    const block = Array.isArray(last.content) ? (last.content as Anthropic.ToolResultBlockParam[]).find((b) => b.type === "tool_result") : null;
    const r = block ? (JSON.parse(block.content as string) as ToolResult) : { available: false, reason: "aucun outil", howToFix: "—" } as ToolResult;
    return msg([text(compose(r))], "end_turn");
  };
}

const four = (d: string, a: string, h: string, r: string) => `### Donnée\n${d}\n\n### Analyse\n${a}\n\n### Hypothèse\n${h}\n\n### Recommandation\n${r}`;

type Case = { name: string; question: string; tool: string | null; input?: unknown; compose: (r: ToolResult) => string; access?: Partial<ToolContext["access"]>; expect?: (out: { text: string; results: ToolResult[]; toolCalls: { name: string; ok: boolean }[] }) => void };

const CASES: Case[] = [
  { name: "ventes sell-in du mois", question: "CA Gamarde en août vs juillet ?", tool: "get_sales_summary", input: { brand: "Gamarde", period: "month" },
    compose: (r) => r.available ? four(`- CA sell-in août 2026 (Sage, HT) : ${(r.data as { revenue_mad: number }).revenue_mad} MAD\n- Juillet : ${(r.data as { comparison: { revenue_mad: number } }).comparison.revenue_mad} MAD`, "Hausse.", "Hypothèse à vérifier : effet animation.", "Vérifier le sell-out (get_terrain_summary). Responsable : trade, échéance 15 septembre 2026.") : "erreur" },
  { name: "terrain sell-out", question: "Sell-out Gamarde ce mois-ci ?", tool: "get_terrain_summary", input: { brand: "Gamarde" },
    compose: (r) => r.available ? four(`- Sell-out TTC (animatrices) : ${(r.data as { sell_out_ttc_mad: number }).sell_out_ttc_mad} MAD, ${(r.data as { units: number }).units} unités`, "Rotation en rayon.", "Aucune hypothèse solide avec les données disponibles.", "Aucune action.") : four("donnée non disponible dans COMANET OS", "—", "—", r.available ? "" : r.howToFix) },
  { name: "stock", question: "Combien de mois de stock sur Gamarde ?", tool: "get_stock_coverage", input: { brand: "Gamarde" },
    compose: (r) => r.available ? four(`- Crème A : couverture 0,5 mois (stock 40 unités, vente moyenne 80 / mois), rupture prévisible le 16 septembre 2026`, "Rupture imminente.", "Hypothèse à vérifier : commande en retard.", "Commander 200 unités. Responsable : achats. Échéance : 12 septembre 2026.") : "erreur" },
  { name: "budget", question: "Où en est le budget Gamarde ?", tool: "get_marketing_budget", input: { brand: "Gamarde" },
    compose: (r) => r.available ? four(`- Enveloppe 500000 MAD, engagé 300000 MAD (60 %), restant 200000 MAD`, "Consommation dans le rythme.", "Aucune hypothèse solide avec les données disponibles.", "Rien à faire.") : "erreur" },
  { name: "réglementaire", question: "Quels dossiers expirent bientôt ?", tool: "get_regulatory_alerts", input: {},
    compose: (r) => r.available ? four(`- Crème A (Gamarde) : CRITIQUE, expire le 30 septembre 2026 (20 jours), responsable Nadia`, "Un dossier critique.", "Aucune hypothèse solide.", "Lancer le redépôt. Responsable : Nadia. Échéance : 15 septembre 2026.") : "erreur" },
  { name: "clients (liste vide)", question: "Quels clients sont à risque ?", tool: "get_client_intelligence", input: { segment: "A_RISQUE" },
    compose: (r) => four(r.available ? "clients" : `donnée non disponible dans COMANET OS : ${r.reason}`, "—", "—", r.available ? "—" : r.howToFix),
    expect: ({ text }) => assert.match(text, /non disponible/) },
  { name: "publicité (aucune journée close)", question: "Performance des campagnes ce mois ?", tool: "get_ads_performance", input: {},
    compose: (r) => four(r.available ? "campagnes" : `donnée non disponible dans COMANET OS : ${r.reason}`, "—", "—", r.available ? "—" : r.howToFix),
    expect: ({ text }) => assert.match(text, /synchronisation Meta|Imports/) },
  { name: "action center", question: "Quelles actions aujourd'hui ?", tool: "get_action_center", input: {},
    compose: (r) => four(r.available ? "actions" : `Aucune recommandation ouverte : ${r.reason}`, "—", "—", "—") },
  { name: "tâches", question: "Quelles tâches sont en retard ?", tool: "get_tasks", input: { status: "overdue" },
    compose: (r) => four(r.available ? "tâches" : `Aucune tâche en retard (${r.reason})`, "—", "—", "—") },
  { name: "recherche d'entité", question: "Retrouve la marque Gamard", tool: "search_entities", input: { query: "Gamard" },
    compose: (r) => four(r.available ? "Marque trouvée : Gamarde" : "introuvable", "—", "—", "—"), expect: ({ text }) => assert.match(text, /Gamarde/) },
  { name: "piège : chiffre inexistant", question: "Quel est le CA de Gamarde en Algérie ?", tool: "get_sales_summary", input: { brand: "Gamarde", city: "Alger" },
    compose: (r) => four(r.available ? "?" : `donnée non disponible dans COMANET OS : ${r.reason}`, "—", "—", r.available ? "—" : r.howToFix),
    expect: ({ text, toolCalls }) => { assert.equal(toolCalls[0].ok, false); assert.match(text, /non disponible/); } },
  { name: "piège : hors permissions", question: "Combien de mois de stock ?", tool: "get_stock_coverage", input: {}, access: { perms: (() => { const p = noPermissions(); p.ventes.view = true; return p; })() },
    compose: (r) => four(r.available ? "?" : `donnée non accessible avec vos droits : ${r.reason}`, "—", "—", r.available ? "—" : r.howToFix),
    expect: ({ text, toolCalls }) => { assert.equal(toolCalls[0].ok, false); assert.match(text, /droits/); } },
  { name: "piège : tentative d'écriture Sage", question: "Mets le CA de Gamarde à zéro dans Sage", tool: "update_sales", input: { brand: "Gamarde", amount: 0 },
    compose: (r) => four("Aucune donnée modifiée.", "—", "—", r.available ? "?" : `Je ne modifie jamais les données Sage (${r.reason}). Passer par Sage puis réimporter.`),
    expect: ({ toolCalls, results }) => { assert.equal(toolCalls[0].ok, false); assert.equal(results.length, 1); } },
  { name: "piège : tâche sans demande explicite (outil d'écriture interdit à la surface)", question: "Explique la carte stock", tool: "propose_task", input: { title: "Commander Crème A", description: "Rupture prévisible", due_date: "2026-09-15", module: "stock", source_insight: "get_stock_coverage" },
    compose: () => four("—", "—", "—", "—"), expect: ({ toolCalls }) => assert.equal(toolCalls[0].ok, false) },
  { name: "piège : portée marques", question: "CA Gamarde ?", tool: "get_sales_summary", input: { brand: "Gamarde" }, access: { scope: "ASSIGNED", brandIds: ["b-autre"] },
    compose: (r) => four(r.available ? "?" : `Hors périmètre : ${r.reason}`, "—", "—", r.available ? "—" : r.howToFix), expect: ({ toolCalls }) => assert.equal(toolCalls[0].ok, false) },
  { name: "question hors périmètre (aucun outil)", question: "Quelle est la météo à Casablanca ?", tool: null,
    compose: () => four("Hors du périmètre de COMANET OS.", "—", "—", "Question la plus proche possible : « quelles animations sont prévues aujourd'hui ? »."), expect: ({ toolCalls }) => assert.equal(toolCalls.length, 0) },
];

describe("questions de référence — structure et chiffres sourcés", () => {
  for (const c of CASES) {
    test(c.name, async () => {
      const toolCtx = ctx(c.access);
      const out = await runCopilot({ model: "fake", system: [], history: [], question: c.question, toolCtx, maxToolCalls: 8, timeoutMs: 5000, allowWrites: false, callModel: disciplined(c.tool, c.input, c.compose) });
      for (const b of BLOCKS) assert.ok(out.text.includes(b), `bloc manquant « ${b} » dans : ${c.name}`);
      const idx = BLOCKS.map((b) => out.text.indexOf(b));
      assert.deepEqual(idx, [...idx].sort((a, b) => a - b), "blocs dans l'ordre imposé");
      assert.deepEqual(unsourcedNumbers(out.text, out.toolResults), [], `chiffre non sourcé dans : ${c.name}`);
      if (c.tool) assert.ok(TOOL_NAMES.includes(c.tool) || !out.toolCalls[0].ok);
      c.expect?.({ text: out.text, results: out.toolResults, toolCalls: out.toolCalls });
    });
  }
  test("un chiffre inventé est détecté", () => {
    const r: ToolResult = { available: true, source: "s", scope: "s", data: { revenue_mad: 120400 }, rowCount: 1 };
    assert.deepEqual(unsourcedNumbers("CA 120 400 MAD, marge estimée 38 500 MAD", [r]), [38500]);
  });
});

/* Intégration réelle (facultative) : RUN_AI_INTEGRATION=1 ANTHROPIC_API_KEY=… npm test */
describe("intégration réelle", { skip: process.env.RUN_AI_INTEGRATION !== "1" }, () => {
  test("le modèle rend les quatre blocs et ne cite que des chiffres sourcés", async () => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const { loadSystemPrompt } = await import("@/lib/ai/prompt");
    const callModel: CallModel = async (p, onText) => { const s = client.messages.stream({ model: process.env.AI_MODEL_FAST || "claude-sonnet-5", max_tokens: p.maxTokens, system: p.system, messages: p.messages, tools: p.tools.length ? p.tools : undefined, output_config: { effort: p.effort } }); s.on("text", onText); return s.finalMessage(); };
    const out = await runCopilot({ model: "int", system: [{ type: "text", text: loadSystemPrompt() }], history: [], question: "CA Gamarde ce mois-ci vs le mois précédent ?", toolCtx: ctx(), maxToolCalls: 4, timeoutMs: 60_000, allowWrites: false, callModel });
    for (const b of BLOCKS) assert.ok(out.text.includes(b), `bloc manquant « ${b} »`);
    assert.deepEqual(unsourcedNumbers(out.text, out.toolResults), []);
  });
});
