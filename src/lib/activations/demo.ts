import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activations, activationBrands, activationProducts, activationClients, activationBudgetLines, activationChecklistItems,
  activationStatusHistory, activationComments, inventoryItems, brandValidators,
} from "@/db/schema";
import { iso, addDays, today } from "@/lib/format";
import { recordMovement, consumeMaterial } from "./inventory";
import { syncActivationExpenses } from "./budget";

/**
 * Jeu de démonstration du module Activations, calé sur les VRAIES marques, produits et clients
 * en base, et sur les villes réelles (Casablanca, Rabat, Marrakech, Agadir, Tanger, Fès, Tétouan).
 * Toutes les lignes portent « [DÉMO] » dans `notes` : `purgeActivationDemo()` les retire, avec
 * leurs lignes budgétaires, checklists, matériel, historique, commentaires, dépenses reflétées
 * et articles d'inventaire de démo. Les ventes ne sont jamais touchées.
 */
export const DEMO_TAG = "[DÉMO]";
const CITIES = ["Casablanca", "Rabat", "Marrakech", "Agadir", "Tanger", "Fès", "Tétouan"];

const rand = (seed: { v: number }) => { seed.v = (seed.v * 9301 + 49297) % 233280; return seed.v / 233280; };
const pick = <T,>(seed: { v: number }, arr: T[]) => arr[Math.floor(rand(seed) * arr.length)];

type Plan = { name: (brand: string, city: string) => string; type: string; offset: number; days: number; lines: [string, string, number][]; done?: boolean; results?: Partial<{ participants: number; samples: number; pharmaciesReached: number; leads: number; ordersOnSite: number; ordersAmount: number; pressMentions: number }>; note?: string };
const PLANS: Plan[] = [
  { name: (b, c) => `Soirée de lancement ${b} — ${c}`, type: "EVENEMENT", offset: -75, days: 1, lines: [["LIEU", "Salle", 15000], ["TRAITEUR", "Cocktail", 12000], ["CACHET", "Dermatologue invitée", 5000], ["IMPRESSION", "Invitations, kakémonos", 3000]], done: true, results: { participants: 64, samples: 120, pharmaciesReached: 38, leads: 11, ordersOnSite: 9, ordersAmount: 42000 }, note: "Très bonne présence des pharmacies du centre ; refaire avec un créneau plus tôt." },
  { name: (b, c) => `Vitrine ${b} — pharmacies de ${c}`, type: "PLV", offset: -50, days: 28, lines: [["IMPRESSION", "Vitrophanie", 1500]], done: true, results: { pharmaciesReached: 6 } },
  { name: (b, c) => `Sampling ${b} — ${c}`, type: "SAMPLING", offset: -40, days: 14, lines: [["ECHANTILLONS", "Minidoses", 2400]], done: true, results: { samples: 400, pharmaciesReached: 8, participants: 400 } },
  { name: (b) => `Stand ${b} — congrès de dermatologie`, type: "SALON", offset: -30, days: 3, lines: [["SPONSORING", "Stand 9 m²", 40000], ["IMPRESSION", "Kakémonos, brochures", 6000], ["TRANSPORT", "Déplacements équipe", 8000], ["ECHANTILLONS", "Échantillons", 5000]], done: true, results: { participants: 210, leads: 34, samples: 500, pressMentions: 2 } },
  { name: (b, c) => `Offre pharmacie du mois ${b} — ${c}`, type: "OPERATION_PHARMACIE", offset: -20, days: 30, lines: [["IMPRESSION", "Supports de l'offre", 2000], ["GOODIES", "Dotation challenge vendeurs", 4000]] },
  { name: (b, c) => `Formation pharmaciens ${b} — ${c}`, type: "EVENEMENT", offset: -6, days: 1, lines: [["ECHANTILLONS", "Échantillons de formation", 800], ["GOODIES", "Cadeaux équipe", 500]], done: true },
  { name: (b, c) => `Présentoirs de comptoir ${b} — ${c}`, type: "PLV", offset: 3, days: 30, lines: [["IMPRESSION", "Stop-rayons", 900]] },
  { name: (b, c) => `Sampling ${b} — parapharmacies de ${c}`, type: "SAMPLING", offset: 9, days: 10, lines: [["ECHANTILLONS", "Minidoses", 1800]] },
  { name: (b) => `Partenariat ${b} — salle de sport premium`, type: "SPONSORING", offset: 18, days: 60, lines: [["SPONSORING", "Droits partenariat", 20000], ["GOODIES", "Kits sportifs", 6000]] },
  { name: (b, c) => `Soirée de lancement ${b} — ${c}`, type: "EVENEMENT", offset: 32, days: 1, lines: [["LIEU", "Salle", 15000], ["TRAITEUR", "Cocktail", 12000], ["CACHET", "Intervenant", 5000], ["ECHANTILLONS", "Kits de découverte", 6000]] },
  { name: (b) => `Relations presse ${b} — dossier de rentrée`, type: "RP", offset: 40, days: 15, lines: [["AGENCE", "Attachée de presse", 9000]] },
  { name: (b, c) => `Collaboration dermatologue ${b} — ${c}`, type: "COLLABORATION", offset: 55, days: 1, lines: [["CACHET", "Cachet expert", 7000]] },
  { name: (b, c) => `Goodies de fin d'année ${b} — ${c}`, type: "GOODIES", offset: 70, days: 5, lines: [["GOODIES", "Tote bags et calendriers", 5500]] },
  { name: (b, c) => `Vitrine ${b} — ${c}`, type: "PLV", offset: 90, days: 28, lines: [["IMPRESSION", "Vitrophanie", 1500]] },
];

