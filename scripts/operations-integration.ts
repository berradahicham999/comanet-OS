/**
 * Test d'intégration — opérations de terrain (décision d'Hicham, 18/11/2026), sur une VRAIE base Postgres jetable (hors
 * `npm test`). Écrit des mouvements de stock en écriture seule : jamais sur la production.
 *
 *   OPERATIONS_IT=1 DATABASE_URL=postgresql://…/base_jetable node --conditions=react-server --import tsx scripts/operations-integration.ts
 *
 * Couvre le scénario d'Hicham de bout en bout : commande fournisseur de 100 goodies → réception au stock central au
 * coût de revient → facture fournisseur = LA dépense marketing des goodies (une fois) → transfert de 50 à Hanane → son
 * opération grossiste à 300 MAD part « Planifiée » → compte rendu avec 30 utilisés, sortis de SON stock → 20 chez
 * Hanane, 50 au central, aucune nouvelle dépense → une opération à 800 MAD reste « à valider ». Plus : refus au-delà du
 * stock en main (transfert, compte rendu), offre / UG comptée dans le seuil mais jamais reflétée en dépense, garde du
 * seuil dans `transitionActivation()`, budget porté au-dessus du seuil → retour à la direction, double déclaration.
 *
 *   (avec les stubs Next) OPERATIONS_IT=1 DATABASE_URL=… node --conditions=react-server --import tsx --import ./scripts/agent-tool-hooks.mjs scripts/operations-integration.ts
 */
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

const url = process.env.DATABASE_URL ?? "";
if (process.env.OPERATIONS_IT !== "1" || /supabase|pooler/i.test(url)) {
  console.error("Refusé : ce test écrit dans des journaux non effaçables. Lancez-le sur une base jetable avec OPERATIONS_IT=1.");
  process.exit(1);
}

