/**
 * Test d'intégration de la gestion commerciale, sur une VRAIE base Postgres (hors `npm test`) :
 * journal de stock (lots, CMUP, refus, contre-passation), numérotation (reprise Sage, absence de
 * trou, validations simultanées), import du stock initial (idempotence, annulation), pièces de
 * vente (BL, blocages, facture regroupée, avoir, annulation), achats (commande en devise, réception,
 * frais d'approche, CMUP, facture rapprochée, retour, solde), inventaire (théorique figé, compteurs,
 * motifs, ajustements, pistes).
 *
 * Écrit des données qui ne s'effacent pas (le journal est en écriture seule) : à lancer sur une
 * base jetable uniquement (PGlite local, branche Supabase de test), jamais sur la production.
 *
 *   GESTION_IT=1 DATABASE_URL=postgresql://…/base_jetable node --conditions=react-server --import tsx scripts/gestion-integration.ts
 */
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

const url = process.env.DATABASE_URL ?? "";
if (process.env.GESTION_IT !== "1" || /supabase|pooler/i.test(url)) {
  console.error("Refusé : ce test écrit dans le journal de stock (non effaçable). Lancez-le sur une base jetable avec GESTION_IT=1.");
  process.exit(1);
}

async function main() {
  const { db } = await import("@/db");
  const { recordStockMovements, stockState, reverseImportMovements } = await import("@/lib/gestion/ledger");
  const { allocateNumber, setNextNumber } = await import("@/lib/gestion/numbering");
  const { runImport } = await import("@/lib/import/run");
  const { rollbackRows } = await import("@/lib/import/rollback");
  const one = async <T,>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows[0] as T;
  const refused = async (label: string, f: () => Promise<unknown>, re: RegExp) => {
    // Drizzle enveloppe l'erreur Postgres : le message du trigger est dans `cause`.
    await assert.rejects(f, (e: { message?: string; cause?: { message?: string } }) => re.test(`${e.message} ${e.cause?.message ?? ""}`), label);
    console.log("✓ refusé :", label);
  };

  const tag = Date.now().toString(36).toUpperCase();
  const u = await one<{ id: string; name: string }>(sql`select id, name from users order by created_at limit 1`);
  assert.ok(u, "Au moins un utilisateur (npm run db:seed:base).");
  const actor = { id: u.id };
  const p1 = await one<{ id: string }>(sql`insert into products (name, name_key, code, track_lots) values (${"IT LOT " + tag}, ${"IT LOT " + tag}, ${"ITL" + tag}, true) returning id`);
  const p2 = await one<{ id: string }>(sql`insert into products (name, name_key, code) values (${"IT SANS LOT " + tag}, ${"IT SANS LOT " + tag}, ${"ITS" + tag}) returning id`);

  // Journal : lots, CMUP, refus.
  await recordStockMovements([
    { productId: p1.id, type: "STOCK_INITIAL", quantity: "100", unitCost: "124.375", lotNumber: "A", expiryDate: "2027-01-31", date: "2026-09-01", sourceType: "MANUEL" },
    { productId: p1.id, type: "STOCK_INITIAL", quantity: "50", unitCost: "130", lotNumber: "B", expiryDate: "2027-06-30", date: "2026-09-01", sourceType: "MANUEL" },
  ], actor);
  let s1 = (await stockState({ productIds: [p1.id] }))[0];
  assert.equal(s1.available, "150.000");
  assert.equal(s1.cmup, "126.2500");
  assert.equal(s1.value, "18937.50");
  console.log("✓ CMUP pondéré et valeur au centime");
  await refused("lot manquant", () => recordStockMovements([{ productId: p1.id, type: "CASSE_PERIME", quantity: "-1", date: "2026-09-02", sourceType: "MANUEL" }], actor), /suivi par lot/);
  await refused("stock insuffisant sur un lot", () => recordStockMovements([{ productId: p1.id, type: "CASSE_PERIME", quantity: "-60", lotNumber: "B", date: "2026-09-02", sourceType: "MANUEL" }], actor), /Stock insuffisant/);
  await refused("péremption contredite", () => recordStockMovements([{ productId: p1.id, type: "STOCK_INITIAL", quantity: "1", unitCost: "1", lotNumber: "A", expiryDate: "2028-01-01", date: "2026-09-02", sourceType: "MANUEL" }], actor), /déjà enregistré/);
  await refused("mouvement dans un dépôt externe", () => recordStockMovements([{ productId: p1.id, type: "CASSE_PERIME", quantity: "-1", lotNumber: "A", warehouseKey: "COSPHARMA", date: "2026-09-02", sourceType: "MANUEL" }], actor), /externe/);
  await recordStockMovements([{ productId: p1.id, type: "TRANSFERT", quantity: "-5", lotNumber: "A", counterpartWarehouseKey: "NON_VENDABLE", date: "2026-09-03", sourceType: "MANUEL" }], actor);
  s1 = (await stockState({ productIds: [p1.id] }))[0];
  assert.equal(s1.available, "145.000");
  assert.equal(s1.internalTotal, "150.000");
  assert.equal((await stockState({ productIds: [p1.id], at: "2026-09-02" }))[0].available, "150.000");
  console.log("✓ transfert vers le non-vendable et stock à une date");
  await refused("modification directe du journal", () => db.execute(sql`update stock_movements set quantity = 1 where product_id = ${p1.id}::uuid`), /écriture seule/);

  // Import du stock initial : idempotent, annulable par contre-mouvements, CMUP restauré.
  const rows = [{ Ref: "ITS" + tag, Qte: 40, Cout: 124.375 }, { Ref: "INCONNU-" + tag, Qte: 3, Cout: 1 }];
  const mapping = { productCode: "Ref", quantity: "Qte", unitCost: "Cout" };
  const imp = await runImport({ type: "STOCK_INITIAL", rows, mapping, fileName: "it.xlsx", userId: u.id, options: { stockDate: "2026-09-01" } });
  assert.equal(imp.inserted, 1);
  assert.equal(imp.errors.length, 1);
  const again = await runImport({ type: "STOCK_INITIAL", rows: rows.slice(0, 1), mapping, fileName: "it.xlsx", userId: u.id, options: { stockDate: "2026-09-01" } });
  assert.equal(again.inserted, 0);
  assert.equal(again.duplicates, 1);
  console.log("✓ import du stock initial idempotent, article inconnu en erreur");
  const extra = await one<{ id: string }>(sql`insert into imports (type, file_name, mapping) values ('STOCK_INITIAL', 'complement.xlsx', '{}'::jsonb) returning id`);
  await recordStockMovements([{ productId: p2.id, type: "STOCK_INITIAL", quantity: "10", unitCost: "200", date: "2026-09-05", sourceType: "IMPORT", importId: extra.id }], actor);
  assert.equal((await stockState({ productIds: [p2.id] }))[0].cmup, "139.5000"); // (40 × 124,375 + 10 × 200) ÷ 50
  assert.equal(await rollbackRows(extra.id, "STOCK_INITIAL", actor), 1);
  const s2 = (await stockState({ productIds: [p2.id] }))[0];
  assert.equal(s2.available, "40.000");
  assert.equal(s2.cmup, "124.3750");
  assert.equal(await reverseImportMovements(extra.id, actor, "2026-09-06"), 0);
  console.log("✓ annulation par contre-mouvements, CMUP restauré, pas de double annulation");

  // Import clients : identité légale posée sur la fiche existante, puis rapprochement par code Sage.
  const cname = `IT PHARMACIE ${tag}`;
  const { normKey } = await import("@/lib/import/normalize");
  await db.execute(sql`insert into clients (name, name_key) values (${cname}, ${normKey(cname)})`);
  const ci = await runImport({ type: "CLIENTS", rows: [{ Client: cname, Code: `C${tag}`, RS: "IT SARL", ICE: "001 122 334 000 055", Delai: 60, Remise: 0.25 }], mapping: { name: "Client", accountCode: "Code", legalName: "RS", ice: "ICE", paymentDays: "Delai", discountPct: "Remise" }, fileName: "clients.xlsx", userId: u.id });
  assert.equal(ci.errors.length, 0);
  const c1 = await one<{ legal_name: string; ice: string; payment_days: number; default_discount_pct: string }>(sql`select legal_name, ice, payment_days, default_discount_pct::text from clients where name_key = ${normKey(cname)}`);
  assert.deepEqual(c1, { legal_name: "IT SARL", ice: "001122334000055", payment_days: 60, default_discount_pct: "25.00" });
  await runImport({ type: "CLIENTS", rows: [{ Client: "AUTRE LIBELLE " + tag, Code: `C${tag}`, Adresse: "23 AV HASSAN II" }], mapping: { name: "Client", accountCode: "Code", address: "Adresse" }, fileName: "clients.xlsx", userId: u.id });
  const c2 = await one<{ n: number; addr: string }>(sql`select count(*)::int as n, max(billing_address) as addr from clients where account_code = ${"C" + tag}`);
  assert.deepEqual(c2, { n: 1, addr: "23 AV HASSAN II" });
  console.log("✓ import clients : identité légale, remise 0,25 lue 25 %, rapprochement par code Sage sans doublon");

  // Numérotation : reprise Sage, absence de trou, simultanéité.
  // Une année jamais servie par un passage précédent (la base jetable garde ses compteurs).
  const year = (await one<{ y: number }>(sql`select greatest(coalesce(max(year), 2089), 2089) + 1 as y from document_sequences where year >= 2090`)).y;
  await setNextNumber("FA", year, 262, { id: u.id, name: u.name });
  const n1 = await db.transaction((tx) => allocateNumber(tx, "FA", `${year}-09-24`));
  await assert.rejects(db.transaction(async (tx) => { await allocateNumber(tx, "FA", `${year}-09-24`); throw new Error("validation échouée"); }));
  const n2 = await db.transaction((tx) => allocateNumber(tx, "FA", `${year}-09-24`));
  assert.equal(n1.number, `FA${year}00262`);
  assert.equal(n2.number, `FA${year}00263`);
  await refused("prochain numéro réglé après émission", () => setNextNumber("FA", year, 500, { id: u.id, name: u.name }), /continue/);
  const parallel = await Promise.all(Array.from({ length: 20 }, () => db.transaction((tx) => allocateNumber(tx, "BL", `${year}-09-24`))));
  const seqs = parallel.map((p) => p.seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, Array.from({ length: 20 }, (_, i) => i + 1));
  console.log(`✓ numérotation : reprise à 262, aucun trou après une validation annulée, 20 BL simultanés numérotés 1 → 20`);


  // Pièces de vente (lot 2) : BL (sortie FEFO), blocage de remise et levée, facture regroupée,
  // immutabilité, avoir avec retour, annulation de BL (le PDF, module ESM, se vérifie sur le
  // serveur Next : /gestion/pieces/[id]/pdf). Mode OFF : séries de simulation.
  const D = await import("@/lib/gestion/documents");
  const { iso, today } = await import("@/lib/format");
  const who = { id: u.id, name: u.name };
  const day = iso(today());
  const client = await one<{ id: string }>(sql`select id from clients where account_code = ${"C" + tag}`);
  await db.execute(sql`update clients set city = 'CASABLANCA', billing_address = '23 AV HASSAN II' where id = ${client.id}::uuid`);
  await db.execute(sql`update products set price_retail = 199.00, tax_rate_key = 'TVA20' where id = ${p1.id}::uuid`);
  const draft = (qty: string, discount: string, free = "0") => ({
    type: "BL" as const, clientId: client.id, date: day, site: "COMANET", deliveryAddress: null, salesRepId: null, paymentModeKey: null, globalDiscountPct: "0", notes: null,
    lines: [{ productId: p1.id, quantity: qty, freeQuantity: free, unitPriceHt: "165.83", discountPct: discount }],
  });
  const bl1 = await D.saveDraft(draft("10", "10", "2"), who);
  const v1 = await D.validateDocument(bl1, who);
  assert.ok(v1.simulation && v1.number.startsWith("SIMBL"), v1.number);
  const bl1Doc = (await D.getDocument(bl1))!;
  assert.equal(bl1Doc.netHt, "1492.47"); // 10 × 165,83 × 0,90
  assert.deepEqual(bl1Doc.lines[0].lotAllocations?.map((a) => [a.lotNumber, a.qty]), [["A", "12.000"]]);
  assert.equal((await stockState({ productIds: [p1.id] }))[0].available, "133.000");
  console.log(`✓ BL ${v1.number} : 10 + 2 UG sortis du lot A (péremption la plus proche), net HT 1 492,47`);

  const bl2 = await D.saveDraft(draft("5", "30"), who);
  await assert.rejects(D.validateDocument(bl2, who), (e) => e instanceof D.CommercialBlockError && /remise 30 %/.test(e.message));
  const v2 = await D.validateDocument(bl2, who, { override: true });
  const bl2Doc = (await D.getDocument(bl2))!;
  assert.equal((bl2Doc.approvals as { code: string }[])[0].code, "REMISE");
  console.log(`✓ remise de 30 % bloquée (autorisée 25 %), levée tracée sur ${v2.number}`);
  await refused("stock insuffisant sur un BL", async () => D.validateDocument(await D.saveDraft(draft("500", "0"), who), who), /Stock insuffisant/);

  const inv = await D.createInvoiceFromBLs([bl1, bl2], who);
  const vi = await D.validateDocument(inv, who);
  const invDoc = (await D.getDocument(inv))!;
  assert.ok(vi.number.startsWith("SIMFA"));
  assert.equal(invDoc.lines.length, 2);
  assert.equal(invDoc.lines[0].freeQuantity, "2.000");
  assert.equal(invDoc.netHt, (Number(bl1Doc.netHt) + Number(bl2Doc.netHt)).toFixed(2));
  assert.equal(invDoc.amountInWords !== null && invDoc.dueDate !== null, true);
  assert.equal((await D.getDocument(bl1))!.status, "FACTURE");
  await refused("facturer deux fois le même BL", () => D.createInvoiceFromBLs([bl1], who), /pas facturable|déjà entièrement/);
  await refused("modifier une facture validée", () => db.execute(sql`update sales_documents set ttc = 1 where id = ${inv}::uuid`), /plus modifiable/);
  await refused("modifier une ligne validée", () => db.execute(sql`update sales_document_lines set quantity = 1 where document_id = ${inv}::uuid`), /ne se modifient pas/);
  await refused("supprimer une pièce numérotée", () => db.execute(sql`delete from sales_documents where id = ${inv}::uuid`), /ne se supprime pas/);
  console.log(`✓ facture ${vi.number} regroupant 2 BL, UG reprises, BL passés « Facturé », pièce figée par la base`);

  const av = await D.createCreditNote(inv, who);
  const va = await D.validateDocument(av, who);
  assert.ok(va.number.startsWith("SIMAV"));
  assert.equal((await stockState({ productIds: [p1.id] }))[0].available, "143.000"); // 133 − 5 (BL2) + 15 retournés (UG non reprises)
  await refused("avoir au-delà de la facture", () => D.createCreditNote(inv, who), /déjà fait l.objet/);
  console.log(`✓ avoir ${va.number} avec retour en stock`);

  const bl3 = await D.saveDraft(draft("3", "0"), who);
  await D.validateDocument(bl3, who);
  await D.cancelBL(bl3, "Erreur de saisie", who);
  assert.equal((await D.getDocument(bl3))!.status, "ANNULE");
  assert.equal((await stockState({ productIds: [p1.id] }))[0].available, "143.000");
  assert.equal((await one<{ n: number }>(sql`select count(*)::int as n from sales where source = 'COMANET_OS'`)).n, 0);
  console.log("✓ BL annulé : stock remis par contre-mouvements ; mode OFF : aucune vente projetée");


  // Achats (lot 3) : commande en euros, réception partielle avec lot et frais d'approche (CMUP,
  // cost_price), commandes en cours, facture fournisseur rapprochée, retour, solde, immutabilité.
  const P = await import("@/lib/gestion/purchases");
  const { productStocks } = await import("@/lib/stock");
  const sup = await one<{ id: string }>(sql`insert into suppliers (legal_name, name_key, currency, payment_days) values (${"IT LABO " + tag}, ${"IT LABO " + tag}, 'EUR', 60) returning id`);
  const p3 = await one<{ id: string }>(sql`insert into products (name, name_key, code, track_lots) values (${"IT ACHAT LOT " + tag}, ${"IT ACHAT LOT " + tag}, ${"ITA" + tag}, true) returning id`);
  await refused("devise sans taux", () => P.savePurchaseDraft({ type: "COMMANDE", supplierId: sup.id, date: day, currency: "EUR", exchangeRate: "", lines: [{ productId: p3.id, quantity: "1", unitPrice: "1" }] }, who), /taux du jour/);
  const cf = await P.savePurchaseDraft({ type: "COMMANDE", supplierId: sup.id, date: day, expectedDate: day, currency: "EUR", exchangeRate: "10.8", lines: [
    { productId: p3.id, quantity: "100", unitPrice: "10" }, { productId: p2.id, quantity: "50", unitPrice: "5" },
  ] }, who);
  const vcf = await P.validatePurchase(cf, who);
  assert.ok(vcf.number.startsWith("CF"), vcf.number);
  assert.equal((await productStocks({ productId: p3.id }))[0].onOrder, 100);
  console.log(`✓ commande ${vcf.number} en EUR au taux saisi ; 100 u. comptées en commandes en cours`);

  const br = await P.createReceptionFromOrder(cf, who);
  const brDoc = (await P.getPurchase(br))!;
  await refused("lot manquant à la réception", () => P.validatePurchase(br, who), /suivi par lot/);
  await P.savePurchaseDraft({ id: br, type: "RECEPTION", supplierId: sup.id, date: day, currency: "EUR", exchangeRate: "10.8", originDocumentId: cf, lines: brDoc.lines.map((l) => ({
    productId: l.productId, quantity: l.productId === p3.id ? "60" : l.quantity, unitPrice: l.unitPrice, sourceLineId: l.sourceLineId,
    lotNumber: l.productId === p3.id ? "L1" : null, expiryDate: l.productId === p3.id ? "2028-01-31" : null,
  })), landedCosts: [{ label: "Transport", amountMad: "324", allocation: "VALEUR" }] }, who);
  const vbr = await P.validatePurchase(br, who);
  const brv = (await P.getPurchase(br))!;
  const lp3 = brv.lines.find((l) => l.productId === p3.id)!;
  assert.equal(lp3.netHtMad, "6480.00"); // 60 × 10 × 10,8
  assert.equal(lp3.landedMad, "228.71"); // 324 × 6480 ÷ 9180
  assert.equal(lp3.unitCostMad, "111.8118");
  assert.equal(brv.landedMad, "324.00");
  const s3 = (await stockState({ productIds: [p3.id] }))[0];
  assert.equal(s3.available, "60.000");
  assert.equal(s3.cmup, "111.8118");
  assert.equal((await one<{ c: string }>(sql`select cost_price::text as c from products where id = ${p3.id}::uuid`)).c, "111.81");
  assert.equal((await P.getPurchase(cf))!.status, "PARTIELLE");
  assert.equal((await productStocks({ productId: p3.id }))[0].onOrder, 40);
  console.log(`✓ réception ${vbr.number} : 60 u. lot L1 au revient 111,8118 MAD (frais répartis au centime), CMUP et prix de revient à jour, commande « reçue en partie », 40 u. encore attendues`);

  const over = await P.savePurchaseDraft({ type: "RECEPTION", supplierId: sup.id, date: day, currency: "EUR", exchangeRate: "10.8", originDocumentId: cf, lines: [
    { productId: p3.id, quantity: "50", unitPrice: "10", sourceLineId: brDoc.lines.find((l) => l.productId === p3.id)!.sourceLineId, lotNumber: "L2" },
  ] }, who);
  await refused("réception au-delà du commandé", () => P.validatePurchase(over, who), /reste à recevoir/);
  await P.deletePurchaseDraft(over, who);

  const ff = await P.createInvoiceFromReceptions([br], who);
  const ffDoc = (await P.getPurchase(ff))!;
  await P.savePurchaseDraft({ id: ff, type: "FACTURE", supplierId: sup.id, date: day, currency: "EUR", exchangeRate: "10.9", supplierRef: "F-" + tag, lines: ffDoc.lines.map((l) => ({
    productId: l.productId, quantity: l.quantity, unitPrice: l.productId === p3.id ? "10.5" : l.unitPrice, sourceLineId: l.sourceLineId,
  })) }, who);
  const vff = await P.validatePurchase(ff, who);
  assert.deepEqual(vff.gaps.map((x) => x.kind), ["PRIX"]);
  assert.equal((await P.getPurchase(br))!.status, "FACTUREE");
  assert.ok((await P.getPurchase(ff))!.dueDate);
  const ff2 = await P.savePurchaseDraft({ type: "FACTURE", supplierId: sup.id, date: day, currency: "EUR", exchangeRate: "10.9", supplierRef: "F-" + tag, lines: [{ designation: "Frais de dossier", quantity: "1", unitPrice: "20" }] }, who);
  await refused("même facture fournisseur enregistrée deux fois", () => P.validatePurchase(ff2, who), /déjà enregistrée/);
  await P.deletePurchaseDraft(ff2, who);
  console.log(`✓ facture ${vff.number} rapprochée : écart de prix signalé (10,50 contre 10,00), réception « facturée », doublon de n° fournisseur refusé`);

  const rf = await P.createReturnFromReception(br, who);
  const rfDoc = (await P.getPurchase(rf))!;
  await P.savePurchaseDraft({ id: rf, type: "RETOUR", supplierId: sup.id, date: day, currency: "EUR", exchangeRate: "10.8", originDocumentId: br, lines: rfDoc.lines.filter((l) => l.productId === p3.id).map((l) => ({
    productId: l.productId, quantity: "10", unitPrice: l.unitPrice, sourceLineId: l.sourceLineId, lotNumber: l.lotNumber,
  })) }, who);
  await P.validatePurchase(rf, who);
  assert.equal((await stockState({ productIds: [p3.id] }))[0].available, "50.000");
  await P.closeOrder(cf, "Reliquat abandonné par le laboratoire", who);
  assert.equal((await P.getPurchase(cf))!.status, "CLOTUREE");
  assert.equal((await productStocks({ productId: p3.id }))[0].onOrder, 0);
  await refused("modifier une réception validée", () => db.execute(sql`update purchase_documents set net_ht_mad = 0 where id = ${br}::uuid`), /plus modifiable/);
  await refused("modifier une ligne de réception validée", () => db.execute(sql`update purchase_document_lines set unit_cost_mad = 1 where document_id = ${br}::uuid`), /ne se modifient pas/);
  await refused("supprimer une commande numérotée", () => db.execute(sql`delete from purchase_documents where id = ${cf}::uuid`), /ne se supprime pas/);
  console.log("✓ retour de 10 u. sur le lot L1, commande soldée (plus rien en commandes en cours), pièces d'achat figées par la base");


  // Inventaire (lot 4) : théorique figé au démarrage, deux saisies additionnées, lot trouvé en rayon,
  // BL validé pendant le comptage (piste), motif obligatoire, ajustements au journal, figé ensuite.
  const K = await import("@/lib/gestion/counts");
  const brand = await one<{ id: string }>(sql`insert into brands (name, slug) values (${"IT MARQUE " + tag}, ${"it-marque-" + tag.toLowerCase()}) returning id`);
  await db.execute(sql`update products set brand_id = ${brand.id}::uuid where id in (${p3.id}::uuid, ${p2.id}::uuid)`);
  const cnt = await K.createCount({ title: "IT inventaire " + tag, warehouseKey: "PRINCIPAL", brandIds: [brand.id], blind: true, countDate: day, notes: null }, who);
  await K.startCount(cnt, who);
  const lines0 = (await K.getCount(cnt))!.lines;
  assert.equal(lines0.find((l) => l.productId === p3.id && l.lotNumber === "L1")!.theoreticalQty, "50.000");
  const blInv = await D.saveDraft({ type: "BL", clientId: client.id, date: day, site: "COMANET", deliveryAddress: null, salesRepId: null, paymentModeKey: null, globalDiscountPct: "0", notes: null,
    lines: [{ productId: p3.id, quantity: "2", unitPriceHt: "200", discountPct: "0" }] }, who);
  await D.validateDocument(blInv, who, { override: true });
  await K.addEntry(cnt, { productId: p3.id, lotNumber: "l1", quantity: "30" }, { id: u.id, name: "Compteur A" });
  await K.addEntry(cnt, { productId: p3.id, lotNumber: "L1", quantity: "17" }, { id: u.id, name: "Compteur B" });
  await K.addEntry(cnt, { productId: p3.id, lotNumber: "L9", expiryDate: "2029-01-31", quantity: "4" }, who);
  await refused("lot manquant au comptage", () => K.addEntry(cnt, { productId: p3.id, quantity: "1" }, who), /suivi par lot/);
  const view = (await K.getCount(cnt))!;
  const l1 = view.lines.find((l) => l.productId === p3.id && l.lotNumber === "L1")!;
  const l9 = view.lines.find((l) => l.productId === p3.id && l.lotNumber === "L9")!;
  assert.equal(l1.counted, "47.000");
  assert.equal(l1.gapQty, "-3.000");
  assert.equal(l9.addedDuringCount, true);
  const leads = (await K.gapAnalysis(cnt)).find((r) => r.lineId === l1.id)!.leads.map((x) => x.code);
  assert.ok(leads.includes("BL_APRES_DEMARRAGE") && leads.includes("MOUVEMENTS_PENDANT"), leads.join(","));
  console.log("✓ inventaire : théorique figé (50), saisies de deux compteurs additionnées (47), lot trouvé en rayon, piste « BL validé après le démarrage »");
  await refused("écart sans motif", () => K.validateCount(cnt, who), /Motif manquant/);
  await K.setLineReason(l1.id, "SAISIE", "BL validé pendant le comptage");
  await K.setLineReason(l9.id, "ERREUR_COMPTAGE", null);
  const vinv = await K.validateCount(cnt, who);
  assert.ok(vinv.number.startsWith("INV"), vinv.number);
  assert.equal(vinv.adjustments, 2);
  const lots3 = (await stockState({ productIds: [p3.id] }))[0].lots;
  assert.equal(lots3.find((x) => x.lotNumber === "L1")!.qty, "45.000"); // 50 − 2 (BL) − 3 (ajustement)
  assert.equal(lots3.find((x) => x.lotNumber === "L9")!.qty, "4.000");
  const p2Line = (await K.getCount(cnt))!.lines.find((l) => l.productId === p2.id)!;
  assert.equal(p2Line.counted, null); // non compté : ni juste ni faux, aucun ajustement
  assert.equal(p2Line.gapQty, null);
  await refused("saisie sur un inventaire validé", () => K.addEntry(cnt, { productId: p2.id, quantity: "1" }, who), /pas ouvert/);
  await refused("modifier une ligne d'inventaire validé", () => db.execute(sql`update stock_count_lines set counted_qty = 0 where count_id = ${cnt}::uuid`), /clos/);
  console.log(`✓ inventaire ${vinv.number} validé : 2 ajustements (lot L1 −3, lot L9 +4), non comptés non ajustés, motif exigé, inventaire figé`);


  // Règlements et bascule (lot 5) : imputation partielle, dépassement refusé, virement encaissé d'emblée,
  // impayé qui rouvre la facture, règlement figé, reprise Sage, bascule réelle (numéro légal, projection).
  const RG = await import("@/lib/gestion/payments");
  const { getSettings, saveSettings } = await import("@/lib/settings");
  const blPay = await D.saveDraft({ type: "BL", clientId: client.id, date: day, site: "COMANET", deliveryAddress: null, salesRepId: null, paymentModeKey: null, globalDiscountPct: "0", notes: null,
    lines: [{ productId: p2.id, quantity: "5", unitPriceHt: "100", discountPct: "0" }] }, who);
  await D.validateDocument(blPay, who, { override: true });
  const faPay = await D.createInvoiceFromBLs([blPay], who);
  await D.validateDocument(faPay, who);
  assert.equal((await RG.invoiceSettlement(faPay)).balance, "600.00");
  const chq = await RG.createPayment({ clientId: client.id, date: day, modeKey: "CHEQUE", amount: "400", reference: "CHQ-" + tag, allocations: [{ invoiceId: faPay, amount: "400" }] }, who);
  const chqDoc = (await RG.getPayment(chq))!;
  assert.equal(chqDoc.status, "PORTEFEUILLE");
  assert.equal(chqDoc.isSimulation, true);
  assert.equal((await RG.invoiceSettlement(faPay)).balance, "200.00");
  await refused("imputation au-delà du solde", () => RG.createPayment({ clientId: client.id, date: day, modeKey: "VIREMENT", amount: "300", allocations: [{ invoiceId: faPay, amount: "300" }] }, who), /dépasse son solde/);
  const vir = await RG.createPayment({ clientId: client.id, date: day, modeKey: "VIREMENT", amount: "250", reference: "VIR", allocations: [{ invoiceId: faPay, amount: "200" }] }, who);
  const virDoc = (await RG.getPayment(vir))!;
  assert.equal(virDoc.status, "ENCAISSE");
  assert.equal(virDoc.unallocated, "50.00");
  assert.equal((await RG.invoiceSettlement(faPay)).balance, "0.00");
  await RG.setPaymentStatus(chq, "REMIS", { date: day }, who);
  await refused("impayé sans motif", () => RG.setPaymentStatus(chq, "IMPAYE", { date: day }, who), /motif/);
  await RG.setPaymentStatus(chq, "IMPAYE", { date: day, reason: "Provision insuffisante" }, who);
  assert.equal((await RG.invoiceSettlement(faPay)).balance, "400.00");
  await refused("modifier le montant d'un règlement", () => db.execute(sql`update payments set amount = 1 where id = ${vir}::uuid`), /ne se modifient pas/);
  await refused("supprimer un règlement", () => db.execute(sql`delete from payments where id = ${vir}::uuid`), /ne se supprime pas/);
  await refused("revenir d'un impayé", () => RG.setPaymentStatus(chq, "ENCAISSE", { date: day }, who), /Passage impossible/);
  console.log("✓ règlements : chèque imputé (solde 200), dépassement refusé, virement encaissé d'emblée (50 non imputés), impayé qui rouvre la facture (solde 400), règlement figé");

  const repNo = "FAREP" + tag;
  const rep = await D.importOpeningInvoices([{ clientId: client.id, number: repNo, date: "2026-12-15", dueDate: "2027-02-13", ttc: "1000.00", balance: "300.00", site: "COMANET" }], who);
  assert.equal(rep.inserted, 1);
  assert.equal((await D.importOpeningInvoices([{ clientId: client.id, number: repNo, date: "2026-12-15", dueDate: null, ttc: "1000.00", balance: "300.00", site: "COMANET" }], who)).inserted, 0);
  const repDoc = await one<{ id: string; is_simulation: boolean; source: string }>(sql`select id, is_simulation, source from sales_documents where number = ${repNo}`);
  assert.equal((await RG.invoiceSettlement(repDoc.id)).balance, "300.00");
  assert.equal(repDoc.is_simulation, false);
  await refused("règlement de simulation sur une facture reprise (réelle)", () => RG.createPayment({ clientId: client.id, date: day, modeKey: "VIREMENT", amount: "100", allocations: [{ invoiceId: repDoc.id, amount: "100" }] }, who), /simulation sur une facture réelle/);
  console.log("✓ reprise Sage : facture ouverte reprise avec son reste (300), idempotente, jamais soldée par un règlement de simulation");

  const before = await getSettings();
  try {
    await saveSettings({ ...before, gestion: { ...before.gestion, cutover: { mode: "ACTIF", date: day, sites: ["COMANET"] } } });
    const blReal = await D.saveDraft({ type: "BL", clientId: client.id, date: day, site: "COMANET", deliveryAddress: null, salesRepId: null, paymentModeKey: null, globalDiscountPct: "0", notes: null,
      lines: [{ productId: p2.id, quantity: "1", unitPriceHt: "200", discountPct: "0" }] }, who);
    const vReal = await D.validateDocument(blReal, who, { override: true });
    assert.ok(/^BL\d/.test(vReal.number) && !vReal.simulation, vReal.number);
    assert.equal((await one<{ n: number }>(sql`select count(*)::int as n from sales where source = 'COMANET_OS' and lvc_ref = ${vReal.number}`)).n, 1);
    const ledger = (await stockState({ productIds: [p2.id] }))[0].available;
    assert.equal((await productStocks({ productId: p2.id }))[0].stock, Number(ledger));
    const vr = await RG.createPayment({ clientId: client.id, date: day, modeKey: "VIREMENT", amount: "100", reference: "VIR2", allocations: [{ invoiceId: repDoc.id, amount: "100" }] }, who);
    assert.equal((await RG.getPayment(vr))!.isSimulation, false);
    assert.equal((await RG.invoiceSettlement(repDoc.id)).balance, "200.00");
    console.log(`✓ bascule active : BL légal ${vReal.number} projeté dans les ventes, stock lu au journal, règlement réel imputé sur la facture reprise (solde 200)`);
  } finally {
    await saveSettings(before);
  }

  console.log("Tous les contrôles d'intégration sont passés.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
