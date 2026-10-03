/**
 * Test d'intégration du Médical v2 sur une VRAIE base Postgres (hors `npm test`) : chrono de visite
 * (Démarrer, Terminer, idempotence, une seule visite en cours, hors connexion en différé, médecin absent,
 * clôture automatique), position du cabinet proposée puis validée, statut de contrôle (visite à 2 km),
 * journal en écriture seule, correction tracée, compte rendu sans toucher aux heures, import des
 * ordonnances (rapprochement, colonne patient refusée, idempotence, annulation), potentiel et
 * recommandations.
 *
 * Écrit dans un journal non effaçable : base jetable uniquement (PGlite local), jamais la production.
 * Attend les données de démo médicales (une déléguée avec ses secteurs et au moins 6 médecins).
 *
 *   MEDICAL_IT=1 DATABASE_URL=postgresql://…/base_jetable node --conditions=react-server --import tsx scripts/medical-integration.ts
 */
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

const url = process.env.DATABASE_URL ?? "";
if (process.env.MEDICAL_IT !== "1" || /supabase|pooler/i.test(url)) {
  console.error("Refusé : ce test écrit dans le journal des visites (non effaçable). Lancez-le sur une base jetable avec MEDICAL_IT=1.");
  process.exit(1);
}

async function main() {
  const { db } = await import("@/db");
  const chrono = await import("@/lib/medical/chrono");
  const { saveVisitReport } = await import("@/lib/medical/visits");
  const { runImport } = await import("@/lib/import/run");
  const { rollbackRows } = await import("@/lib/import/rollback");
  const { doctorPrescriptionProfile } = await import("@/lib/medical/prescriptions");
  const { DEFAULT_MEDICAL_FIELD } = await import("@/lib/settings");
  const one = async <T,>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows[0] as T;
  const S = DEFAULT_MEDICAL_FIELD;

  const del = await one<{ id: string; name: string }>(sql`
    select u.id, u.name from users u join medical_delegates md on md.user_id = u.id
    join medical_delegate_sectors ds on ds.delegate_id = md.id limit 1`);
  assert.ok(del, "Une déléguée avec au moins un secteur (données de démo).");
  const actor = { id: del.id, name: del.name };
  const docs = (await db.execute<{ id: string; first_name: string; last_name: string }>(sql`
    select d.id, d.first_name, d.last_name from doctors d join medical_delegate_sectors ds on ds.sector_id = d.sector_id
    join medical_delegates md on md.id = ds.delegate_id where md.user_id = ${del.id}::uuid and d.gps_lat is null order by d.last_name limit 6`)).rows;
  assert.ok(docs.length >= 6, "Au moins 6 médecins sans position dans les secteurs de la déléguée.");
  const [d1, d2, d3, d4] = docs;
  const CAB = { lat: 33.589886, lng: -7.603869 };
  const north = (m: number) => ({ lat: CAB.lat + m / 111_195, lng: CAB.lng });
  const id = () => crypto.randomUUID();
  const opts = { ownOnly: true, settings: S };

  // 1. Démarrer : visite EN_COURS, cabinet proposé (à valider).
  const s1 = id();
  // Démarrage 12 minutes plus tôt sur le téléphone (envoyé maintenant) : l'heure retenue est celle de l'action.
  const ago12 = new Date(Date.now() - 12 * 60_000).toISOString();
  const r1 = await chrono.recordAction(actor, { clientEventId: s1, type: "START", doctorId: d1.id, ...CAB, accuracyM: 12, deviceTime: ago12, sentAt: new Date().toISOString() }, opts);
  assert.ok(r1.ok);
  const v1 = r1.visitId;
  let v = await one<{ status: string; started_at: string | null; verification_status: string }>(sql`select status, started_at, verification_status from doctor_visits where id = ${v1}::uuid`);
  assert.equal(v.status, "EN_COURS");
  assert.ok(v.started_at);
  const cab1 = await one<{ gps_source: string; gps_status: string }>(sql`select gps_source, gps_status from doctors where id = ${d1.id}::uuid`);
  assert.deepEqual(cab1, { gps_source: "PREMIERE_VISITE", gps_status: "A_CONFIRMER" });
  console.log("✓ Démarrer : visite en cours, position du cabinet proposée");

  // 2. Idempotence et une seule visite en cours.
  const again = await chrono.recordAction(actor, { clientEventId: s1, type: "START", doctorId: d1.id, ...CAB }, opts);
  assert.ok(again.ok && again.duplicate && again.visitId === v1);
  const busy = await chrono.recordAction(actor, { clientEventId: id(), type: "START", doctorId: d2.id, ...CAB }, opts);
  assert.ok(!busy.ok && busy.code === "RUNNING");
  console.log("✓ même action renvoyée = aucun doublon ; un seul Démarrer à la fois");

  // 3. Terminer (heure de l'action rejouée 12 min plus tard) : durée, compte rendu à compléter.
  const stopRef = id();
  const r3 = await chrono.recordAction(actor, { clientEventId: stopRef, type: "STOP", startRef: s1, ...north(20), accuracyM: 15 }, opts);
  assert.ok(r3.ok);
  v = await one(sql`select status, report_status, verification_status, verification_reasons from doctor_visits where id = ${v1}::uuid`);
  assert.equal((v as unknown as { status: string }).status, "REALISEE");
  assert.equal((v as unknown as { report_status: string }).report_status, "A_COMPLETER");
  assert.equal(v.verification_status, "A_VERIFIER", "cabinet pas encore validé");
  console.log("✓ Terminer : réalisée, compte rendu à compléter, à vérifier tant que le cabinet n'est pas validé");

  // 4. Validation du cabinet par la direction → VERIFIEE.
  const admin = await one<{ id: string; name: string }>(sql`select id, name from users where role = 'ADMIN' order by created_at limit 1`);
  const val = await chrono.validateCabinet({ id: admin.id, name: admin.name }, d1.id, null);
  assert.ok(val.ok);
  v = await one(sql`select verification_status, verification_reasons, duration_minutes from doctor_visits where id = ${v1}::uuid`);
  assert.equal(v.verification_status, "VERIFIEE", JSON.stringify(v));
  assert.equal((v as unknown as { duration_minutes: number }).duration_minutes, 12);
  console.log("✓ cabinet validé : la visite passe « vérifiée »");

  // 5. Visite démarrée à 2 km du cabinet validé → A_VERIFIER avec le motif.
  await db.execute(sql`update doctors set gps_lat = ${CAB.lat.toFixed(6)}, gps_lng = ${CAB.lng.toFixed(6)}, gps_status = 'VALIDEE', gps_source = 'MANUELLE' where id = ${d2.id}::uuid`);
  const s5 = id();
  const r5 = await chrono.recordAction(actor, { clientEventId: s5, type: "START", doctorId: d2.id, ...north(2000), accuracyM: 10 }, opts);
  assert.ok(r5.ok);
  await chrono.recordAction(actor, { clientEventId: id(), type: "STOP", startRef: s5, ...north(2000), accuracyM: 10 }, opts);
  const v5 = await one<{ verification_status: string; verification_reasons: string[] }>(sql`select verification_status, verification_reasons from doctor_visits where id = ${r5.ok ? r5.visitId : ""}::uuid`);
  assert.equal(v5.verification_status, "A_VERIFIER");
  assert.ok(v5.verification_reasons.some((m) => m.startsWith("Démarrage à 2,0 km du cabinet")), v5.verification_reasons.join(" | "));
  console.log("✓ démarrage à 2 km :", v5.verification_reasons[0]);

  // 6. GPS refusé : la visite passe, NON_VERIFIEE.
  const s6 = id();
  const r6 = await chrono.recordAction(actor, { clientEventId: s6, type: "START", doctorId: d3.id, gpsError: "REFUSE" }, opts);
  assert.ok(r6.ok);
  await chrono.recordAction(actor, { clientEventId: id(), type: "STOP", startRef: s6, gpsError: "REFUSE" }, opts);
  const v6 = await one<{ verification_status: string; status: string }>(sql`select verification_status, status from doctor_visits where id = ${r6.ok ? r6.visitId : ""}::uuid`);
  assert.deepEqual(v6, { verification_status: "NON_VERIFIEE", status: "REALISEE" });
  console.log("✓ GPS refusé : visite enregistrée, « non vérifiée »");

  // 7. Hors connexion : la fin arrive avant le démarrage (file rejouée dans le désordre) puis tout passe, différé.
  const s7 = id();
  const stop7 = id();
  const past = new Date(Date.now() - 3 * 3_600_000);
  const wait = await chrono.recordAction(actor, { clientEventId: stop7, type: "STOP", startRef: s7, ...CAB }, opts);
  assert.ok(!wait.ok && wait.code === "WAIT_START");
  const r7 = await chrono.recordAction(actor, { clientEventId: s7, type: "START", doctorId: d4.id, ...CAB, accuracyM: 20, deviceTime: past.toISOString(), sentAt: new Date().toISOString(), queued: true }, opts);
  assert.ok(r7.ok);
  const r7b = await chrono.recordAction(actor, { clientEventId: stop7, type: "STOP", startRef: s7, ...CAB, accuracyM: 20, deviceTime: new Date(past.getTime() + 15 * 60_000).toISOString(), sentAt: new Date().toISOString(), queued: true }, opts);
  assert.ok(r7b.ok);
  const replay = await chrono.recordAction(actor, { clientEventId: stop7, type: "STOP", startRef: s7, ...CAB }, opts);
  assert.ok(replay.ok && replay.duplicate);
  const v7 = await one<{ synced_late: boolean; duration_minutes: number; n: number; verification_reasons: string[] }>(sql`
    select synced_late, duration_minutes, (select count(*)::int from visit_events where visit_id = v.id) as n, verification_reasons
    from doctor_visits v where id = ${r7.ok ? r7.visitId : ""}::uuid`);
  assert.equal(v7.synced_late, true);
  assert.equal(v7.duration_minutes, 15, "durée = heures du téléphone recalées, pas l'heure d'arrivée au serveur");
  assert.equal(v7.n, 2, "aucun doublon après rejeu");
  assert.ok(v7.verification_reasons.some((m) => m.includes("hors connexion")));
  console.log("✓ hors connexion : synchronisée en différé, durée réelle 15 min, sans doublon");

  // 8. Médecin absent sans démarrer.
  const r8 = await chrono.recordAction(actor, { clientEventId: id(), type: "NON_EFFECTUEE", doctorId: docs[4].id, reason: "Médecin absent", ...north(30), accuracyM: 9 }, opts);
  assert.ok(r8.ok);
  const v8 = await one<{ status: string; not_done_reason: string }>(sql`select status, not_done_reason from doctor_visits where id = ${r8.ok ? r8.visitId : ""}::uuid`);
  assert.deepEqual(v8, { status: "NON_EFFECTUEE", not_done_reason: "Médecin absent" });
  console.log("✓ visite non effectuée enregistrée avec position et motif");

  // 9. Clôture automatique d'une visite oubliée.
  const s9 = id();
  const r9 = await chrono.recordAction(actor, { clientEventId: s9, type: "START", doctorId: docs[5].id, ...CAB, accuracyM: 10 }, opts);
  assert.ok(r9.ok);
  const v9id = r9.ok ? r9.visitId : "";
  await db.execute(sql`update doctor_visits set started_at = now() - interval '4 hours' where id = ${v9id}::uuid`);
  const closed = await chrono.autoCloseStale();
  assert.ok(closed >= 1);
  const v9 = await one<{ auto_closed: boolean; status: string; duration_minutes: number | null; verification_status: string }>(sql`select auto_closed, status, duration_minutes, verification_status from doctor_visits where id = ${v9id}::uuid`);
  assert.deepEqual(v9, { auto_closed: true, status: "REALISEE", duration_minutes: null, verification_status: "A_VERIFIER" });
  console.log("✓ clôture automatique après 3 h : durée non mesurée, à vérifier");

  // 10. Journal en écriture seule.
  await assert.rejects(() => db.execute(sql`update visit_events set lat = 0 where visit_id = ${v1}::uuid`), (e: { message?: string; cause?: { message?: string } }) => /écriture seule/.test(`${e.message} ${e.cause?.message}`));
  await assert.rejects(() => db.execute(sql`delete from visit_events where visit_id = ${v1}::uuid`));
  console.log("✓ journal des visites : ni modification ni suppression");

  // 11. Compte rendu : ne touche ni heures ni durée ; échantillons sortis du stock de la déléguée.
  const prod = await one<{ id: string }>(sql`select id from products where active order by name limit 1`);
  const before = await one<{ started_at: string; ended_at: string; duration_minutes: number }>(sql`select started_at, ended_at, duration_minutes from doctor_visits where id = ${v1}::uuid`);
  const rep = await saveVisitReport(v1, { visitType: "VISITE", objective: null, result: "Intéressé", doctorInterest: "FORT", comment: null, nextAction: "Relancer", nextVisitDate: null, objections: "Prix", documentation: null, productIds: [prod.id], samples: [{ productId: prod.id, quantity: 2 }], createdById: del.id });
  assert.ok(rep.ok);
  const after = await one<{ started_at: string; ended_at: string; duration_minutes: number; report_status: string; mv: number }>(sql`
    select started_at, ended_at, duration_minutes, report_status, (select sum(quantity)::int from sample_movements where visit_id = v.id) as mv from doctor_visits v where id = ${v1}::uuid`);
  assert.equal(String(after.started_at), String(before.started_at));
  assert.equal(after.duration_minutes, before.duration_minutes);
  assert.equal(after.report_status, "VALIDE");
  assert.equal(after.mv, -2);
  console.log("✓ compte rendu validé sans toucher aux heures ; 2 échantillons sortis");

  // 12. Correction tracée (manager).
  const corr = await chrono.correctVisit({ id: admin.id, name: admin.name }, { visitId: r5.ok ? r5.visitId : "", reason: "Cabinet secondaire confirmé par téléphone", forcedStatus: "VERIFIEE" });
  assert.ok(corr.ok);
  const v12 = await one<{ verification_status: string; audits: number }>(sql`
    select verification_status, (select count(*)::int from audit_logs where entity = 'doctor_visit' and entity_id = ${r5.ok ? r5.visitId : ""}::uuid) as audits from doctor_visits where id = ${r5.ok ? r5.visitId : ""}::uuid`);
  assert.deepEqual(v12, { verification_status: "VERIFIEE", audits: 1 });
  const noReason = await chrono.correctVisit({ id: admin.id, name: admin.name }, { visitId: v1, reason: " " });
  assert.ok(!noReason.ok);
  console.log("✓ correction : motif obligatoire, statut fixé, trace d'audit");

  // 13. Ordonnances : rapprochement, colonne patient refusée, idempotence, annulation.
  const docRows = (await db.execute<{ first_name: string; last_name: string }>(sql`select first_name, last_name from doctors where specialty_id is not null order by last_name limit 8`)).rows;
  const prods = (await db.execute<{ name: string }>(sql`select name from products where active order by name limit 3`)).rows;
  const rows: Record<string, unknown>[] = [];
  docRows.forEach((d, i) => {
    rows.push({ Date: "2026-09-10", "Médecin": `Dr ${d.last_name.toUpperCase()} ${d.first_name}`, Ville: "Casablanca", Produit: prods[0].name, "Qté": 1, "Nom patient": "NE DOIT PAS ÊTRE LU" });
    if (i % 2 === 0) rows.push({ Date: "2026-09-12", "Médecin": `Dr ${d.first_name} ${d.last_name}`, Ville: "Casablanca", Produit: prods[1].name, "Qté": 2, "Nom patient": "X" });
  });
  rows.push({ Date: "2026-09-13", "Médecin": "Dr Inconnu Totalement", Ville: "Casablanca", Produit: "Produit concurrent XYZ", "Qté": 1 });
  rows.push({ Date: "", "Médecin": "Dr X", Produit: "Y" });
  const mapping = { date: "Date", doctorName: "Médecin", city: "Ville", product: "Produit", quantity: "Qté" };
  const bad = await runImport({ type: "PRESCRIPTIONS", rows, mapping: { ...mapping, pharmacy: "Nom patient" }, fileName: "it.xlsx" });
  assert.equal(bad.inserted, 0);
  assert.ok(bad.errors[0].message.includes("donnée patient"));
  const imp = await runImport({ type: "PRESCRIPTIONS", rows, mapping, fileName: "it.xlsx" });
  if (process.env.DEBUG_IT) console.log(JSON.stringify({ ...imp, matched: undefined }, null, 1));
  assert.equal(imp.errors.length, 1, "la ligne sans date est rejetée");
  assert.equal(imp.inserted, rows.length - 1);
  const stored = await one<{ n: number; matched: number; patient: number }>(sql`
    select count(*)::int as n, count(*) filter (where doctor_id is not null)::int as matched,
      count(*) filter (where doctor_raw_name ilike '%PATIENT%' or coalesce(pharmacy_raw, '') ilike '%DOIT%')::int as patient
    from prescriptions where import_id = ${imp.importId}::uuid`);
  assert.equal(stored.patient, 0, "aucune valeur de la colonne patient n'est stockée");
  assert.ok(stored.matched / stored.n >= 0.9, `taux de rapprochement ${stored.matched}/${stored.n}`);
  const imp2 = await runImport({ type: "PRESCRIPTIONS", rows, mapping, fileName: "it.xlsx" });
  assert.equal(imp2.inserted, 0, "recharger le même fichier ne duplique rien");
  console.log(`✓ ordonnances : ${stored.matched}/${stored.n} lignes rapprochées d'un médecin, patient ignoré, réimport idempotent ;`, imp.warnings[0]);

  // 14. Potentiel et recommandations.
  const someDoc = await one<{ id: string }>(sql`select doctor_id as id from prescriptions where doctor_id is not null group by doctor_id order by count(*) desc limit 1`);
  const profile = await doctorPrescriptionProfile(someDoc.id);
  assert.ok(profile && profile.observations > 0);
  console.log("✓ profil prescripteur :", profile!.observations, "ligne(s), potentiel", profile!.potential.level ?? "non calculé", "—", profile!.potential.computed?.reasons[0] ?? "");
  console.log("  recommandations :", profile!.recommendations.items.map((r) => r.why).join(" / ") || profile!.recommendations.note);

  const removed = await rollbackRows(imp.importId, "PRESCRIPTIONS");
  assert.equal(removed, rows.length - 1);
  console.log("✓ annulation de l'import :", removed, "lignes retirées");

  console.log("\nIntégration médicale : tout est vert.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
