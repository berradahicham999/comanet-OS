import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildPnl, chargeMonths, classifySite, firstOfMonth, previousMonth, type PnlInput } from "@/lib/pnl-shared";
import { DEFAULT_PNL } from "@/lib/settings";

const cats = [
  { key: "SALAIRES", label: "Salaires", grp: "PERSONNEL" as const, sort: 10 },
  { key: "LOYER", label: "Loyer", grp: "STRUCTURE" as const, sort: 10 },
  { key: "REMISES_OPERATIONS", label: "Remises", grp: "COMMERCIAL" as const, sort: 10 },
  { key: "IMPOT_SOCIETES", label: "IS", grp: "IMPOTS" as const, sort: 10 },
];
const base = (over: Partial<PnlInput> = {}): PnlInput => ({
  year: 2026, lastMonth: 3, rules: DEFAULT_PNL, sales: [], bulk: [], charges: [], categories: cats, marketing: [],
  brands: [{ id: "G", name: "Gamarde", color: "#0a0" }, { id: "A", name: "Auracos", color: "#a00" }, { id: "C", name: "CygneLab", color: "#00a" }],
  ...over,
});
const line = (s: ReturnType<typeof buildPnl>, key: string) => s.lines.find((l) => l.key === key)!;

describe("P&L — nature des sites", () => {
  test("direct, prestation, distributeur, inconnu", () => {
    assert.equal(classifySite("comanet ", DEFAULT_PNL).kind, "DIRECT");
    assert.equal(classifySite("DESK DIGITAL", DEFAULT_PNL).kind, "DIRECT");
    const p = classifySite("PHARMAFIRST", DEFAULT_PNL);
    assert.equal(p.kind, "PRESTATION");
    assert.equal(p.kind === "PRESTATION" && p.ratePct, 35);
    assert.equal(classifySite("CAS", DEFAULT_PNL).kind, "DISTRIBUTEUR");
    assert.equal(classifySite("XYZ", DEFAULT_PNL).kind, "INCONNU");
  });
});