export async function seedActivationDemo(): Promise<number> {
  const seed = { v: 7 };
  const now = today();
  const [brands, products, clients, users, statuses, types, costItems, cats] = await Promise.all([
    db.execute<{ id: string; name: string }>(sql`select id, name from brands where active order by name`),
    db.execute<{ id: string; name: string; brand_id: string }>(sql`select id, name, brand_id from products where active and brand_id is not null order by name`),
    db.execute<{ id: string; name: string; city: string | null }>(sql`select id, name, city from clients where active order by name`),
    db.execute<{ id: string; name: string; email: string }>(sql`select id, name, email from users where active order by name`),
    db.execute<{ key: string; awaiting: boolean; validated: boolean; running: boolean; done: boolean; measured: boolean; archived: boolean; sort: number }>(sql`select key, awaiting_validation as awaiting, is_validated as validated, is_running as running, is_done as done, is_measured as measured, is_archived as archived, sort from activation_statuses where active order by sort`),
    db.execute<{ key: string; default_checklist: string[] }>(sql`select key, default_checklist from activation_types where active`),
    db.execute<{ key: string }>(sql`select key from activation_cost_items where active`),
    db.execute<{ key: string }>(sql`select key from inventory_categories where active`),
  ]);
  if (!brands.rows.length || !statuses.rows.length) return 0;
  const byEmail = (frag: string) => users.rows.find((u) => u.email.toLowerCase().startsWith(frag));
  const dg = byEmail("hicham") ?? users.rows[0];
  const team = [byEmail("nasr"), byEmail("oumaima"), byEmail("demzin")].filter((u): u is { id: string; name: string; email: string } => !!u);
  const pilots = team.length ? team : users.rows.slice(0, 3);
  const st = statuses.rows;
  const first = st[0].key;
  const key = (f: (s: (typeof st)[number]) => boolean) => st.find(f)?.key ?? first;
  const S = {
    idea: first, proposed: key((s) => s.awaiting), validated: key((s) => s.validated && !s.running && !s.done && !s.archived),
    prep: st.filter((s) => s.validated && !s.running && !s.done && !s.archived)[1]?.key ?? key((s) => s.validated && !s.running && !s.done),
    running: key((s) => s.running), done: key((s) => s.done && !s.measured), measured: key((s) => s.measured && !s.archived), archived: key((s) => s.archived),
  };
  const validCost = new Set(costItems.rows.map((c) => c.key));
  const prodOf = new Map<string, { id: string; name: string }[]>();
  for (const p of products.rows) (prodOf.get(p.brand_id) ?? prodOf.set(p.brand_id, []).get(p.brand_id)!).push(p);
  const clientsIn = (city: string) => clients.rows.filter((c) => (c.city ?? "").toLowerCase() === city.toLowerCase());

  /* Inventaire de démo : deux ou trois articles par marque principale. */
  const catKeys = new Set(cats.rows.map((c) => c.key));
  const cat = (k: string) => (catKeys.has(k) ? k : cats.rows[0]?.key ?? "PLV");
  const items: { id: string; brandId: string; categoryKey: string }[] = [];
  for (const b of brands.rows.slice(0, 5)) {
    for (const [name, c, cost, qty] of [[`Présentoir comptoir ${b.name}`, "PLV", 180, 30], [`Minidoses ${b.name} 3 ml`, "ECHANTILLON", 6.5, 800], [`Tote bag ${b.name}`, "GOODIE", 22, 150]] as const) {
      const [row] = await db.insert(inventoryItems).values({ name, categoryKey: cat(c), brandId: b.id, unit: "pièce", unitCost: String(cost), alertThreshold: Math.round(qty / 8), location: "Réserve Casablanca", notes: `${DEMO_TAG} Article de démonstration.` }).onConflictDoNothing().returning({ id: inventoryItems.id });
      if (!row) continue;
      await recordMovement({ itemId: row.id, type: "ENTREE", quantity: qty, unitCost: cost, date: iso(addDays(now, -90)), reason: "Inventaire initial (démo)", createdById: dg?.id });
      items.push({ id: row.id, brandId: b.id, categoryKey: cat(c) });
    }
  }

  let n = 0;
  for (let i = 0; i < PLANS.length; i++) {
    const plan = PLANS[i];
    const brand = brands.rows[i % brands.rows.length];
    const city = CITIES[i % CITIES.length];
    const date = addDays(now, plan.offset);
    const end = addDays(date, plan.days - 1);
    const pilot = pilots[i % pilots.length];
    const status = plan.done ? (plan.offset < -60 ? S.archived : plan.offset < -25 ? S.measured : S.done)
      : plan.offset < 0 ? S.running : plan.offset < 5 ? S.prep : plan.offset < 20 ? S.validated : i % 2 === 0 ? S.proposed : S.idea;
    const type = types.rows.find((t) => t.key === plan.type) ? plan.type : (types.rows[0]?.key ?? "AUTRE");
    const withResults = !!plan.results;
    const [a] = await db.insert(activations).values({
      name: plan.name(brand.name, city), type, status, brandId: brand.id, city, date: iso(date), endDate: plan.days > 1 ? iso(end) : null, prepDate: iso(addDays(date, -Math.max(3, Math.round(plan.days / 2)))),
      responsibleId: pilot?.id ?? null, createdById: dg?.id ?? null, validatorId: null,
      objectiveKey: plan.type === "SAMPLING" ? "RECRUTEMENT" : plan.type === "PLV" || plan.type === "OPERATION_PHARMACIE" ? "SELL_OUT" : plan.type === "SALON" || plan.type === "RP" ? "NOTORIETE" : "LANCEMENT",
      targetKey: plan.type === "SALON" || plan.type === "COLLABORATION" ? "PRESCRIPTEURS" : plan.type === "SAMPLING" || plan.type === "PLV" ? "CONSOMMATEURS" : "PHARMACIENS",
      description: `${plan.type === "EVENEMENT" ? "Présentation de la gamme aux pharmaciens de la ville." : plan.type === "SAMPLING" ? "Distribution d'échantillons au comptoir avec fiche conseil." : plan.type === "PLV" ? "Mise en avant vitrine et comptoir pendant quatre semaines." : "Activation hors digital pilotée par l'équipe marketing."}`,
      notes: `${DEMO_TAG} Activation de démonstration.`,
      ...(withResults ? { ...plan.results, ordersAmount: plan.results?.ordersAmount != null ? String(plan.results.ordersAmount) : null, results: plan.note ?? null, resultsAt: addDays(end, 2), attributedRevenue: plan.results?.ordersAmount ? String(plan.results.ordersAmount) : null } : {}),
      validatedAt: [S.validated, S.prep, S.running, S.done, S.measured, S.archived].includes(status) ? addDays(date, -15) : null,
      measuredAt: [S.measured, S.archived].includes(status) ? addDays(end, 12) : null,
    }).returning({ id: activations.id });
    n++;
    await db.insert(activationBrands).values({ activationId: a.id, brandId: brand.id }).onConflictDoNothing();
    const prods = (prodOf.get(brand.id) ?? []).slice(0, 2);
    if (prods.length) { await db.insert(activationProducts).values(prods.map((p) => ({ activationId: a.id, productId: p.id }))).onConflictDoNothing(); await db.update(activations).set({ productId: prods[0].id }).where(sql`id = ${a.id}::uuid`); }
    const cls = clientsIn(city).slice(0, plan.type === "SALON" || plan.type === "RP" || plan.type === "SPONSORING" ? 0 : plan.type === "OPERATION_PHARMACIE" ? 6 : 3);
    if (cls.length) { await db.insert(activationClients).values(cls.map((c) => ({ activationId: a.id, clientId: c.id }))).onConflictDoNothing(); await db.update(activations).set({ clientId: cls[0].id }).where(sql`id = ${a.id}::uuid`); }
    // Lignes budgétaires : engagé dès validation, dépensé (facture ±5 %) quand c'est fini.
    const engaged = status !== S.idea && status !== S.proposed;
    await db.insert(activationBudgetLines).values(plan.lines.filter((l) => validCost.has(l[0])).map(([costItemKey, label, planned], j) => ({
      activationId: a.id, costItemKey, label, brandId: brand.id, planned: String(planned), sort: j,
      committed: engaged ? String(Math.round(planned * (0.85 + rand(seed) * 0.17))) : "0",
      spent: plan.done ? String(Math.round(planned * (0.88 + rand(seed) * 0.15))) : "0",
      supplier: engaged ? pick(seed, ["Atlas Événements", "Imprimerie Al Manar", "Traiteur Dar Lamia", "Casa Print", "Studio Nadir"]) : null,
    })));
    // Checklist du type : tout coché si fini, partiellement sinon.
    const checklist = types.rows.find((t) => t.key === type)?.default_checklist ?? [];
    if (checklist.length) await db.insert(activationChecklistItems).values(checklist.map((label, j) => ({ activationId: a.id, label, sort: j, done: plan.done || (engaged && j < Math.ceil(checklist.length * (plan.offset < 5 ? 0.6 : 0.3))), doneById: pilot?.id ?? null, doneAt: plan.done ? addDays(date, -1) : null })));
    // Historique : création par le DG, proposition par le pilote, validation par le DG, étape courante.
    const hist: (typeof activationStatusHistory.$inferInsert)[] = [{ activationId: a.id, fromStatus: null, toStatus: first, userId: dg?.id ?? null, comment: `${DEMO_TAG} Création`, createdAt: addDays(date, -30) }];
    if (status !== S.idea) hist.push({ activationId: a.id, fromStatus: first, toStatus: S.proposed, userId: pilot?.id ?? null, comment: null, createdAt: addDays(date, -25) });
    if (engaged) hist.push({ activationId: a.id, fromStatus: S.proposed, toStatus: S.validated, userId: dg?.id ?? null, comment: i % 3 === 0 ? "OK pour le budget, tenir le prévu." : null, createdAt: addDays(date, -15) });
    if (engaged && status !== S.validated) hist.push({ activationId: a.id, fromStatus: S.validated, toStatus: status, userId: pilot?.id ?? null, comment: null, createdAt: plan.done ? addDays(end, 1) : addDays(now, -1) });
    await db.insert(activationStatusHistory).values(hist);
    if (i % 4 === 1) await db.insert(activationComments).values({ activationId: a.id, userId: pilot?.id ?? null, body: `${DEMO_TAG} Le pharmacien confirme la date, PLV à livrer la veille.` });
    // Matériel consommé sur les activations lancées : sortie réelle de l'inventaire de démo.
    if (engaged && status !== S.validated) {
      const mine = items.filter((it) => it.brandId === brand.id && (plan.type === "SAMPLING" ? it.categoryKey === cat("ECHANTILLON") : plan.type === "GOODIES" ? it.categoryKey === cat("GOODIE") : it.categoryKey === cat("PLV")));
      const it = mine[0] ?? items.find((x) => x.brandId === brand.id);
      if (it) { try { await consumeMaterial({ activationId: a.id, itemId: it.id, quantity: plan.type === "SAMPLING" ? 120 : 4, date: iso(date), userId: pilot?.id ?? dg?.id ?? "" }); } catch { /* stock insuffisant : on passe */ } }
    }
    await syncActivationExpenses(a.id);
  }
  // Le DG est validateur de toutes les marques (démo), comme pour le planning.
  if (dg) await db.insert(brandValidators).values(brands.rows.map((b) => ({ brandId: b.id, userId: dg.id }))).onConflictDoNothing();
  return n;
}

export async function purgeActivationDemo(): Promise<number> {
  const r = await db.execute<{ n: number }>(sql`
    with a as (select id from activations where notes like ${DEMO_TAG + "%"}),
    e as (delete from marketing_expenses where activation_id in (select id from a) and activation_ref is not null),
    t as (update tasks set status = 'CANCELLED' where entity_type = 'activation' and entity_id in (select id from a) and status in ('TODO','IN_PROGRESS')),
    nt as (delete from notifications where entity_type = 'activation' and entity_id in (select id from a)),
    d as (delete from activations where id in (select id from a) returning 1)
    select count(*)::int as n from d`);
  await db.execute(sql`delete from inventory_items where notes like ${DEMO_TAG + "%"}`);
  return r.rows[0]?.n ?? 0;
}
