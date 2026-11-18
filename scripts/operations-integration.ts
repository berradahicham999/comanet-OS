/**
 * Test d'intégration — opérations de terrain (décision d'Hicham, 18/11/2026), sur une VRAIE base Postgres jetable (hors
 * `npm test`). Écrit des mouvements de stock en écriture seule : jamais sur la production.
 *
 *   OPERATIONS_IT=1 DATABASE_URL=postgresql://…/base_jetable node --conditions=react-server --import tsx scripts/operations-integration.ts
 *
 * Couvre : création de terrain à 300 MAD → « Planifiée » sans validation, dépense engagée une fois ; à 800 MAD → « à
 * valider », aucune dépense ; offre / UG comptée dans le seuil mais jamais reflétée en dépense ; garde du seuil dans
 * `transitionActivation()` ; budget porté au-dessus du seuil → retour à la direction ; compte rendu : goodies prévus
 * obligatoires, sortie du stock sans nouvelle dépense, résultats déclarés, clôture ; double déclaration refusée.
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
  const { recordMovement } = await import("@/lib/activations/inventory");
  const { createOperation, reportOperation, requalifyAfterBudgetChange } = await import("@/lib/activations/operations");
  const { transitionActivation } = await import("@/lib/activations/workflow");
  const { syncActivationExpenses } = await import("@/lib/activations/budget");
  const { getSettings } = await import("@/lib/settings");
  const { iso, today } = await import("@/lib/format");
  const one = async <T,>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows[0] as T;
  const refused = async (label: string, f: () => Promise<unknown>, re: RegExp) => {
    await assert.rejects(f, (e: { message?: string }) => re.test(String(e.message)), label);
    console.log("✓ refusé :", label);
  };

  const tag = Date.now().toString(36).toUpperCase();
  const day = iso(today());
  assert.equal((await getSettings()).activations.autoApproveMax, 500, "seuil par défaut 500 MAD");
  const hanane = await one<{ id: string; name: string }>(sql`insert into users (name, email, password_hash) values (${"Hanane " + tag}, ${`hanane.${tag.toLowerCase()}@test.local`}, 'x') returning id, name`);
  const actor = { id: hanane.id, name: hanane.name };
  const field = { isValidator: false };
  const brand = await one<{ id: string }>(sql`select id from brands where merged_into_id is null order by name limit 1`);
  const grossiste = await one<{ id: string }>(sql`insert into clients (name, name_key, city, type) values (${"GROSSISTE " + tag}, ${"GROSSISTE " + tag}, 'Casablanca', 'GROSSISTE') returning id`);
  const goodie = await one<{ id: string }>(sql`insert into inventory_items (name, category_key, brand_id, unit_cost) values (${"Trousse " + tag}, 'GOODIE', ${brand.id}::uuid, 12) returning id`);
  await recordMovement({ itemId: goodie.id, type: "ENTREE", quantity: 100, unitCost: 12, date: day, createdById: hanane.id, reason: "Réception de test" });
  const stock = async () => (await one<{ stock: number }>(sql`select stock from inventory_items where id = ${goodie.id}::uuid`)).stock;
  const statusOf = async (id: string) => (await one<{ status: string }>(sql`select status from activations where id = ${id}::uuid`)).status;
  const expenses = async (id: string) => (await db.execute<{ amount: number; status: string }>(sql`select amount::float8 as amount, status from marketing_expenses where activation_id = ${id}::uuid order by amount`)).rows;
  const goodieExpenses = async () => (await one<{ n: number }>(sql`select count(*)::int as n from marketing_expenses where label ilike ${"%" + tag + "%"}`)).n;

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
  assert.equal(await stock(), 100, "rien ne sort du stock à la création");
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
  await refused("compte rendu sans goodies alors que des goodies étaient prévus", () => reportOperation(op.id, { pharmaciesReached: 12, close: true }, actor, { ...field, date: day }), /goodies réellement utilisés/);
  const before = await goodieExpenses();
  const report = await reportOperation(op.id, { pharmaciesReached: 12, ordersOnSite: 4, ordersAmount: 3200, remark: "Bon accueil", materialsUsed: [{ itemId: goodie.id, quantity: 30 }], close: true }, actor, { ...field, date: day });
  assert.deepEqual(report, { status: "TERMINEE", closed: true });
  assert.equal(await stock(), 70, "100 − 30 utilisés");
  assert.equal(await goodieExpenses(), before, "aucune dépense pour la sortie des goodies (charge à l'achat)");
  assert.deepEqual((await expenses(op.id)).map((e) => e.amount), [300], "la dépense de l'opération reste la seule");
  const mat = await one<{ q: number; cost: number }>(sql`select quantity as q, unit_cost::float8 as cost from activation_materials where activation_id = ${op.id}::uuid`);
  assert.deepEqual([mat.q, mat.cost], [30, 12], "sortie tracée et valorisée au coût");
  const r = await one<{ ph: number; orders: number; amount: number; results: string }>(sql`select pharmacies_reached as ph, orders_on_site as orders, orders_amount::float8 as amount, results from activations where id = ${op.id}::uuid`);
  assert.deepEqual([r.ph, r.orders, r.amount, r.results], [12, 4, 3200, "Bon accueil"]);
  await refused("goodies déclarés deux fois", () => reportOperation(op.id, { materialsUsed: [{ itemId: goodie.id, quantity: 1 }] }, actor, { ...field, date: day }), /déjà déclarés/);
  await refused("clôture d'une opération en attente de validation", () => reportOperation(big.id, { close: true }, actor, { ...field, date: day }), /ne peut pas encore être clôturée/);
  console.log("✓ compte rendu : 30 goodies sortis (reste 70), aucune nouvelle dépense, résultats déclarés, clôturée");

  console.log("\nIntégration opérations de terrain : OK");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