describe("P&L — charges récurrentes", () => {
  test("mensuelle ouverte, bornée, ponctuelle", () => {
    assert.deepEqual(chargeMonths({ recurrence: "MENSUELLE", startMonth: "2025-06-01", endMonth: null }, 2026), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert.deepEqual(chargeMonths({ recurrence: "MENSUELLE", startMonth: "2026-03-01", endMonth: "2026-05-01" }, 2026), [3, 4, 5]);
    assert.deepEqual(chargeMonths({ recurrence: "MENSUELLE", startMonth: "2027-01-01", endMonth: null }, 2026), []);
    assert.deepEqual(chargeMonths({ recurrence: "PONCTUELLE", startMonth: "2026-07-01", endMonth: null }, 2026), [7]);
    assert.deepEqual(chargeMonths({ recurrence: "PONCTUELLE", startMonth: "2025-07-01", endMonth: null }, 2026), []);
  });
  test("mois utilitaires", () => {
    assert.equal(firstOfMonth("2026-09"), "2026-09-01");
    assert.equal(firstOfMonth("2026-13"), null);
    assert.equal(previousMonth("2026-01-01"), "2025-12-01");
  });
});

describe("P&L — compte de résultat", () => {
  const input = base({
    sales: [
      { month: 1, brandId: "C", site: "COMANET", amount: 10000, cogs: 4000, missingCostAmount: 0 },
      { month: 2, brandId: "C", site: "COMANET", amount: 5000, cogs: 0, missingCostAmount: 5000 },
      { month: 1, brandId: "A", site: "PHARMAFIRST", amount: 100000, cogs: 0, missingCostAmount: 0 },
      { month: 1, brandId: "G", site: "COS", amount: 50000, cogs: 0, missingCostAmount: 0 },
      { month: 1, brandId: "G", site: "ZZZ", amount: 700, cogs: 0, missingCostAmount: 0 },
      { month: 5, brandId: "C", site: "COMANET", amount: 99999, cogs: 0, missingCostAmount: 0 }, // après le dernier mois : ignoré
    ],
    bulk: [{ month: 2, brandId: "G", amount: 60000, cost: 30000 }, { month: 3, brandId: "G", amount: 1000, cost: null }],
    marketing: [{ month: 1, brandId: "G", consumed: 8000 }, { month: 3, brandId: "A", consumed: 2000 }],
    charges: [
      { id: "1", categoryKey: "SALAIRES", amount: 20000, recurrence: "MENSUELLE", startMonth: "2026-01-01", endMonth: null, brandId: null },
      { id: "2", categoryKey: "LOYER", amount: 5000, recurrence: "MENSUELLE", startMonth: "2026-02-01", endMonth: null, brandId: null },
      { id: "3", categoryKey: "REMISES_OPERATIONS", amount: 3000, recurrence: "PONCTUELLE", startMonth: "2026-01-01", endMonth: null, brandId: "A" },
      { id: "4", categoryKey: "IMPOT_SOCIETES", amount: 1000, recurrence: "PONCTUELLE", startMonth: "2026-03-01", endMonth: null, brandId: null },
    ],
  });
  const s = buildPnl(input);

  test("CA = direct + bloc + commission, revente distributeur exclue", () => {
    assert.equal(line(s, "ca_direct").total, 15000);
    assert.equal(line(s, "ca_bulk").total, 61000);
    assert.equal(line(s, "ca_presta_PHARMAFIRST").total, 35000);
    assert.equal(line(s, "ca").total, 111000);
    assert.equal(line(s, "revente_distributeur").total, 50000);
    assert.deepEqual(line(s, "ca").months.slice(0, 4), [45000, 65000, 1000, 0]);
  });
  test("coût des ventes et marge brute ; coûts manquants signalés, jamais estimés", () => {
    assert.equal(line(s, "cogs").total, 34000);
    assert.equal(line(s, "marge_brute").total, 77000);
    assert.equal(s.quality.bulkWithoutCost, 1000);
    assert.deepEqual(s.quality.missingCost, [{ brandId: "C", amount: 5000 }]);
    assert.deepEqual(s.quality.unknownSites, [{ site: "ZZZ", amount: 700 }]);
  });
  test("soldes en cascade", () => {
    assert.equal(line(s, "marketing").total, 10000);
    assert.equal(line(s, "contribution").total, 77000 - 10000 - 3000);
    assert.equal(line(s, "grp_PERSONNEL").total, 60000);
    assert.equal(line(s, "grp_STRUCTURE").total, 10000);
    assert.equal(line(s, "resultat_exploitation").total, 64000 - 70000);
    assert.equal(line(s, "resultat_net").total, -6000 - 1000);
    assert.equal(s.kpis.netResult, -7000);
  });
  test("point mort sur charges fixes récurrentes du dernier mois", () => {
    assert.equal(s.kpis.monthlyFixed, 25000);
    const pct = (64000 / 111000) * 100;
    assert.ok(Math.abs((s.kpis.breakEvenMonthly ?? 0) - 25000 / (pct / 100)) < 1e-6);
  });
  test("contribution par marque", () => {
    const g = s.brands.find((b) => b.brandId === "G")!;
    assert.equal(g.revenue, 61000);
    assert.equal(g.cogs, 30000);
    assert.equal(g.contribution, 61000 - 30000 - 8000);
    const a = s.brands.find((b) => b.brandId === "A")!;
    assert.equal(a.commission, 35000);
    assert.equal(a.contribution, 35000 - 2000 - 3000);
  });
  test("filtre marque : frais communs exclus", () => {
    const f = buildPnl({ ...input, brandId: "A" });
    assert.equal(line(f, "ca").total, 35000);
    assert.equal(line(f, "grp_PERSONNEL").total, 0);
    assert.equal(line(f, "resultat_net").total, 35000 - 2000 - 3000);
  });
  test("mois sans charges repérés", () => {
    const f = buildPnl({ ...input, charges: [] });
    assert.deepEqual(f.quality.monthsWithoutCharges, [1, 2, 3]);
  });
});