async function main() {
  const { db } = await import("@/db");
  const { transferMaterial } = await import("@/lib/activations/inventory");
  const { createOperation, reportOperation, requalifyAfterBudgetChange } = await import("@/lib/activations/operations");
  const { transitionActivation } = await import("@/lib/activations/workflow");
  const { syncActivationExpenses } = await import("@/lib/activations/budget");
  const { getSettings, saveSettings } = await import("@/lib/settings");
  const P = await import("@/lib/gestion/purchases");
  const { iso, today } = await import("@/lib/format");
  const one = async <T,>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows[0] as T;
  const refused = async (label: string, f: () => Promise<unknown>, re: RegExp) => {
    await assert.rejects(f, (e: { message?: string }) => re.test(String(e.message)), label);
    console.log("✓ refusé :", label);
  };

  const tag = Date.now().toString(36).toUpperCase();
  const day = iso(today());
  const cur = await getSettings();
  assert.equal(cur.activations.autoApproveMax, 500, "seuil par défaut 500 MAD");
  const { DEFAULT_ACTIVATION_SETTINGS } = await import("@/lib/settings");
  assert.equal(DEFAULT_ACTIVATION_SETTINGS.materialChargeFrom, null, "charge à la facture désactivée par défaut");
  await saveSettings({ ...cur, activations: { ...cur.activations, materialChargeFrom: day } });
  const hanane = await one<{ id: string; name: string }>(sql`insert into users (name, email, password_hash) values (${"Hanane " + tag}, ${`hanane.${tag.toLowerCase()}@test.local`}, 'x') returning id, name`);
  const sara = await one<{ id: string; name: string }>(sql`insert into users (name, email, password_hash) values (${"Sara " + tag}, ${`sara.${tag.toLowerCase()}@test.local`}, 'x') returning id, name`);
  const actor = { id: hanane.id, name: hanane.name };
  const field = { isValidator: false };
  const brand = await one<{ id: string }>(sql`select id from brands where merged_into_id is null order by name limit 1`);
  const grossiste = await one<{ id: string }>(sql`insert into clients (name, name_key, city, type) values (${"GROSSISTE " + tag}, ${"GROSSISTE " + tag}, 'Casablanca', 'GROSSISTE') returning id`);
  const goodie = await one<{ id: string }>(sql`insert into inventory_items (name, category_key, brand_id, unit_cost) values (${"Trousse " + tag}, 'GOODIE', ${brand.id}::uuid, 0) returning id`);
  const central = async () => (await one<{ stock: number }>(sql`select stock from inventory_items where id = ${goodie.id}::uuid`)).stock;
  const heldBy = async (u: string) => Number((await one<{ q: number }>(sql`select coalesce(sum(quantity), 0)::int as q from inventory_movements where item_id = ${goodie.id}::uuid and holder_user_id = ${u}::uuid`)).q);
  const statusOf = async (id: string) => (await one<{ status: string }>(sql`select status from activations where id = ${id}::uuid`)).status;
  const expenses = async (id: string) => (await db.execute<{ amount: number; status: string }>(sql`select amount::float8 as amount, status from marketing_expenses where activation_id = ${id}::uuid order by amount`)).rows;
  const goodieExpenses = async () => (await db.execute<{ amount: number; status: string; category: string }>(sql`select amount::float8 as amount, status, category::text from marketing_expenses where label ilike ${"%" + tag + "%"}`)).rows;
  const who = { id: sara.id, name: sara.name };

  // 0. Achat : commande de 100 goodies à 12 MAD → réception au stock central → facture fournisseur = la charge.
  const sup = await one<{ id: string }>(sql`insert into suppliers (legal_name, name_key, currency, payment_days) values (${"GOODIES SARL " + tag}, ${"GOODIES SARL " + tag}, 'MAD', 30) returning id`);
  const cf = await P.savePurchaseDraft({ type: "COMMANDE", supplierId: sup.id, date: day, expectedDate: day, currency: "MAD", exchangeRate: "1", lines: [{ inventoryItemId: goodie.id, quantity: "100", unitPrice: "12" }] }, who);
  await P.validatePurchase(cf, who);
  assert.equal(await central(), 0, "une commande ne fait rien entrer");
  const br = await P.createReceptionFromOrder(cf, who);
  await P.validatePurchase(br, who);
  assert.equal(await central(), 100, "réception : 100 au stock central");
  assert.equal((await one<{ c: string }>(sql`select unit_cost::text as c from inventory_items where id = ${goodie.id}::uuid`)).c, "12.00", "coût de revient repris");
  assert.deepEqual(await goodieExpenses(), [], "la réception ne crée aucune dépense");
  const ff = await P.createInvoiceFromReceptions([br], who);
  const ffDoc = (await P.getPurchase(ff))!;
  await P.savePurchaseDraft({ id: ff, type: "FACTURE", supplierId: sup.id, date: day, currency: "MAD", exchangeRate: "1", supplierRef: "FG-" + tag, lines: ffDoc.lines.map((l) => ({
    inventoryItemId: l.inventoryItemId, quantity: l.quantity, unitPrice: l.unitPrice, sourceLineId: l.sourceLineId,
  })) }, who);
  await P.validatePurchase(ff, who);
  assert.deepEqual((await goodieExpenses()).map((e) => [e.amount, e.status, e.category]), [[1200, "SPENT", "GOODIES"]], "facture fournisseur : 1 200 MAD de goodies, une seule dépense");
  console.log("✓ achat : CF 100 → BR au central (12 MAD) → FF : une dépense marketing GOODIES de 1 200 MAD, aucune à la réception");

  // 0 bis. Distribution : 50 du central à Hanane ; refus au-delà de ce qu'on a en main.
  await refused("transfert de 101 depuis le stock central (100)", () => transferMaterial({ itemId: goodie.id, from: null, to: hanane.id, quantity: 101, date: day, createdById: sara.id }), /au stock central : 100 disponibles/);
  await transferMaterial({ itemId: goodie.id, from: null, to: hanane.id, quantity: 50, date: day, createdById: sara.id });
  assert.deepEqual([await central(), await heldBy(hanane.id)], [50, 50]);
  const pair = (await db.execute<{ q: number; h: string | null }>(sql`select quantity as q, holder_user_id::text as h from inventory_movements where item_id = ${goodie.id}::uuid and type = 'TRANSFERT' order by quantity`)).rows;
  assert.deepEqual(pair.map((x) => [x.q, x.h]), [[-50, null], [50, hanane.id]], "un transfert = deux mouvements");
  await refused("Hanane donne 51 goodies (50 en main)", () => transferMaterial({ itemId: goodie.id, from: hanane.id, to: sara.id, quantity: 51, date: day, createdById: hanane.id }), /chez Hanane .* : 50 disponibles/);
  await refused("transfert vers soi-même", () => transferMaterial({ itemId: goodie.id, from: hanane.id, to: hanane.id, quantity: 1, date: day, createdById: hanane.id }), /les mêmes/);
  assert.equal((await goodieExpenses()).length, 1, "la distribution ne crée aucune dépense");
  console.log("✓ distribution : 50 à Hanane (2 mouvements), refus au-delà du stock en main, aucune dépense");

  // 1. Opération grossiste à 300 MAD : part seule, « Planifiée », dépense engagée une fois.
  const op = await createOperation({
    typeKey: "GROSSISTE", clientId: grossiste.id, brandIds: [brand.id], productIds: [], date: day, offerLabel: "10 + 2",
    plannedMaterials: [{ itemId: goodie.id, quantity: 30 }], budget: 300,
  }, actor, field);
  assert.deepEqual([op.status, op.needsValidation], ["PLANIFIEE", false]);
  assert.equal(await statusOf(op.id), "PLANIFIEE");
  assert.deepEqual((await expenses(op.id)).map((e) => [e.amount, e.status]), [[300, "COMMITTED"]]);
  const row = await one<{ offer: string; planned: { itemId: string; quantity: number }[]; client: string }>(sql`select offer_label as offer, planned_materials as planned, client_id::text as client from activations where id = ${op.id}::uuid`);
  assert.deepEqual([row.offer, row.planned, row.client], ["10 + 2", [{ itemId: goodie.id, quantity: 30 }], grossiste.id]);
  assert.equal(await heldBy(hanane.id), 50, "rien ne sort du stock à la création");
  console.log("✓ 300 MAD → Planifiée sans validation, dépense engagée 300, goodies prévus sans sortie");

  // 2. Opération à 800 MAD : en attente de la direction, aucune dépense.
  const big = await createOperation({ typeKey: "EVENEMENT_PARA", clientId: grossiste.id, brandIds: [brand.id], productIds: [], date: day, budget: 800 }, actor, field);
  assert.deepEqual([big.status, big.needsValidation], ["PROPOSEE", true]);
  assert.deepEqual(await expenses(big.id), []);
  const task = await one<{ n: number }>(sql`select count(*)::int as n from tasks where entity_type = 'activation' and entity_id = ${big.id}::uuid and status in ('TODO','IN_PROGRESS')`);
  assert.ok(task.n >= 1, "tâche de validation pour la direction");
  console.log("✓ 800 MAD → à valider, aucune dépense, tâche de validation");

  // 3. Offre / UG : comptée dans le seuil (300 + 300 = 600 → à valider), jamais reflétée en dépense.
  const offer = await createOperation({ typeKey: "GROSSISTE", clientId: grossiste.id, brandIds: [brand.id], productIds: [], date: day, budget: 300, offerCost: 300, offerLabel: "-15 %" }, actor, field);
  assert.equal(offer.status, "PROPOSEE");
  await transitionActivation(offer.id, "VALIDEE", { id: hanane.id, name: "Direction" }, null, { isValidator: true });
  assert.deepEqual((await expenses(offer.id)).map((e) => e.amount), [300], "seul le poste reflété devient une dépense");
  console.log("✓ offre / UG : 600 MAD au seuil → à valider ; validée, seuls 300 MAD en dépense");

  // 4. Garde du seuil : un non-validateur ne planifie pas au-dessus de 500 MAD.
  const res = await transitionActivation(big.id, "VALIDEE", actor, null, field);
  assert.equal(res.ok, false, "PROPOSEE → VALIDEE exige un validateur");
  const idea = await one<{ id: string }>(sql`insert into activations (name, type, status, date, created_by_id, responsible_id) values (${"IDEE " + tag}, 'GROSSISTE', 'IDEE', ${day}::date, ${hanane.id}::uuid, ${hanane.id}::uuid) returning id`);
  await db.execute(sql`insert into activation_budget_lines (activation_id, cost_item_key, label, planned, brand_id) values (${idea.id}::uuid, 'GOODIES', 'Goodies', 501, ${brand.id}::uuid)`);
  const blocked = await transitionActivation(idea.id, "PLANIFIEE", actor, null, field);
  assert.ok(!blocked.ok && /seuil de 500 MAD/.test(blocked.reason), "501 MAD : planification refusée");
  const byDirection = await transitionActivation(idea.id, "PLANIFIEE", { id: hanane.id, name: "Direction" }, null, { isValidator: true });
  assert.ok(byDirection.ok, "la direction peut");
  console.log("✓ garde du seuil dans transitionActivation()");

  // 5. Budget porté au-dessus du seuil après coup : retour à la direction.
  const small = await createOperation({ typeKey: "GROSSISTE", clientId: grossiste.id, brandIds: [brand.id], productIds: [], date: day, budget: 200 }, actor, field);
  assert.equal(small.status, "PLANIFIEE");
  await db.execute(sql`update activation_budget_lines set planned = 700 where activation_id = ${small.id}::uuid`);
  await syncActivationExpenses(small.id);
  assert.equal(await requalifyAfterBudgetChange(small.id, actor, field), "PROPOSEE");
  assert.equal(await statusOf(small.id), "PROPOSEE");
  assert.deepEqual(await expenses(small.id), [], "en attente : plus de dépense engagée");
  console.log("✓ budget porté à 700 MAD → retour en validation, dépense retirée");

  // 6. Compte rendu : goodies prévus obligatoires, 30 utilisés sortent du stock sans nouvelle dépense, clôture.
  const mine = { ...field, date: day, stockHolder: hanane.id };
  await refused("compte rendu sans goodies alors que des goodies étaient prévus", () => reportOperation(op.id, { pharmaciesReached: 12, close: true }, actor, mine), /goodies réellement utilisés/);
  await refused("compte rendu avec 51 goodies (50 en main)", () => reportOperation(op.id, { materialsUsed: [{ itemId: goodie.id, quantity: 51 }] }, actor, mine), /chez Hanane .* : 50 disponibles/);
  // Tout ou rien : un second goodie refusé n'en fait sortir aucun (le compte rendu reste à refaire).
  const other = await one<{ id: string }>(sql`insert into inventory_items (name, category_key, brand_id, unit_cost) values (${"Stylo " + tag}, 'GOODIE', ${brand.id}::uuid, 3) returning id`);
  await refused("compte rendu dont un goodie dépasse le stock en main", () => reportOperation(op.id, { materialsUsed: [{ itemId: goodie.id, quantity: 10 }, { itemId: other.id, quantity: 1 }] }, actor, mine), /Stylo .* chez Hanane .* : 0 disponible/);
  assert.equal(await heldBy(hanane.id), 50, "rien n'est sorti");
  const report = await reportOperation(op.id, { pharmaciesReached: 12, ordersOnSite: 4, ordersAmount: 3200, remark: "Bon accueil", materialsUsed: [{ itemId: goodie.id, quantity: 30 }], close: true }, actor, mine);
  assert.deepEqual(report, { status: "TERMINEE", closed: true });
  assert.deepEqual([await heldBy(hanane.id), await central()], [20, 50], "20 chez Hanane, 50 au central");
  assert.deepEqual((await goodieExpenses()).map((e) => e.amount), [1200], "la dépense des goodies reste celle de l'achat, une seule fois");
  assert.deepEqual((await expenses(op.id)).map((e) => e.amount), [300], "la dépense de l'opération reste la seule");
  const mat = await one<{ q: number; cost: number }>(sql`select quantity as q, unit_cost::float8 as cost from activation_materials where activation_id = ${op.id}::uuid`);
  assert.deepEqual([mat.q, mat.cost], [30, 12], "sortie tracée et valorisée au coût");
  const r = await one<{ ph: number; orders: number; amount: number; results: string }>(sql`select pharmacies_reached as ph, orders_on_site as orders, orders_amount::float8 as amount, results from activations where id = ${op.id}::uuid`);
  assert.deepEqual([r.ph, r.orders, r.amount, r.results], [12, 4, 3200, "Bon accueil"]);
  await refused("goodies déclarés deux fois", () => reportOperation(op.id, { materialsUsed: [{ itemId: goodie.id, quantity: 1 }] }, actor, mine), /déjà déclarés/);
  await refused("clôture d'une opération en attente de validation", () => reportOperation(big.id, { close: true }, actor, mine), /ne peut pas encore être clôturée/);
  assert.equal(await statusOf(big.id), "PROPOSEE", "l'opération à 800 MAD reste à valider");
  const { holdersOverview } = await import("@/lib/activations/inventory");
  const h = (await holdersOverview()).find((x) => x.holderId === hanane.id)!;
  assert.deepEqual([h.ledger.received, h.ledger.usedOnOperations, h.ledger.given, h.held], [50, 30, 0, 20], "vue direction : reçus 50, utilisés 30, en main 20");
  console.log("✓ compte rendu : 30 goodies sortis du stock de Hanane (20 chez elle, 50 au central), aucune nouvelle dépense, résultats déclarés, clôturée ; 800 MAD toujours à valider");

  // Rejouer la validation de facture ne recrée rien (idempotence par ligne d'achat) ; remise des réglages.
  const dup = await one<{ n: number }>(sql`select count(*)::int as n from marketing_expenses where purchase_line_id is not null and label ilike ${"%" + tag + "%"}`);
  assert.equal(dup.n, 1);
  await saveSettings({ ...(await getSettings()), activations: { ...(await getSettings()).activations, materialChargeFrom: null } });

  console.log("\nIntégration opérations de terrain : OK");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
