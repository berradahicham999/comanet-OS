/**
 * Test d'intégration du CRM commercial sur une VRAIE base Postgres (hors `npm test`) : portefeuille et
 * fréquence (audit), reprise depuis les droits, chrono de visite (Démarrer, idempotence, une seule visite en
 * cours, Terminer, hors connexion, non effectuée, clôture automatique), position du point de vente proposée puis
 * validée, contrôle de présence, journal en écriture seule, correction tracée, compte rendu et prochaine visite,
 * contacts, progression plafonnée, objectifs client (sans toucher aux objectifs de marque), commande déduite
 * pendant la visite, fusion de fiches, règles Action Center, imports.
 *
 * Crée ses propres comptes et clients (préfixe « CRM-IT ») et écrit dans un journal non effaçable : base jetable
 * uniquement (PGlite local), jamais la production.
 *
 *   CRM_IT=1 DATABASE_URL=postgresql://…/base_jetable node --conditions=react-server --import tsx scripts/crm-integration.ts
 */
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

const url = process.env.DATABASE_URL ?? "";
if (process.env.CRM_IT !== "1" || /supabase|pooler/i.test(url)) {
  console.error("Refusé : ce test écrit dans le journal des visites (non effaçable). Lancez-le sur une base jetable avec CRM_IT=1.");
  process.exit(1);
}

