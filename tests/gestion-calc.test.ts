/**
 * Gestion commerciale — montants des pièces (src/lib/gestion/calc.ts) et règles des pièces
 * (src/lib/gestion/documents-shared.ts).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { amountInWords, baseUnitPriceHt, computeDocument, computeLine, netUnitPriceHt, numberToWords } from "@/lib/gestion/calc";
import {
  allowedActions, blStatusAfterInvoicing, commercialIssues, defaultDiscount, dueDateOf, paginate, projectionRows, remainingQty, shouldProject, waPhone,
} from "@/lib/gestion/documents-shared";
import { fmtSage, globalDiscountAmount, pdfPages, pdfRows, type PdfLine } from "@/lib/gestion/pdf-model";
import { formatScaled } from "@/lib/gestion/money";

describe("calcul d'une pièce", () => {
  test("FA202600198 reproduite au centime (PU 165,83, remise 25 %, TVA 20 %)", () => {
    const l = { quantity: "6", unitPriceHt: "165.83", discountPct: "25", taxRate: "20" };
    const d = computeDocument([l, l]);
    assert.deepEqual(d.lines[0], { grossHt: "746.24", netHt: "746.24", vatAmount: "149.25", ttc: "895.49" });
    assert.equal(d.grossHt, "1492.48");
    assert.equal(d.netHt, "1492.48");
    assert.equal(d.vatTotal, "298.50");
    assert.equal(d.ttc, "1790.98");
    assert.equal(d.globalDiscountAmount, "0.00");
  });
  test("remises en cascade, pas en addition : 25 % puis 10 % = 32,5 %", () => {
    const l = computeLine({ quantity: "10", unitPriceHt: "100", discountPct: "25", taxRate: "20" }, "10");
    assert.equal(l.grossHt, "750.00");
    assert.equal(l.netHt, "675.00"); // 1000 × 0,75 × 0,90, pas 1000 × (1 − 0,35) = 650
  });
  test("remise globale : Total HT − remise = Net HT, colonnes cohérentes", () => {
    const d = computeDocument([
      { quantity: "3", unitPriceHt: "33.33", discountPct: "0", taxRate: "20" },
      { quantity: "1", unitPriceHt: "10.01", discountPct: "5", taxRate: "20" },
    ], "2.5");
    assert.equal(Number(d.grossHt) - Number(d.globalDiscountAmount), Number(d.netHt));
    assert.equal(d.lines.reduce((a, l) => a + Math.round(Number(l.netHt) * 100), 0), Math.round(Number(d.netHt) * 100));
  });
  test("TVA multi-taux : récapitulatif par taux, du plus fort au plus faible", () => {
    const d = computeDocument([
      { quantity: "1", unitPriceHt: "100", discountPct: "0", taxRate: "20" },
      { quantity: "2", unitPriceHt: "50", discountPct: "0", taxRate: "7" },
      { quantity: "1", unitPriceHt: "30", discountPct: "0", taxRate: "20" },
    ]);
    assert.deepEqual(d.vatBreakdown, [{ rate: "20.00", base: "130.00", vat: "26.00" }, { rate: "7.00", base: "100.00", vat: "7.00" }]);
    assert.equal(d.vatTotal, "33.00");
    assert.equal(d.ttc, "263.00");
  });
  test("arrondi par ligne puis somme (jamais sur le total)", () => {
    // 3 lignes de 0,335 HT → chaque TVA 20 % = 0,067 → 0,07 ; somme 0,21 (et non 0,20 sur le total)
    const l = { quantity: "1", unitPriceHt: "0.34", discountPct: "1.5", taxRate: "20" };
    const d = computeDocument([l, l, l]);
    assert.equal(d.lines[0].netHt, "0.33");
    assert.equal(d.vatTotal, (3 * Number(d.lines[0].vatAmount)).toFixed(2));
  });
  test("remise hors bornes refusée", () => {
    assert.throws(() => computeLine({ quantity: "1", unitPriceHt: "10", discountPct: "100", taxRate: "20" }));
    assert.throws(() => computeLine({ quantity: "1", unitPriceHt: "10", discountPct: "-1", taxRate: "20" }));
  });
  test("prix de base = PPH TTC ÷ (1 + TVA) ; prix net unitaire", () => {
    assert.equal(baseUnitPriceHt("199.00", "20"), "165.83");
    assert.equal(baseUnitPriceHt(null, "20"), null);
    assert.equal(netUnitPriceHt({ quantity: "6", unitPriceHt: "165.83", discountPct: "25", taxRate: "20" }), "124.37");
  });
});

describe("montant en lettres", () => {
  test("la facture Sage", () => {
    assert.equal(amountInWords("1790.98"), "mille sept cent quatre-vingt-dix MAD et quatre-vingt-dix-huit cents");
  });
  test("règles du français", () => {
    assert.equal(numberToWords(0), "zéro");
    assert.equal(numberToWords(21), "vingt et un");
    assert.equal(numberToWords(71), "soixante et onze");
    assert.equal(numberToWords(80), "quatre-vingts");
    assert.equal(numberToWords(81), "quatre-vingt-un");
    assert.equal(numberToWords(91), "quatre-vingt-onze");
    assert.equal(numberToWords(200), "deux cents");
    assert.equal(numberToWords(201), "deux cent un");
    assert.equal(numberToWords(1000), "mille");
    assert.equal(numberToWords(80000), "quatre-vingt mille");
    assert.equal(numberToWords(200000), "deux cent mille");
    assert.equal(numberToWords(1000000), "un million");
    assert.equal(numberToWords(2300450), "deux millions trois cent mille quatre cent cinquante");
  });
  test("montant rond sans centimes", () => {
    assert.equal(amountInWords("100.00", "dirhams", "centimes"), "cent dirhams");
  });
});

describe("règles des pièces", () => {
  test("actions selon type et statut", () => {
    assert.deepEqual(allowedActions("BL", "BROUILLON"), { edit: true, delete: true, validate: true, deliver: false, cancel: false, invoice: false, credit: false });
    assert.equal(allowedActions("BL", "VALIDE").invoice, true);
    assert.equal(allowedActions("BL", "VALIDE", { requireDelivered: true }).invoice, false);
    assert.equal(allowedActions("BL", "LIVRE", { anyInvoiced: true }).cancel, false);
    assert.equal(allowedActions("FACTURE", "VALIDE").credit, true);
    assert.equal(allowedActions("FACTURE", "VALIDE").cancel, false);
  });
  test("statut d'un BL après facturation", () => {
    assert.equal(blStatusAfterInvoicing("VALIDE", [{ quantity: "6", invoicedQty: "0" }]), "VALIDE");
    assert.equal(blStatusAfterInvoicing("VALIDE", [{ quantity: "6", invoicedQty: "6" }, { quantity: "2", invoicedQty: "1" }]), "FACTURE_PARTIEL");
    assert.equal(blStatusAfterInvoicing("LIVRE", [{ quantity: "6", invoicedQty: "6" }]), "FACTURE");
    assert.equal(remainingQty("6", "2.5"), "3.500");
    assert.equal(remainingQty("6", "7"), "0.000");
  });
  test("remise par défaut : marque, puis client, puis 0", () => {
    assert.equal(defaultDiscount("25.00", "30.00"), "30.00");
    assert.equal(defaultDiscount("25.00", null), "25.00");
    assert.equal(defaultDiscount(null, null), "0");
  });
  test("blocages commerciaux", () => {
    const base = { clientBlocked: false, blockedReason: null, creditLimit: null, outstanding: "0", documentTtc: "1000", tolerancePct: 0, globalDiscountPct: "0", lines: [] as never[] };
    assert.deepEqual(commercialIssues(base), []);
    assert.equal(commercialIssues({ ...base, clientBlocked: true, blockedReason: "impayé" })[0].code, "CLIENT_BLOQUE");
    const line = { designation: "BEAUTY BOOST", discountPct: "30", allowedDiscountPct: "25", netUnitHt: "116.08", cmup: "124.375" };
    const codes = commercialIssues({ ...base, lines: [line] }).map((i) => i.code);
    assert.deepEqual(codes, ["REMISE", "VENTE_A_PERTE"]);
    assert.deepEqual(commercialIssues({ ...base, tolerancePct: 5, lines: [{ ...line, cmup: null }] }), []);
    // La remise globale compte : 25 % puis 10 % = 32,5 % effectifs.
    assert.equal(commercialIssues({ ...base, globalDiscountPct: "10", lines: [{ ...line, discountPct: "25", cmup: null }] })[0].code, "REMISE");
    assert.equal(commercialIssues({ ...base, creditLimit: "5000", outstanding: "4500.01" })[0].code, "ENCOURS");
    assert.deepEqual(commercialIssues({ ...base, creditLimit: "5000", outstanding: "4000" }), []);
  });
  test("échéance plafonnée", () => {
    assert.deepEqual(dueDateOf("2026-07-13", 60, 60, 120), { days: 60, dueDate: "2026-09-11" });
    assert.deepEqual(dueDateOf("2026-07-13", null, 30, 120), { days: 30, dueDate: "2026-08-12" });
    assert.deepEqual(dueDateOf("2026-07-13", 180, 60, 120).days, 120);
  });
});

describe("projection vers les ventes", () => {
  const c = { mode: "ACTIF" as const, date: "2027-01-01", sites: ["COMANET", "DESK DIGITAL"] };
  test("seulement en mode ACTIF, hors simulation, après la bascule, sur un site qui bascule", () => {
    assert.equal(shouldProject(c, { isSimulation: false, date: "2027-01-05", site: "COMANET" }), true);
    assert.equal(shouldProject({ ...c, mode: "PARALLELE" }, { isSimulation: false, date: "2027-01-05", site: "COMANET" }), false);
    assert.equal(shouldProject(c, { isSimulation: true, date: "2027-01-05", site: "COMANET" }), false);
    assert.equal(shouldProject(c, { isSimulation: false, date: "2026-12-31", site: "COMANET" }), false);
    assert.equal(shouldProject(c, { isSimulation: false, date: "2027-01-05", site: "COS" }), false);
  });
  test("un BL donne des ventes positives, un avoir négatives ; pas de service", () => {
    const doc = { type: "BL" as const, number: "BL202700001", date: "2027-01-05", clientId: "c", site: "comanet", salesRepName: "Saliha", legalName: "OHPHARMA" };
    const lines = [
      { id: "l1", productId: "p1", designation: "BEAUTY BOOST", quantity: "6", freeQuantity: "1", netHt: "746.24" },
      { id: "l2", productId: null, designation: "Prestation", quantity: "1", freeQuantity: "0", netHt: "100" },
    ];
    const r = projectionRows(doc, lines);
    assert.equal(r.length, 1);
    assert.equal(r[0].quantity, "6.00");
    assert.equal(r[0].amount, "746.24");
    assert.equal(r[0].unitPrice, "124.3733");
    assert.equal(r[0].freeQuantity, "1.000");
    assert.equal(r[0].site, "COMANET");
    assert.equal(r[0].lineHash, "COS:l1");
    const av = projectionRows({ ...doc, type: "AVOIR", number: "AV202700001" }, [lines[0]]);
    assert.equal(av[0].quantity, "-6.00");
    assert.equal(av[0].amount, "-746.24");
  });
});

describe("pagination des PDF", () => {
  test("une page quand tout tient avec les totaux", () => {
    assert.deepEqual(paginate(2), [{ from: 0, to: 2 }]);
    assert.deepEqual(paginate(18), [{ from: 0, to: 18 }]);
  });
  test("la dernière page garde toujours la place des totaux", () => {
    const p = paginate(20);
    assert.deepEqual(p, [{ from: 0, to: 19 }, { from: 19, to: 20 }]);
    const big = paginate(75);
    assert.equal(big[big.length - 1].to, 75);
    assert.ok(big[big.length - 1].to - big[big.length - 1].from <= 18);
    for (let i = 1; i < big.length; i++) assert.equal(big[i].from, big[i - 1].to);
  });
});

describe("PDF — formats Sage, lignes imprimées, reports", () => {
  test("montants au format Sage : point des milliers, virgule décimale", () => {
    assert.equal(fmtSage("1790.98"), "1.790,98");
    assert.equal(fmtSage("165.83"), "165,83");
    assert.equal(fmtSage("-1234567.5"), "-1.234.567,50");
    assert.equal(fmtSage("3.000", 3), "3,000");
    assert.equal(fmtSage(null), "");
  });
  const line = (over: Partial<PdfLine> = {}): PdfLine => ({
    ref: "A1", designation: "Crème", quantity: "3.000", freeQuantity: "0.000", unitPriceHt: "165.83", publicPriceTtc: "199.00", discountPct: "10.00", grossHt: "447.74", taxRate: "20.00",
    netHt: "447.74", vatAmount: "89.55", ttc: "537.29", sourceNumber: null, sourceDate: null, lotAllocations: [], ...over,
  });
  test("facture regroupée : un en-tête par BL ; les UG ne s'impriment jamais sur une facture ni un avoir", () => {
    const rows = pdfRows("FACTURE", [
      line({ sourceNumber: "BL202600001", sourceDate: "2026-09-01", freeQuantity: "1.000" }),
      line({ sourceNumber: "BL202600001", sourceDate: "2026-09-01" }),
      line({ sourceNumber: "BL202600002", sourceDate: "2026-09-03" }),
    ]);
    assert.deepEqual(rows.map((r) => r.kind), ["group", "line", "line", "group", "line"]);
    assert.equal((rows[1] as { free: string }).free, "");
    const avoir = pdfRows("AVOIR", [line({ freeQuantity: "3.000" })]);
    assert.deepEqual(avoir.map((r) => r.kind), ["line"]);
    assert.equal((avoir[0] as { free: string }).free, "");
    assert.equal((pdfRows("BL", [line({ freeQuantity: "2.000" })])[0] as { free: string }).free, "2,00");
    assert.equal((pdfRows("BL", [line()])[0] as { unitPriceTtc: string }).unitPriceTtc, "199,00"); // 165,83 × 1,20 = 198,996
    assert.equal((rows[0] as { label: string }).label, "BL n° BL202600001 du 01/09/2026");
    const l = rows[1] as { netUnit: string };
    assert.equal(l.netUnit, "149,25"); // 447,74 ÷ 3
  });
  test("reports : le « à reporter » d'une page est le « report » de la suivante, et la somme est exacte", () => {
    const lines = Array.from({ length: 60 }, () => line());
    const pages = pdfPages(pdfRows("BL", lines));
    assert.ok(pages.length >= 3);
    for (let i = 0; i < pages.length - 1; i++) assert.deepEqual(pages[i].toCarry, pages[i + 1].report);
    assert.equal(pages[0].report, null);
    assert.equal(pages.at(-1)!.toCarry, null);
    assert.equal(pages.reduce((a, p) => a + p.rows.length, 0), 60);
    const carried = BigInt(pages.slice(0, -1).reduce((a, p) => a + p.rows.length, 0));
    assert.equal(pages.at(-2)!.toCarry!.ht, fmtSage(formatScaled(44774n * carried, 2)));
  });
  test("remise globale du pied = Total HT − Net HT", () => {
    assert.equal(globalDiscountAmount("1000.00", "950.00"), "50,00");
  });
});

describe("Envoi WhatsApp", () => {
  test("numéros marocains au format international", () => {
    assert.equal(waPhone("06 61 23 45 67"), "212661234567");
    assert.equal(waPhone("+212 661-234567"), "212661234567");
    assert.equal(waPhone("00212661234567"), "212661234567");
    assert.equal(waPhone("12"), null);
    assert.equal(waPhone(null), null);
  });
});

describe("libellés des blocages", () => {
  test("vente à perte et encours : montants au centime, virgule décimale", () => {
    const issues = commercialIssues({
      clientBlocked: false, blockedReason: null, creditLimit: "1000.00", outstanding: "900.00", documentTtc: "149.24", tolerancePct: 0, globalDiscountPct: "0",
      lines: [{ designation: "Crème", discountPct: "25", allowedDiscountPct: "25", netUnitHt: "124.37", cmup: "126.2500" }],
    });
    assert.deepEqual(issues.map((i) => i.label), [
      "Crème : prix net 124,37 MAD sous le coût de revient (126,25 MAD).",
      "Encours après cette pièce : 1049,24 MAD, au-delà du plafond de 1000,00 MAD.",
    ]);
  });
});
