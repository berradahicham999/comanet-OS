/**
 * Test d'intégration de l'app mobile sur une VRAIE base Postgres (hors `npm test`) : rejeu de la file sans doublon, conflit,
 * saisies concurrentes, compte d'un autre téléphone, droits retirés, relevés de stock, position, sessions et révocation.
 *
 * Base jetable uniquement (PGlite local), jamais la production.
 *
 * PGlite n'a qu'une session : `DATABASE_POOL_MAX=1` y sérialise les transactions, et les envois simultanés se croisent
 * alors entre la lecture de l'identifiant et l'écriture, ce qui est exactement le cas à couvrir.
 *
 *   MOBILE_IT=1 DATABASE_POOL_MAX=1 DATABASE_URL=postgresql://…/base_jetable node --conditions=react-server --import tsx scripts/mobile-integration.ts
 */
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

const url = process.env.DATABASE_URL ?? "";
if (process.env.MOBILE_IT !== "1" || /supabase|pooler/i.test(url)) {
  console.error("Refusé : ce test écrit des saisies. Lancez-le sur une base jetable avec MOBILE_IT=1.");
  process.exit(1);
}

async function main() {
  const { db } = await import("@/db");
  const { applyMutation } = await import("@/lib/mobile/mutations");
  const { mobileSnapshot, acceptTerrainNotice, hasAcceptedTerrainNotice } = await import("@/lib/mobile/snapshot");
  const sessions = await import("@/lib/sessions");
  const { noPermissions } = await import("@/lib/permissions-shared");
  const { iso, today } = await import("@/lib/format");
  const one = async <T,>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows[0] as T;
  const n = async (q: ReturnType<typeof sql>) => (await one<{ n: number }>(q)).n;
  const id = () => crypto.randomUUID();
  const day = iso(today());
  let step = 0;
  const ok = (m: string) => console.log(`✓ ${++step}. ${m}`);

  const tag = id().slice(0, 8);
  const user = await one<{ id: string; name: string }>(sql`insert into users(name,email,password_hash,role) values (${`Animatrice IT ${tag}`},${`mobile-it-${tag}@test.ma`},'x','ANIMATRICE') returning id, name`);
  const other = await one<{ id: string; name: string }>(sql`insert into users(name,email,password_hash,role) values (${`Autre IT ${tag}`},${`mobile-it2-${tag}@test.ma`},'x','ANIMATRICE') returning id, name`);
  const client = await one<{ id: string }>(sql`insert into clients(name_key,name,city,type) values (${`it-${tag}`},${`Pharmacie IT ${tag}`},'CASABLANCA','PHARMACIE') returning id`);
  const client2 = await one<{ id: string }>(sql`insert into clients(name_key,name,city,type) values (${`it2-${tag}`},${`Pharmacie IT2 ${tag}`},'RABAT','PHARMACIE') returning id`);
  const product = await one<{ id: string }>(sql`insert into products(name_key,name,price_retail,active) values (${`pit-${tag}`},${`Produit IT ${tag}`},100,true) returning id`);

  const perms = noPermissions();
  perms.terrain = { view: true, create: true, edit: true, validate: false };
  // Forme réelle de `Access`, réduite à ce qu'on lit ici.
  const access = { user: { id: user.id, name: user.name, email: "", role: "ANIMATRICE" }, perms, scope: "OWN", flags: {}, brandIds: [], clientIds: [client.id], home: "/terrain/saisie", preview: null } as never;

  const event = (clientEventId: string, clientId = client.id, over: object = {}) => ({
    clientEventId, kind: "ANIMATION", userId: user.id, deviceTime: new Date().toISOString(), sentAt: new Date().toISOString(),
    payload: { clientId, date: day, lines: [{ productId: product.id, qty: "5", stock: "12" }] },
    gps: { lat: 33.5731, lng: -7.5898, accuracyM: 14, error: null }, ...over,
  }) as never;

  /* -- Saisie et rejeu -------------------------------------------------------------- */
  const e1 = id();
  const first = await applyMutation(access, event(e1));
  assert.equal(first.result.ok, true);
  const again = await applyMutation(access, event(e1));
  assert.equal(again.result.ok, true);
  assert.equal((again.result as { replayed?: boolean }).replayed, true);
  await applyMutation(access, event(e1));
  assert.equal(await n(sql`select count(*)::int as n from animations where client_event_id = ${e1}`), 1);
  assert.equal(await n(sql`select count(*)::int as n from animation_lines l join animations a on a.id = l.animation_id where a.client_event_id = ${e1}`), 1);
  ok("rejouer trois fois la même saisie : une seule animation, une seule ligne");

  const row = await one<{ gps_lat: string; gps_accuracy_m: number; source: string; status: string; device_time: string }>(sql`select gps_lat, gps_accuracy_m, source, status, device_time from animations where client_event_id = ${e1}`);
  assert.equal(Number(row.gps_lat), 33.5731);
  assert.equal(row.gps_accuracy_m, 14);
  assert.equal(row.source, "saisie");
  assert.equal(row.status, "DONE");
  assert.ok(row.device_time);
  ok("position, heure du téléphone et source enregistrées ; `saisie` protège la ligne de l'import");

  assert.equal(await n(sql`select count(*)::int as n from client_stock_readings where animation_id = (select id from animations where client_event_id = ${e1})`), 1);
  ok("le champ rayon passe par `recordReadings()`, comme la saisie du bureau");

  /* -- Conflit ---------------------------------------------------------------------- */
  const conflict = await applyMutation(access, event(id()));
  assert.equal(conflict.result.ok, false);
  assert.equal((conflict.result as { code: string }).code, "CONFLICT");
  assert.ok((conflict.result as { existingId?: string }).existingId);
  assert.equal(await n(sql`select count(*)::int as n from animations where client_id = ${client.id}::uuid and date = ${day}::date`), 1);
  ok("même point de vente et même jour sous un autre identifiant : conflit, rien d'écrit");

  /* -- Concurrence ------------------------------------------------------------------ */
  const e2 = id();
  const race = await Promise.all([applyMutation(access, event(e2, client2.id)), applyMutation(access, event(e2, client2.id)), applyMutation(access, event(e2, client2.id))]);
  assert.ok(race.every((r) => r.result.ok), JSON.stringify(race.map((r) => r.result)));
  assert.equal(await n(sql`select count(*)::int as n from animations where client_event_id = ${e2}`), 1);
  ok("trois envois simultanés de la même saisie (réseau instable) : une seule animation");

  /* -- Téléphone partagé, droits ---------------------------------------------------- */
  const wrong = await applyMutation(access, event(id(), client.id, { userId: other.id }));
  assert.equal((wrong.result as { code: string }).code, "WRONG_USER");
  ok("la saisie d'un autre compte n'est jamais enregistrée sous la session courante");

  const noRights = { ...(access as object), perms: noPermissions() } as never;
  assert.equal(((await applyMutation(noRights, event(id()))).result as { code: string }).code, "FORBIDDEN");
  ok("droit retiré entre la saisie et l'envoi : refus, vérifié côté serveur à chaque saisie");

  const invalid = await applyMutation(access, event(id(), client.id, { payload: { clientId: client.id, date: "2020-01-01", lines: [] } }));
  assert.equal((invalid.result as { code: string }).code, "INVALID");
  const badQty = await applyMutation(access, event(id(), client.id, { payload: { clientId: client.id, date: day, lines: [{ productId: product.id, qty: "abc", stock: "" }] } }));
  assert.equal((badQty.result as { code: string }).code, "INVALID");
  ok("date hors fenêtre et quantité illisible refusées par les mêmes règles que le bureau");

  /* -- Sans position ---------------------------------------------------------------- */
  const client3 = await one<{ id: string }>(sql`insert into clients(name_key,name,city,type) values (${`it3-${tag}`},${`Pharmacie IT3 ${tag}`},'FES','PHARMACIE') returning id`);
  const e3 = id();
  const denied = await applyMutation(access, event(e3, client3.id, { gps: { lat: null, lng: null, accuracyM: null, error: "REFUSE" } }));
  assert.equal(denied.result.ok, true);
  assert.equal((await one<{ gps_error: string }>(sql`select gps_error from animations where client_event_id = ${e3}`)).gps_error, "REFUSE");
  ok("GPS refusé : la saisie passe, marquée sans position");

  /* -- Relevé de stock -------------------------------------------------------------- */
  const s1 = id();
  const stock = (clientEventId: string) => ({ clientEventId, kind: "STOCK", userId: user.id, deviceTime: new Date().toISOString(), sentAt: new Date().toISOString(), payload: { clientId: client.id, date: day, lines: [{ productId: product.id, qty: "7" }] }, gps: {} }) as never;
  assert.equal((await applyMutation(access, stock(s1))).result.ok, true);
  const replay = await applyMutation(access, stock(s1));
  assert.equal((replay.result as { replayed?: boolean }).replayed, true);
  assert.equal(await n(sql`select count(*)::int as n from client_stock_readings where client_event_id = ${s1}`), 1);
  const race2 = id();
  await Promise.all([applyMutation(access, stock(race2)), applyMutation(access, stock(race2))]);
  assert.equal(await n(sql`select count(*)::int as n from client_stock_readings where client_event_id = ${race2}`), 1);
  ok("relevé de stock rejoué ou envoyé deux fois en même temps : une seule ligne");

  /* -- Référentiels ----------------------------------------------------------------- */
  const stranger = await one<{ id: string }>(sql`insert into clients(name_key,name,city,type) values (${`it4-${tag}`},${`Pharmacie étrangère ${tag}`},'OUJDA','PHARMACIE') returning id`);
  const snap = await mobileSnapshot(access);
  assert.equal(snap.persona, "ANIMATRICE");
  const ids = snap.terrain!.clients.map((c) => c.id);
  assert.ok(ids.includes(client.id), "ses points de vente");
  assert.ok(ids.includes(client2.id), "ceux des 90 derniers jours");
  assert.ok(!ids.includes(stranger.id), "rien hors de son périmètre");
  const text = JSON.stringify(snap);
  assert.ok(!/cost|marge|margin/i.test(text.replace(/Marge/g, "")), "aucun coût dans le téléphone");
  assert.equal(snap.terrain!.todayUnits, 15);
  ok("référentiels du téléphone : ses points de vente seulement, aucun coût ; réalisé du jour exact");

  assert.equal(await hasAcceptedTerrainNotice(user.id), false);
  await acceptTerrainNotice(user.id, "test");
  await acceptTerrainNotice(user.id, "test");
  assert.equal(await n(sql`select count(*)::int as n from medical_gps_consents where user_id = ${user.id}::uuid`), 1);
  ok("avis GPS de la saisie terrain accepté une seule fois, horodaté");

  /* -- Sessions --------------------------------------------------------------------- */
  const sid = (await sessions.openSession(user.id, { userAgent: "Mozilla/5.0 (Linux; Android 11) Chrome/130.0 Mobile" }))!;
  const sid2 = (await sessions.openSession(user.id, { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile Safari/604.1", idleMinutes: 30 }))!;
  assert.equal(await sessions.checkSession(sid, user.id), true);
  assert.equal(await sessions.checkSession(sid, other.id), false);
  assert.equal((await sessions.activeSessions(user.id)).length, 2);
  ok("une session par appareil, liée à son compte");

  await db.execute(sql`update user_sessions set last_seen_at = now() - interval '31 minutes' where id = ${sid2}::uuid`);
  assert.equal(await sessions.checkSession(sid2, user.id), false);
  assert.equal((await one<{ revoked_reason: string }>(sql`select revoked_reason from user_sessions where id = ${sid2}::uuid`)).revoked_reason, "INACTIVITE");
  ok("téléphone inactif au-delà de la limite : session close");

  const admin = { id: other.id, name: other.name };
  assert.equal(await sessions.revokeSessions(admin, user.id, sid), 1);
  assert.equal(await sessions.checkSession(sid, user.id), false);
  assert.equal(await n(sql`select count(*)::int as n from audit_logs where action = 'REVOQUER_SESSION' and entity_id = ${user.id}::uuid`), 1);
  ok("révocation à distance : effet immédiat, tracée dans le journal d'audit");

  console.log(`\n${step} contrôles passés.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
