/**
 * Test d'intégration — ventes en bloc depuis les pièces, sorties marketing par BL, P&L réel (migration 0052), sur une
 * VRAIE base Postgres jetable (hors `npm test`). Écrit dans des journaux en écriture seule : jamais sur la production.
 *
 *   GESTION_IT=1 DATABASE_URL=postgresql://…/base_jetable node --conditions=react-server --import tsx scripts/sorties-marketing-integration.ts
 *
 * Couvre : contrainte « produit OU matériel » ; BL « échantillons digital » avec un produit et un goodie (stock produit et
 * stock matériel diminuent, aucune vente, une seule charge d'échantillon au coût figé) ; coût à 0 signalé ; annulation
 * (stocks rétablis, charge retirée) ; goodie offert à un vrai client (tracé, sans charge) ; ventes en bloc = factures −
 * avoirs réels (simulation exclue sauf à partir de `bulkSales.simulationFrom`, `pnl_bulk_sales` ignorée, aucune vente projetée) ; reprise Sage idempotente ;
 * ventilation du marketing réel ; exclusion des clients non commerciaux des analyses.
 */
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

const url = process.env.DATABASE_URL ?? "";
if (process.env.GESTION_IT !== "1" || /supabase|pooler/i.test(url)) {
  console.error("Refusé : ce test écrit dans des journaux non effaçables. Lancez-le sur une base jetable avec GESTION_IT=1.");
  process.exit(1);
}