async function main() {
  const { db } = await import("@/db");
  const visits = await import("@/lib/crm/visits");
  const portfolio = await import("@/lib/crm/portfolio");
  const objectives = await import("@/lib/crm/objectives");
  const { clientTimeline } = await import("@/lib/crm/timeline");
  const { clientVisitBrief } = await import("@/lib/crm/intelligence");
  const { mergeClients } = await import("@/lib/gestion/clients");
  const { crmRules } = await import("@/lib/rules/crm-rules");
  const { runImport } = await import("@/lib/import/run");
  const { annualObjective } = await import("@/lib/analytics");
  const { DEFAULT_SETTINGS } = await import("@/lib/settings");
  const { iso, today } = await import("@/lib/format");
  const one = async <T,>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows[0] as T;
  const id = () => crypto.randomUUID();
  const settings = DEFAULT_SETTINGS;
  const S = settings.crm;
  const t = iso(today());
  const month = t.slice(0, 7);
  const tag = Date.now().toString(36);

  // Comptes : une commerciale (portée « les siens »), son manager, une seconde commerciale par ville.
  const mkUser = async (name: string, managerId: string | null, scope: "OWN" | "ALL", modules: string[]) => {
    const u = await one<{ id: string }>(sql`insert into users (name, email, password_hash, manager_id, city) values (${name}, ${`${name.toLowerCase().replace(/\W/g, "")}.${tag}@crm-it.test`}, 'x', ${managerId}::uuid, 'CASABLANCA') returning id`);
    await db.execute(sql`insert into user_scope (user_id, scope) values (${u.id}::uuid, ${scope}::user_data_scope)`);
    for (const m of modules) await db.execute(sql`insert into user_permissions (user_id, module, can_view, can_create, can_edit, can_validate) values (${u.id}::uuid, ${m}, true, true, ${scope === "ALL"}, ${scope === "ALL"})`);
    return u.id;
  };
  const managerId = await mkUser(`CRM-IT Manager ${tag}`, null, "ALL", ["clients", "commandes"]);
  const salihaId = await mkUser(`CRM-IT Saliha ${tag}`, managerId, "OWN", ["clients", "commandes"]);
  const hananeId = await mkUser(`CRM-IT Hanane ${tag}`, managerId, "OWN", ["clients", "commandes"]);
  const saliha = { id: salihaId, name: "Saliha" };
  const manager = { id: managerId, name: "Manager" };

  // Clients : 3 à Casablanca, 1 à Rabat, 1 doublon à fusionner, 1 à reprendre par la ville.
  const mkClient = async (name: string, city: string, type = "PHARMACIE") =>
    (await one<{ id: string }>(sql`insert into clients (name, name_key, city, type) values (${name}, ${`${name.toUpperCase()} ${tag}`}, ${city}, ${type}::client_type) returning id`)).id;
  const c1 = await mkClient(`CRM-IT Pharmacie Atlas`, "CASABLANCA");
  const c2 = await mkClient(`CRM-IT Pharmacie Anfa`, "CASABLANCA");
  const c3 = await mkClient(`CRM-IT Para Maarif`, "CASABLANCA", "PARAPHARMACIE");
  const c4 = await mkClient(`CRM-IT Pharmacie Agdal`, "RABAT");
  const c5 = await mkClient(`CRM-IT Pharmacie Atlas bis`, "CASABLANCA");
  const c6 = await mkClient(`CRM-IT Grossiste Tanger`, "TANGER", "GROSSISTE");

  // 1. Portefeuille et fréquence, tracés.
  assert.equal(await portfolio.assignAccountManager(manager, [c1, c2, c3, c4], salihaId), 4);
  assert.equal(await portfolio.assignAccountManager(manager, [c1], salihaId), 0, "aucun changement = aucune trace");
  assert.equal(await portfolio.setVisitFrequency(manager, [c1, c2], 1), 2);
  assert.equal(await portfolio.applyDefaultFrequency(manager, [c1, c3, c4], S), 2, "c1 garde sa fréquence saisie");
  const f3 = await one<{ f: number }>(sql`select visit_frequency_monthly as f from clients where id = ${c3}::uuid`);
  assert.equal(f3.f, S.defaultFrequencyByType.PARAPHARMACIE);
  const audits = await one<{ n: number }>(sql`select count(*)::int as n from audit_logs where entity = 'client' and entity_id in (${c1}::uuid, ${c2}::uuid, ${c3}::uuid, ${c4}::uuid)`);
  assert.equal(audits.n, 4 + 2 + 2);
  await assert.rejects(() => portfolio.setVisitFrequency(manager, [c1], 40));
  console.log("✓ portefeuille confié, fréquences (saisie et par type, sans écrasement), chaque changement tracé");

  // 2. Reprise depuis les droits : client assigné nommément l'emporte sur la ville.
  await db.execute(sql`insert into user_client_assignments (user_id, client_id) values (${hananeId}::uuid, ${c6}::uuid)`);
  await db.execute(sql`insert into user_city_assignments (user_id, city) values (${hananeId}::uuid, 'Casablanca')`);
  const props = await portfolio.managerProposals();
  const p6 = props.find((p) => p.clientId === c6);
  assert.deepEqual(p6?.candidates.map((c) => [c.id, c.via]), [[hananeId, "client"]]);
  assert.ok(props.some((p) => p.clientId === c5 && p.candidates[0].via === "ville"), "c5 proposé par la ville");
  assert.equal(await portfolio.applyManagerProposals(manager, [c6]), 1);
  assert.equal((await one<{ m: string }>(sql`select account_manager_id as m from clients where id = ${c6}::uuid`)).m, hananeId);
  console.log("✓ reprise : proposition depuis les clients assignés puis les villes, appliquée seulement sur demande");

  // 3. Chrono : Démarrer (position du point de vente proposée), idempotence, une seule visite en cours.
  const PDV = { lat: 33.589886, lng: -7.603869 };
  const north = (m: number) => ({ lat: PDV.lat + m / 111_195, lng: PDV.lng });
  const scope = [c1, c2, c3, c4];
  const o = { scopeClientIds: scope, settings: S };
  const s1 = id();
  const ago15 = new Date(Date.now() - 15 * 60_000).toISOString();
  const r1 = await visits.recordClientVisitAction(saliha, { clientEventId: s1, type: "START", clientId: c1, ...PDV, accuracyM: 12, deviceTime: ago15, sentAt: new Date().toISOString() }, o);
  assert.ok(r1.ok);
  const v1 = r1.visitId;
  assert.deepEqual(await one(sql`select gps_source, gps_status from clients where id = ${c1}::uuid`), { gps_source: "PREMIERE_VISITE", gps_status: "A_CONFIRMER" });
  const dup = await visits.recordClientVisitAction(saliha, { clientEventId: s1, type: "START", clientId: c1, ...PDV }, o);
  assert.ok(dup.ok && dup.duplicate && dup.visitId === v1);
  const busy = await visits.recordClientVisitAction(saliha, { clientEventId: id(), type: "START", clientId: c2, ...PDV }, o);
  assert.ok(!busy.ok && busy.code === "RUNNING");
  const forbidden = await visits.recordClientVisitAction(saliha, { clientEventId: id(), type: "NON_EFFECTUEE", clientId: c6, ...PDV }, o);
  assert.ok(!forbidden.ok && forbidden.code === "FORBIDDEN", "client hors portefeuille et hors portée");
  console.log("✓ Démarrer : visite en cours, point de vente proposé ; doublon ignoré ; un seul Démarrer ; hors portée refusé");

  // 4. Terminer : effectuée, durée, compte rendu à compléter, à vérifier tant que le point de vente n'est pas validé.
  const r2 = await visits.recordClientVisitAction(saliha, { clientEventId: id(), type: "STOP", startRef: s1, ...north(20), accuracyM: 10 }, o);
  assert.ok(r2.ok);
  let v = await one<{ status: string; report_status: string; verification_status: string; verification_reasons: string[]; duration_minutes: number }>(sql`select status, report_status, verification_status, verification_reasons, duration_minutes from client_visits where id = ${v1}::uuid`);
  assert.equal(v.status, "EFFECTUEE");
  assert.equal(v.report_status, "A_COMPLETER");
  assert.equal(v.duration_minutes, 15);
  assert.equal(v.verification_status, "A_VERIFIER");
  assert.ok(v.verification_reasons.includes("Position du point de vente pas encore validée."), v.verification_reasons.join(" | "));
  const val = await visits.validatePointOfSale(manager, c1, null);
  assert.ok(val.ok);
  v = await one(sql`select status, report_status, verification_status, verification_reasons, duration_minutes from client_visits where id = ${v1}::uuid`);
  assert.equal(v.verification_status, "VERIFIEE", JSON.stringify(v));
  console.log("✓ Terminer : effectuée en 15 min ; point de vente validé → visite « vérifiée »");

  // 5. Visite à 2 km du point de vente validé → à vérifier, motif « du point de vente ».
  await db.execute(sql`update clients set gps_lat = ${PDV.lat.toFixed(6)}, gps_lng = ${PDV.lng.toFixed(6)}, gps_status = 'VALIDEE', gps_source = 'MANUELLE' where id = ${c2}::uuid`);
  const s5 = id();
  const r5 = await visits.recordClientVisitAction(saliha, { clientEventId: s5, type: "START", clientId: c2, ...north(2000), accuracyM: 10 }, o);
  assert.ok(r5.ok);
  await visits.recordClientVisitAction(saliha, { clientEventId: id(), type: "STOP", startRef: s5, ...north(2000), accuracyM: 10 }, o);
  const v5 = await one<{ verification_status: string; verification_reasons: string[] }>(sql`select verification_status, verification_reasons from client_visits where id = ${r5.ok ? r5.visitId : ""}::uuid`);
  assert.equal(v5.verification_status, "A_VERIFIER");
  assert.ok(v5.verification_reasons.some((m) => m.startsWith("Démarrage à 2,0 km du point de vente")), v5.verification_reasons.join(" | "));
  console.log("✓ démarrage à 2 km :", v5.verification_reasons[0]);

  // 6. Hors connexion : la fin arrive avant le démarrage, puis tout passe en différé.
  const s6 = id();
  const stop6 = id();
  const wait = await visits.recordClientVisitAction(saliha, { clientEventId: stop6, type: "STOP", startRef: s6, ...PDV }, o);
  assert.ok(!wait.ok && wait.code === "WAIT_START");
  const past = new Date(Date.now() - 2 * 3_600_000);
  const r6 = await visits.recordClientVisitAction(saliha, { clientEventId: s6, type: "START", clientId: c3, ...PDV, accuracyM: 20, deviceTime: past.toISOString(), sentAt: new Date().toISOString(), queued: true }, o);
  assert.ok(r6.ok);
  assert.ok((await visits.recordClientVisitAction(saliha, { clientEventId: stop6, type: "STOP", startRef: s6, ...PDV, accuracyM: 20, deviceTime: new Date(past.getTime() + 20 * 60_000).toISOString(), sentAt: new Date().toISOString(), queued: true }, o)).ok);
  const v6 = await one<{ synced_late: boolean; duration_minutes: number }>(sql`select synced_late, duration_minutes from client_visits where id = ${r6.ok ? r6.visitId : ""}::uuid`);
  assert.deepEqual(v6, { synced_late: true, duration_minutes: 20 });
  console.log("✓ hors connexion : file rejouée dans le désordre, heures du téléphone recalées, marquée différée");

  // 7. Non effectuée directement (fermé) ; clôture automatique d'une visite oubliée.
  const nd = await visits.recordClientVisitAction(saliha, { clientEventId: id(), type: "NON_EFFECTUEE", clientId: c4, ...PDV, reason: "Point de vente fermé" }, o);
  assert.ok(nd.ok);
  const s8 = id();
  const r8 = await visits.recordClientVisitAction(saliha, { clientEventId: s8, type: "START", clientId: c4, ...PDV, deviceTime: new Date(Date.now() - (S.autoCloseHours + 1) * 3_600_000).toISOString(), sentAt: new Date().toISOString() }, o);
  assert.ok(r8.ok);
  assert.ok((await visits.autoCloseStaleClientVisits()) >= 1);
  const v8 = await one<{ auto_closed: boolean; status: string; duration_minutes: number | null }>(sql`select auto_closed, status, duration_minutes from client_visits where id = ${r8.ok ? r8.visitId : ""}::uuid`);
  assert.deepEqual(v8, { auto_closed: true, status: "EFFECTUEE", duration_minutes: null });
  console.log("✓ non effectuée avec motif ; visite oubliée close automatiquement (durée non mesurée)");

  // 8. Journal en écriture seule et un événement porte exactement une visite.
  await assert.rejects(() => db.execute(sql`update visit_events set lat = 0 where client_visit_id = ${v1}::uuid`));
  await assert.rejects(() => db.execute(sql`delete from visit_events where client_visit_id = ${v1}::uuid`));
  await assert.rejects(() => db.execute(sql`insert into visit_events (type, client_event_id) values ('START', ${id()})`));
  console.log("✓ journal en écriture seule ; un événement sans visite est refusé");

  // 9. Correction tracée (motif obligatoire) ; compte rendu planifie la prochaine visite.
  assert.equal((await visits.correctClientVisit(manager, { visitId: v1, reason: "" })).ok, false);
  const corr = await visits.correctClientVisit(manager, { visitId: r5.ok ? r5.visitId : "", reason: "Deuxième adresse du client", forcedStatus: "VERIFIEE" });
  assert.ok(corr.ok);
  assert.equal((await one<{ s: string }>(sql`select verification_status as s from client_visits where id = ${r5.ok ? r5.visitId : ""}::uuid`)).s, "VERIFIEE");
  const next = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  await visits.saveClientVisitReport(saliha, v1, { result: "Commande prise", nextAction: "Présenter la nouveauté", nextVisitDate: next }, { manage: false });
  assert.equal((await one<{ r: string }>(sql`select report_status as r from client_visits where id = ${v1}::uuid`)).r, "VALIDE");
  assert.ok(await one(sql`select 1 from client_visits where client_id = ${c1}::uuid and status = 'PLANIFIEE' and date = ${next}::date`), "prochaine visite planifiée");
  await assert.rejects(() => visits.saveClientVisitReport({ id: hananeId, name: "Hanane" }, v1, { result: "x" }, { manage: false }), /pas la vôtre/);
  console.log("✓ correction motivée et tracée ; compte rendu → prochaine visite planifiée ; pas de compte rendu sur la visite d'une autre");

  // 10. Contacts : appel noté ; une visite ne se saisit après coup que par un manager.
  await visits.logClientContact(saliha, { clientId: c2, kind: "APPEL", date: t, result: "Commande à venir" }, { manage: false });
  await assert.rejects(() => visits.logClientContact(saliha, { clientId: c2, kind: "VISITE", date: t }, { manage: false }), /Ma tournée/);
  const manual = await visits.logClientContact(manager, { clientId: c2, userId: salihaId, kind: "VISITE", date: t, result: "Ressaisie" }, { manage: true });
  assert.ok(await one(sql`select 1 from audit_logs where entity = 'client_visit' and entity_id = ${manual}::uuid`));
  console.log("✓ appel noté ; visite ressaisie réservée au manager, tracée");

  // 11. Progression plafonnée et par ville.
  const p = await portfolio.portfolioOf(salihaId, month, t, settings);
  // c1 (1/1), c2 (2 visites effectuées pour 1 attendue → 1), c3 (1/1), c4 (1 auto-close / 1).
  assert.equal(p.progress.expected, 1 + 1 + S.defaultFrequencyByType.PARAPHARMACIE + S.defaultFrequencyByType.PHARMACIE);
  assert.equal(p.progress.counted, 4);
  assert.ok(p.progress.done >= 5, "visites brutes au-delà de la fréquence");
  assert.deepEqual(p.byCity.map((c) => c.city).sort(), ["CASABLANCA", "RABAT"]);
  console.log(`✓ progression : ${p.progress.counted}/${p.progress.expected} (plafonnée, ${p.progress.done} visites brutes) · ${p.pace.label}`);

  // 12. Objectifs client : réalisé = sell-in HT du mois ; objectifs de marque intacts.
  const brand = await one<{ id: string }>(sql`insert into brands (name, slug) values (${`CRM-IT ${tag}`}, ${`crm-it-${tag}`}) returning id`);
  const product = await one<{ id: string }>(sql`insert into products (name, name_key, brand_id) values (${`CRM-IT Sérum ${tag}`}, ${`CRM-IT SERUM ${tag}`}, ${brand.id}::uuid) returning id`);
  await db.execute(sql`insert into sales (date, client_id, product_id, quantity, amount, line_hash, site) values (${t}::date, ${c1}::uuid, ${product.id}::uuid, 10, 4000, ${`crm-it-${tag}-1`}, 'COMANET')`);
  await db.execute(sql`insert into objectives (brand_id, product_id, year, month, amount) values (${brand.id}::uuid, null, ${Number(t.slice(0, 4))}, null, 500000)`);
  await objectives.saveClientObjective(manager, { clientId: c1, brandId: null, year: Number(t.slice(0, 4)), month: Number(t.slice(5, 7)), amount: 10000, units: null });
  await objectives.saveClientObjective(manager, { clientId: c1, brandId: brand.id, year: Number(t.slice(0, 4)), month: null, amount: 120000, units: null });
  const prog = await objectives.clientObjectiveProgress([c1], month, t, S);
  const st = prog.get(c1)!;
  assert.equal(st.global?.target, 10000);
  assert.equal(st.global?.realized, 4000);
  assert.equal(st.brands[0].target, 10000, "annuel ÷ 12");
  assert.equal(await annualObjective(Number(t.slice(0, 4)), brand.id), 500000, "l'objectif de la marque n'additionne pas les objectifs client");
  console.log("✓ objectifs client : réalisé 4 000 / 10 000, objectif marque client ramené au mois, objectif de marque intact");

  // 13. Commande déduite pendant la visite ; chronologie et fiche pré-visite.
  await db.execute(sql`insert into sales_documents (type, status, date, client_id, created_by_id, created_at) values ('COMMANDE', 'BROUILLON', ${t}::date, ${c1}::uuid, ${salihaId}::uuid, now() - interval '5 minutes')`);
  const out = (await visits.visitOutcomes([v1], S)).get(v1)!;
  assert.equal(out.orders.length, 1);
  const tl = await clientTimeline(c1, {});
  assert.ok(tl.some((x) => x.kind === "VISITE") && tl.some((x) => x.kind === "VENTE"));
  assert.ok(!tl.some((x) => x.kind === "PIECE"), "un brouillon n'entre pas dans la chronologie");
  const brief = await clientVisitBrief(c1, settings);
  assert.equal(brief?.lastVisit?.result, "Commande prise");
  console.log("✓ commande saisie pendant la visite rattachée ; chronologie (visite, vente, sans brouillon) ; fiche pré-visite");

  // 14. Fusion : visites et objectifs passent sur la fiche gardée.
  await objectives.saveClientObjective(manager, { clientId: c5, brandId: null, year: 2031, month: 1, amount: 5000, units: null });
  await db.execute(sql`insert into client_visits (client_id, user_id, date, status, kind) values (${c5}::uuid, ${salihaId}::uuid, ${t}::date, 'PLANIFIEE', 'VISITE')`);
  await mergeClients(c1, c5, manager);
  assert.ok(await one(sql`select 1 from objectives where client_id = ${c1}::uuid and year = 2031`));
  assert.equal((await one<{ n: number }>(sql`select count(*)::int as n from client_visits where client_id = ${c5}::uuid`)).n, 0);
  console.log("✓ fusion de fiches : visites et objectifs repris sur la fiche gardée");

  // 15. Règles : clients prévus non visités (après le jour d'alerte), visites à vérifier, filtrées par commerciale.
  const late = new Date(`${month}-25T12:00:00Z`);
  const ctx = { settings, today: late, now: late, stocks: [], clients: [] };
  await portfolio.setVisitFrequency(manager, [c6], 2);
  const recs = (await Promise.all(crmRules.map((r) => r.run(ctx)))).flat();
  assert.ok(recs.some((r) => r.rule === "crm-client-non-visite" && r.suggestedAssigneeId === hananeId), "Hanane : Tanger jamais visité");
  assert.ok(recs.some((r) => r.rule === "crm-visites-non-cloturees" && r.crmUserId === salihaId), "clôture automatique signalée, réservée au manager");
  console.log(`✓ règles : ${recs.length} recommandation(s) — ${[...new Set(recs.map((r) => r.rule))].join(", ")}`);

  // 16. Imports : commercial attitré et fréquence ; objectif client par la colonne Client (rapprochement par code).
  await db.execute(sql`update clients set code = ${`IT${tag}4`} where id = ${c4}::uuid`);
  await db.execute(sql`update clients set code = ${`IT${tag}3`} where id = ${c3}::uuid`);
  await db.execute(sql`update clients set code = ${`IT${tag}2`} where id = ${c2}::uuid`);
  const imp = await runImport({
    type: "CLIENTS", fileName: "crm-it.xlsx", mapping: { name: "Client", code: "Code", accountManager: "Commercial attitré", visitFrequency: "Fréquence" },
    rows: [{ Client: "CRM-IT Pharmacie Agdal", Code: `IT${tag}4`, "Commercial attitré": `CRM-IT Hanane ${tag}`, Fréquence: 3 }, { Client: "CRM-IT Para Maarif", Code: `IT${tag}3`, "Commercial attitré": "Inconnu", Fréquence: "" }],
  });
  assert.deepEqual(await one(sql`select account_manager_id as m, visit_frequency_monthly as f from clients where id = ${c4}::uuid`), { m: hananeId, f: 3 });
  assert.ok(imp.warnings.some((w) => /Inconnu/.test(w)));
  assert.equal((await one<{ f: number }>(sql`select visit_frequency_monthly as f from clients where id = ${c3}::uuid`)).f, S.defaultFrequencyByType.PARAPHARMACIE, "cellule vide = inchangé");
  await runImport({ type: "OBJECTIVES", fileName: "obj-it.xlsx", mapping: { client: "Client", amount: "CA", month: "Mois", year: "Année" }, rows: [{ Client: `IT${tag}2`, CA: 7000, Mois: 2, Année: 2031 }] });
  assert.ok(await one(sql`select 1 from objectives where client_id = ${c2}::uuid and year = 2031 and month = 2 and amount = 7000`));
  console.log("✓ imports : commercial et fréquence (inconnu signalé, vide sans effet) ; objectif client par la colonne Client");

  console.log("\nCRM commercial : intégration OK");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
