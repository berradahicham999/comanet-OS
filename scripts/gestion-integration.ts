/**
 * Test d'intégration de la gestion commerciale, sur une VRAIE base Postgres (hors `npm test`) :
 * journal de stock (lots, CMUP, refus, contre-passation), numérotation (reprise Sage, absence de
 * trou, validations simultanées), import du stock initial (idempotence, annulation).
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
  const year = 2090 + (Date.now() % 9);
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

  console.log("Tous les contrôles d'intégration sont passés.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