async function main() {
  const { db } = await import("@/db");
  const D = await import("@/lib/gestion/documents");
  const { recordStockMovements, stockState } = await import("@/lib/gestion/ledger");
  const { recordMovement } = await import("@/lib/activations/inventory");
  const { setClientInternal } = await import("@/lib/gestion/clients");
  const { getSettings, saveSettings } = await import("@/lib/settings");
  const { pnlStatement, pnlLineSources } = await import("@/lib/pnl");
  const { budgetConsumptionByMonth } = await import("@/lib/budget");
  const { totals, nonCommercialClientIds } = await import("@/lib/analytics");
  const { clientIntel } = await import("@/lib/clients");
  const { iso, today } = await import("@/lib/format");
  const one = async <T,>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows[0] as T;
  const refused = async (label: string, f: () => Promise<unknown>, re: RegExp) => {
    await assert.rejects(f, (e: { message?: string; cause?: { message?: string } }) => re.test(`${e.message} ${e.cause?.message ?? ""}`), label);
    console.log("✓ refusé :", label);
  };

  const tag = Date.now().toString(36).toUpperCase();
  const u = await one<{ id: string; name: string }>(sql`select id, name from users order by created_at limit 1`);
  const who = { id: u.id, name: u.name };
  const day = iso(today());
  const year = Number(day.slice(0, 4)), month = Number(day.slice(5, 7));
  const brand = await one<{ id: string }>(sql`select id from brands where merged_into_id is null order by name limit 1`);
  const nature = async (key: string) => one<{ key: string }>(sql`select key from marketing_output_natures where key = ${key}`);
  assert.ok(await nature("DIGITAL"), "Natures livrées par la migration 0052");

  // Référentiel de test : un produit coûté (40 MAD), un produit sans coût, un goodie (15 MAD), un goodie à coût 0.
  const p = await one<{ id: string }>(sql`insert into products (name, name_key, code, brand_id, cost_price, price_retail, tax_rate_key) values (${"SORTIE " + tag}, ${"SORTIE " + tag}, ${"SO" + tag}, ${brand.id}::uuid, 40, 120, 'TVA20') returning id`);
  const pNoCost = await one<{ id: string }>(sql`insert into products (name, name_key, code, brand_id, price_retail, tax_rate_key) values (${"SANS COUT " + tag}, ${"SANS COUT " + tag}, ${"SC" + tag}, ${brand.id}::uuid, 90, 'TVA20') returning id`);
  await recordStockMovements([
    { productId: p.id, type: "STOCK_INITIAL", quantity: "100", unitCost: "40", date: day, sourceType: "MANUEL" },
    { productId: pNoCost.id, type: "STOCK_INITIAL", quantity: "20", unitCost: "1", date: day, sourceType: "MANUEL" },
  ], { id: u.id });
  const goodie = await one<{ id: string }>(sql`insert into inventory_items (name, category_key, brand_id, unit_cost) values (${"Trousse " + tag}, 'GOODIE', ${brand.id}::uuid, 15) returning id`);
  const free = await one<{ id: string }>(sql`insert into inventory_items (name, category_key, brand_id, unit_cost) values (${"Roller " + tag}, 'GOODIE', ${brand.id}::uuid, 0) returning id`);
  await recordMovement({ itemId: goodie.id, type: "ENTREE", quantity: 10, unitCost: 15, date: day, createdById: u.id });
  await recordMovement({ itemId: free.id, type: "ENTREE", quantity: 5, date: day, createdById: u.id });
  const itemStock = async (id: string) => (await one<{ stock: number }>(sql`select stock from inventory_items where id = ${id}::uuid`)).stock;
  const available = async (id: string) => (await stockState({ productIds: [id] }))[0].available;

  const mkClient = async (name: string) => one<{ id: string }>(sql`
    insert into clients (name, name_key, legal_name, ice, billing_address, city) values (${name}, ${name.toUpperCase()}, ${name}, '001234567000089', '1 RUE TEST', 'CASABLANCA') returning id`);
  const digital = await mkClient(`Echantillons digital ${tag}`);
  const pharmacy = await mkClient(`Pharmacie ${tag}`);
  const bulk = await mkClient(`COSPHARMA STE ${tag}`);
  await setClientInternal(digital.id, true, "DIGITAL", who);
  const s0 = await getSettings();
  await saveSettings({ ...s0, gestion: { ...s0.gestion, bulkSales: { clientId: bulk.id, simulationFrom: null }, marketingOutputs: { from: null, insufficientStock: "BLOCK" } } });

  // 1. Contrainte en base : une ligne porte un produit OU un article de matériel.
  const draftDoc = await D.saveDraft({ type: "BL", clientId: pharmacy.id, date: day, site: "COMANET", deliveryAddress: null, salesRepId: null, paymentModeKey: null, globalDiscountPct: "0", notes: null,
    lines: [{ productId: p.id, quantity: "1", unitPriceHt: "100", discountPct: "0" }] }, who);
  await refused("ligne produit ET matériel (contrainte en base)", () => db.execute(sql`update sales_document_lines set inventory_item_id = ${goodie.id}::uuid where document_id = ${draftDoc}::uuid`), /product_or_item/);
  await refused("ligne produit ET matériel (saisie)", () => D.saveDraft({ type: "BL", clientId: pharmacy.id, date: day, site: "COMANET", deliveryAddress: null, salesRepId: null, paymentModeKey: null, globalDiscountPct: "0", notes: null,
    lines: [{ productId: p.id, inventoryItemId: goodie.id, quantity: "1", unitPriceHt: "0", discountPct: "0" }] }, who), /jamais les deux/);
  await D.deleteDraft(draftDoc, who);

  // 2. BL « échantillons digital » : un produit (5 + 1 UG) et un goodie (3).
  const salesBefore = (await one<{ n: number }>(sql`select count(*)::int as n from sales`)).n;
  const bl = await D.saveDraft({ type: "BL", clientId: digital.id, date: day, site: "COMANET", deliveryAddress: null, salesRepId: null, paymentModeKey: null, globalDiscountPct: "0", notes: null,
    lines: [{ productId: p.id, quantity: "5", freeQuantity: "1", unitPriceHt: "0", discountPct: "0" }, { productId: null, inventoryItemId: goodie.id, quantity: "3", unitPriceHt: "99", discountPct: "10" }] }, who);
  const blDraft = (await D.getDocument(bl))!;
  assert.equal(blDraft.lines[1].unitPriceHt, "0.00", "le matériel est offert (prix forcé à 0)");
  await refused("facturer un client interne", () => D.saveDraft({ type: "FACTURE", clientId: digital.id, date: day, site: "COMANET", deliveryAddress: null, salesRepId: null, paymentModeKey: null, globalDiscountPct: "0", notes: null,
    lines: [{ productId: null, designation: "x", quantity: "1", unitPriceHt: "1", discountPct: "0" }] }, who), /client interne/);
  const vbl = await D.validateDocument(bl, who);
  const blDoc = (await D.getDocument(bl))!;
  assert.equal(await available(p.id), "94.000");
  assert.equal(await itemStock(goodie.id), 7);
  assert.equal(blDoc.lines[0].unitCost, "40.00");
  assert.equal(blDoc.lines[1].unitCost, "15.00");
  const charges = (await db.execute<{ amount: string; category: string; output_nature: string; client_id: string; brand_id: string }>(sql`
    select amount::text, category::text, output_nature, client_id, brand_id from marketing_expenses where document_line_id = any(array[${blDoc.lines[0].id}, ${blDoc.lines[1].id}]::uuid[])`)).rows;
  assert.deepEqual(charges, [{ amount: "240.00", category: "ECHANTILLONS", output_nature: "DIGITAL", client_id: digital.id, brand_id: brand.id }]);
  const mv = await one<{ client_id: string; unit_cost: string; quantity: number }>(sql`select client_id, unit_cost::text, quantity from inventory_movements where document_line_id = ${blDoc.lines[1].id}::uuid`);
  assert.deepEqual(mv, { client_id: digital.id, unit_cost: "15.00", quantity: -3 });
  assert.equal((await one<{ n: number }>(sql`select count(*)::int as n from sales`)).n, salesBefore, "aucune vente pour une sortie marketing");
  console.log(`✓ ${vbl.number} : stock produit 100 → 94, goodie 10 → 7, aucune vente, une charge « échantillons digital » de 240 MAD (6 × 40), goodie tracé sans charge`);

  // 3. Coûts à 0 ou inconnus : signalés, jamais estimés.
  const bl0 = await D.saveDraft({ type: "BL", clientId: digital.id, date: day, site: "COMANET", deliveryAddress: null, salesRepId: null, paymentModeKey: null, globalDiscountPct: "0", notes: null,
    lines: [{ productId: pNoCost.id, quantity: "2", unitPriceHt: "0", discountPct: "0" }, { productId: null, inventoryItemId: free.id, quantity: "1", unitPriceHt: "0", discountPct: "0" }] }, who);
  await D.validateDocument(bl0, who);
  const bl0Doc = (await D.getDocument(bl0))!;
  const { costIssues } = await import("@/lib/gestion/marketing-outputs-shared");
  const issues = costIssues({ isInternal: true, outputNatureKey: "DIGITAL" }, bl0Doc.lines.map((l) => ({ ...l, freeQuantity: l.freeQuantity })));
  assert.deepEqual(issues.map((i) => i.reason).sort(), ["COUT_INCONNU", "COUT_ZERO"]);
  assert.equal((await one<{ n: number }>(sql`select count(*)::int as n from marketing_expenses where document_line_id = ${bl0Doc.lines[0].id}::uuid`)).n, 0);
  console.log("✓ coût inconnu et coût à 0 : signalés, aucune charge estimée");

  // 4. Annulation : stocks rétablis, charge retirée.
  await D.cancelBL(bl, "Erreur de saisie", who);
  assert.equal(await available(p.id), "100.000");
  assert.equal(await itemStock(goodie.id), 10);
  assert.equal((await one<{ n: number }>(sql`select count(*)::int as n from marketing_expenses where document_line_id = ${blDoc.lines[0].id}::uuid`)).n, 0);
  assert.equal((await one<{ n: number }>(sql`select count(*)::int as n from inventory_movements where reversal_of is not null and document_line_id = ${blDoc.lines[1].id}::uuid`)).n, 1);
  console.log("✓ annulation : produit et goodie remis en stock (contre-mouvements), charge retirée");

  // 5. Stock de matériel insuffisant : bloqué.
  await refused("sortie de matériel au-delà du stock", async () => D.validateDocument(await D.saveDraft({ type: "BL", clientId: digital.id, date: day, site: "COMANET", deliveryAddress: null, salesRepId: null, paymentModeKey: null, globalDiscountPct: "0", notes: null,
    lines: [{ productId: null, inventoryItemId: goodie.id, quantity: "50", unitPriceHt: "0", discountPct: "0" }] }, who), who), /Stock insuffisant/);

  // 6. Goodie offert à une vraie pharmacie : pas de CA, pas de charge (achat), sortie tracée sur le client.
  const blPh = await D.saveDraft({ type: "BL", clientId: pharmacy.id, date: day, site: "COMANET", deliveryAddress: null, salesRepId: null, paymentModeKey: null, globalDiscountPct: "0", notes: null,
    lines: [{ productId: p.id, quantity: "2", unitPriceHt: "100", discountPct: "0" }, { productId: null, inventoryItemId: goodie.id, quantity: "1", unitPriceHt: "0", discountPct: "0" }] }, who);
  await D.validateDocument(blPh, who, { override: true });
  const blPhDoc = (await D.getDocument(blPh))!;
  assert.equal(blPhDoc.netHt, "200.00");
  assert.equal((await one<{ n: number }>(sql`select count(*)::int as n from marketing_expenses where document_line_id = ${blPhDoc.lines[1].id}::uuid`)).n, 0);
  assert.equal((await one<{ client_id: string }>(sql`select client_id from inventory_movements where document_line_id = ${blPhDoc.lines[1].id}::uuid`)).client_id, pharmacy.id);
  console.log("✓ goodie offert à une pharmacie : CA = produits seuls, sortie tracée sur le client, aucune charge (matériel passé en charge à l'achat)");

  // 7. Ventes en bloc : factures − avoirs réels ; la simulation et `pnl_bulk_sales` n'entrent pas.
  const before = await pnlStatement(year, month);
  const caBulk0 = before.lines.find((l) => l.key === "ca_bulk")!.total;
  await db.execute(sql`insert into pnl_bulk_sales (date, brand_id, client_id, label, amount_ht, cost_amount) values (${day}::date, ${brand.id}::uuid, ${bulk.id}::uuid, 'ancienne saisie', 999999, 1)`);
  // Pièce en simulation (bascule OFF) : exclue.
  const blSim = await D.saveDraft({ type: "BL", clientId: bulk.id, date: day, site: "COMANET", deliveryAddress: null, salesRepId: null, paymentModeKey: null, globalDiscountPct: "0", notes: null,
    lines: [{ productId: p.id, quantity: "10", unitPriceHt: "60", discountPct: "0" }] }, who);
  await D.validateDocument(blSim, who, { override: true });
  const invSim = await D.createInvoiceFromBLs([blSim], who);
  const vSim = await D.validateDocument(invSim, who);
  assert.ok(vSim.simulation);
  // Reprise d'une facture Sage réelle (idempotente), puis facture et avoir réels en mode ACTIF.
  const rep = { number: `FAREP${tag}`, date: day, paid: true, lines: [{ productRef: `SO${tag}`, quantity: "100", unitPriceHt: "60", discountPct: "0" }] };
  const dry = await D.importBulkInvoices([rep], who, { apply: false });
  assert.deepEqual(dry.preview.map((x) => x.netHt), ["6000.00"]);
  assert.equal((await D.importBulkInvoices([rep], who, { apply: true })).inserted, 1);
  assert.equal((await D.importBulkInvoices([rep], who, { apply: true })).inserted, 0, "reprise idempotente");
  const s1 = await getSettings();
  await saveSettings({ ...s1, gestion: { ...s1.gestion, cutover: { mode: "ACTIF", date: "2020-01-01", sites: ["COMANET"] } } });
  try {
    const blReal = await D.saveDraft({ type: "BL", clientId: bulk.id, date: day, site: "COMANET", deliveryAddress: null, salesRepId: null, paymentModeKey: null, globalDiscountPct: "0", notes: null,
      lines: [{ productId: p.id, quantity: "20", unitPriceHt: "60", discountPct: "0" }] }, who);
    await D.validateDocument(blReal, who, { override: true });
    const invReal = await D.createInvoiceFromBLs([blReal], who);
    assert.equal((await D.validateDocument(invReal, who)).simulation, false);
    const av = await D.createCreditNote(invReal, who);
    const avDoc = (await D.getDocument(av))!;
    await D.saveDraft({ id: av, type: "AVOIR", clientId: bulk.id, date: day, site: "COMANET", deliveryAddress: null, salesRepId: null, paymentModeKey: null, globalDiscountPct: "0", notes: null, reasonKey: "RETOUR", originDocumentId: invReal,
      lines: [{ productId: p.id, quantity: "5", unitPriceHt: "60", discountPct: "0", sourceLineId: avDoc.lines[0].sourceLineId, returnWarehouseKey: "PRINCIPAL" }] }, who);
    await D.validateDocument(av, who);
    assert.equal((await one<{ n: number }>(sql`select count(*)::int as n from sales where client_id = ${bulk.id}::uuid`)).n, 0, "aucune vente projetée pour le client en bloc");

    const after = await pnlStatement(year, month);
    const line = (k: string) => after.lines.find((l) => l.key === k)!.total;
    // Reprise 100 × 60 = 6 000 ; facture 20 × 60 = 1 200 ; avoir avec retour −5 × 60 = −300 → 6 900. Coût : (100 + 20 − 5) × 40.
    assert.equal(Math.round((line("ca_bulk") - caBulk0) * 100) / 100, 6900);
    assert.equal(Math.round(line("cogs_bulk") * 100) / 100 - Math.round(before.lines.find((l) => l.key === "cogs_bulk")!.total * 100) / 100, 115 * 40);
    const src = await pnlLineSources("ca_bulk", year, month, null);
    assert.ok(src.rows.every((r) => !/SIM/.test(r.ref ?? "")), "aucune pièce de simulation dans le détail");
    assert.ok(src.rows.some((r) => r.ref === `FAREP${tag}`));
    console.log("✓ ventes en bloc : reprise 6 000 + facture 1 200 − avoir avec retour 300 = 6 900 HT, coût 115 × 40 ; simulation et ancienne saisie ignorées, aucune vente projetée");

    // Simulations comptées à partir de `bulkSales.simulationFrom` : la facture simulée (10 × 60) entre le jour même, pas avant.
    const s3 = await getSettings();
    await saveSettings({ ...s3, gestion: { ...s3.gestion, bulkSales: { clientId: bulk.id, simulationFrom: day } } });
    const withSim = await pnlStatement(year, month);
    assert.equal(Math.round((withSim.lines.find((l) => l.key === "ca_bulk")!.total - caBulk0) * 100) / 100, 7500);
    assert.equal(Math.round(withSim.lines.find((l) => l.key === "cogs_bulk")!.total * 100) / 100 - Math.round(before.lines.find((l) => l.key === "cogs_bulk")!.total * 100) / 100, 125 * 40);
    const simRow = (await pnlLineSources("ca_bulk", year, month, null)).rows.find((r) => /SIM/.test(r.ref ?? ""));
    assert.ok(simRow && /en simulation/.test(simRow.detail ?? ""), "la facture simulée apparaît dans le détail, signalée");
    const nextDay = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    await saveSettings({ ...s3, gestion: { ...s3.gestion, bulkSales: { clientId: bulk.id, simulationFrom: nextDay } } });
    assert.equal(Math.round(((await pnlStatement(year, month)).lines.find((l) => l.key === "ca_bulk")!.total - caBulk0) * 100) / 100, 6900, "simulation antérieure à la date : exclue");
    await saveSettings({ ...s3, gestion: { ...s3.gestion, bulkSales: { clientId: bulk.id, simulationFrom: null } } });
    console.log("✓ ventes en bloc : facture simulée comptée à partir de la date du réglage (+600 HT, coût 10 × 40), exclue avant");
  } finally {
    const s2 = await getSettings();
    await saveSettings({ ...s2, gestion: { ...s2.gestion, cutover: s1.gestion.cutover } });
  }

  // 8. Marketing réel ventilé : la charge d'échantillon d'un BL va dans « Échantillons — digital ».
  const bl2 = await D.saveDraft({ type: "BL", clientId: digital.id, date: day, site: "COMANET", deliveryAddress: null, salesRepId: null, paymentModeKey: null, globalDiscountPct: "0", notes: null,
    lines: [{ productId: p.id, quantity: "3", unitPriceHt: "0", discountPct: "0" }] }, who);
  await D.validateDocument(bl2, who);
  const months = (await budgetConsumptionByMonth(year)).filter((m) => m.brandId === brand.id && m.month === month);
  assert.ok(months.length === 1 && months[0].breakdown["ECH:DIGITAL"] >= 120, JSON.stringify(months));
  assert.ok(Math.abs(Object.values(months[0].breakdown).reduce((a, v) => a + v, 0) - months[0].consumed) < 0.01, "ventilation = consommé");
  const pnl = await pnlStatement(year, month);
  assert.ok(pnl.lines.some((l) => l.key === "mkt_ECH:DIGITAL" && l.parent === "marketing"));
  console.log("✓ marketing réel : « Échantillons — digital » dans le P&L, ventilation égale au consommé officiel");

  // 9. Clients non commerciaux : hors des analyses clients, et le CA ne bouge pas.
  const ids = await nonCommercialClientIds();
  assert.ok(ids.includes(digital.id) && ids.includes(bulk.id) && !ids.includes(pharmacy.id));
  const list = await clientIntel({});
  assert.ok(!list.some((c) => c.id === digital.id || c.id === bulk.id));
  assert.equal((await clientIntel({ clientId: digital.id })).length, 1, "la fiche reste lisible");
  await totals(`${year}-01-01`, `${year + 1}-01-01`);
  await refused("rendre interne un client qui a des factures", () => setClientInternal(bulk.id, true, "DIGITAL", who), /vente en bloc|facture/);
  console.log("✓ clients internes et client en bloc exclus des analyses clients ; fiche lisible ; garde-fous de la fiche");

  console.log("\nTout est vert.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
