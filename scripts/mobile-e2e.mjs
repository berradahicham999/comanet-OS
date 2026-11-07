// Parcours réel de l'app mobile sur un build de production : mode avion pendant une saisie, puis retour du réseau.
// Base jetable uniquement (le script y crée ses comptes et ses données). Le service worker exige `next build` + `next start`.
//
//   MOBILE_E2E=1 BASE_URL=http://localhost:3098 DATABASE_URL=postgresql://…/base_jetable PW_CHROMIUM=<chrome> node scripts/mobile-e2e.mjs [dossier-captures]
import { chromium } from "playwright";
import pg from "pg";
import bcrypt from "bcryptjs";
import fs from "node:fs";

const url = process.env.DATABASE_URL ?? "";
if (process.env.MOBILE_E2E !== "1" || /supabase|pooler/i.test(url)) {
  console.error("Refusé : ce parcours écrit dans la base. Lancez-le sur une base jetable avec MOBILE_E2E=1.");
  process.exit(1);
}
const base = process.env.BASE_URL ?? "http://localhost:3098";
const shots = process.argv[2];
if (shots) fs.mkdirSync(shots, { recursive: true });

const db = new pg.Client({ connectionString: url });
await db.connect();
const q = async (s, p) => (await db.query(s, p)).rows;
const tag = Date.now().toString(36);
const PASSWORD = `e2e-${tag}`;

let step = 0;
const ok = (m) => console.log(`✓ ${++step}. ${m}`);
function check(cond, m) {
  if (!cond) { console.error(`✗ ${m}`); process.exit(1); }
  ok(m);
}

/* -- Jeu de données --------------------------------------------------------------- */
async function animatrice(label) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const [u] = await q(`insert into users(name,email,password_hash,role) values ($1,$2,$3,'ANIMATRICE') returning id, email`, [label, `${label.toLowerCase()}-${tag}@e2e.ma`, hash]);
  for (const [m, c, e] of [["terrain", true, true], ["taches", true, true], ["produits", false, false]]) {
    await q(`insert into user_permissions(user_id,module,can_view,can_create,can_edit,can_validate) values ($1,$2,true,$3,$4,false)`, [u.id, m, c, e]);
  }
  await q(`insert into user_scope(user_id,scope) values ($1,'OWN')`, [u.id]);
  return u;
}
const salma = await animatrice("Salma");
const imane = await animatrice("Imane");
const clients = [];
for (let i = 0; i < 3; i++) {
  const [c] = await q(`insert into clients(name_key,name,city,type) values ($1,$2,'CASABLANCA','PHARMACIE') returning id, name`, [`e2e-${tag}-${i}`, `Pharmacie Ennakhil ${tag} ${i}`]);
  clients.push(c);
  await q(`insert into user_client_assignments(user_id,client_id) values ($1,$2)`, [salma.id, c.id]);
}
const products = [];
for (let i = 0; i < 6; i++) {
  const [p] = await q(`insert into products(name_key,name,price_retail,active) values ($1,$2,150,true) returning id`, [`e2e-${tag}-${i}`, `Sérum réparateur ${tag} ${i}`]);
  products.push(p);
}
// Un historique : c'est lui qui fait les produits habituels.
const [past] = await q(`insert into animations(date,client_id,animatrice_id,status,source) values (current_date - 3,$1,$2,'DONE','saisie') returning id`, [clients[1].id, salma.id]);
for (const p of products) await q(`insert into animation_lines(animation_id,product_id,quantity_sold) values ($1,$2,2)`, [past.id, p.id]);

/* -- Parcours --------------------------------------------------------------------- */
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const DEVICES = {
  "360×800": { viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 11; SM-A125F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" },
  "iPhone 13": { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
};

async function login(page, email) {
  await page.goto(`${base}/login?next=/m`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname === "/m", { timeout: 30000 });
}

async function pickClient(page, client) {
  const search = page.getByLabel("Rechercher un point de vente");
  if (!(await search.count())) await page.locator("section").first().getByRole("button").first().click();
  await search.fill(client.name);
  await page.getByRole("button", { name: new RegExp(client.name) }).first().click();
}

async function run(name, device, user, client, shotPrefix) {
  console.log(`\n— ${name}`);
  const ctx = await browser.newContext({ ...device, permissions: ["geolocation"], geolocation: { latitude: 33.5731, longitude: -7.5898, accuracy: 15 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await login(page, user.email);
  await page.getByRole("heading", { name: /Bonjour/ }).waitFor({ timeout: 20000 });
  ok("connexion, écran Aujourd'hui");
  if (shots) await page.screenshot({ path: `${shots}/${shotPrefix}-1-aujourdhui.png` });

  const notice = page.getByRole("button", { name: "J'ai compris" });
  if (await notice.count()) { await notice.click(); await notice.waitFor({ state: "detached" }); }
  ok("avis GPS accepté");

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 }).catch(async () => { await page.reload(); });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });
  ok("service worker actif, coquille préchargée");

  /* Mode avion */
  await ctx.setOffline(true);
  await page.goto(`${base}/m/saisie`);
  await page.getByRole("heading", { name: "Saisie des ventes" }).waitFor({ timeout: 15000 });
  ok("mode avion : la saisie s'ouvre depuis le téléphone");

  await pickClient(page, client);

  const t0 = Date.now();
  const plus = page.getByRole("button", { name: /Une unité de plus/ });
  const count = await plus.count();
  check(count >= 5, `produits habituels déjà à l'écran (${count}), sans réseau`);
  for (let i = 0; i < 5; i++) {
    for (let k = 0; k <= i; k++) await plus.nth(i).click();
  }
  if (shots) await page.screenshot({ path: `${shots}/${shotPrefix}-2-saisie.png` });
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByText(/Enregistrée : 15 unités/).waitFor({ timeout: 8000 });
  ok(`5 produits saisis sans réseau, 15 unités (${((Date.now() - t0) / 1000).toFixed(1)} s de script)`);
  await page.getByText(/1 saisie en attente/).waitFor({ timeout: 8000 });
  ok("badge « 1 saisie en attente »");
  if (shots) await page.screenshot({ path: `${shots}/${shotPrefix}-3-attente.png` });

  const before = await q(`select count(*)::int as n from animations where client_id = $1`, [client.id]);
  check(before[0].n === 0, "rien en base tant que le téléphone est hors réseau");

  await page.reload();
  await page.getByRole("heading", { name: "Saisie des ventes" }).waitFor({ timeout: 15000 });
  await page.getByText(/1 saisie en attente/).waitFor({ timeout: 8000 });
  ok("rechargement sans réseau : la saisie est toujours là");

  /* Retour du réseau */
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.getByText(/1 saisie en attente/).waitFor({ state: "detached", timeout: 30000 });
  ok("retour du réseau : envoi automatique, badge disparu");

  const rows = await q(`select a.id, a.gps_lat, a.gps_error, a.status, a.source, a.client_event_id, (select coalesce(sum(quantity_sold),0)::int from animation_lines l where l.animation_id = a.id) as units from animations a where client_id = $1`, [client.id]);
  check(rows.length === 1, `0 doublon en base (${rows.length} animation)`);
  check(rows[0].units === 15, "15 unités enregistrées");
  check(rows[0].gps_lat !== null && !rows[0].gps_error, "position capturée au moment de l'enregistrement");

  /* Renvoi forcé de la même saisie : le rejeu d'un téléphone qui n'a pas reçu la réponse */
  const replay = await page.evaluate(async ({ id, userId, clientId }) => {
    const r = await fetch("/api/m/mutations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events: [{ clientEventId: id, kind: "ANIMATION", userId, deviceTime: new Date().toISOString(), sentAt: new Date().toISOString(), payload: { clientId, date: new Date().toISOString().slice(0, 10), lines: [] }, gps: {} }] }) });
    return r.json();
  }, { id: rows[0].client_event_id, userId: user.id, clientId: client.id });
  check(replay.results[0].ok && replay.results[0].replayed, "rejeu de la même saisie : reconnu, rien d'écrit");
  check((await q(`select count(*)::int as n from animations where client_id = $1`, [client.id]))[0].n === 1, "toujours 0 doublon");

  check(errors.length === 0, `aucune erreur JavaScript${errors.length ? " : " + errors[0] : ""}`);
  return { ctx, page };
}

const first = await run("Android d'entrée de gamme, 360×800", DEVICES["360×800"], salma, clients[0], "android");

/* -- Conflit --------------------------------------------------------------------- */
console.log("\n— Conflit : la même journée déjà saisie ailleurs");
{
  const { ctx, page } = first;
  await ctx.setOffline(true);
  await page.goto(`${base}/m/saisie`);
  await page.getByRole("heading", { name: "Saisie des ventes" }).waitFor();
  await pickClient(page, clients[0]);
  await page.getByRole("button", { name: /Une unité de plus/ }).first().click();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByText(/1 saisie en attente/).waitFor();
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.getByText(/1 à corriger/).waitFor({ timeout: 30000 });
  ok("le serveur refuse : la saisie passe en « 1 à corriger », rien n'est perdu");
  await page.goto(`${base}/m/a-corriger`);
  await page.getByText(/existe déjà pour ce point de vente/).waitFor();
  if (shots) await page.screenshot({ path: `${shots}/android-4-a-corriger.png` });
  ok("écran « À corriger » : le motif et la saisie existante");
  check((await q(`select count(*)::int as n from animations where client_id = $1`, [clients[0].id]))[0].n === 1, "toujours une seule animation");
  await page.getByRole("button", { name: "Abandonner cette saisie" }).click();
  await page.getByRole("button", { name: "Oui, abandonner" }).click();
  await page.getByText("Rien à corriger.").waitFor();
  ok("abandon décidé par la personne, jamais par la machine");
}

/* -- Téléphone partagé ------------------------------------------------------------ */
console.log("\n— Téléphone partagé");
{
  const { ctx, page } = first;
  await ctx.setOffline(true);
  await page.goto(`${base}/m/stock`);
  await page.getByRole("heading", { name: "Stock du point de vente" }).waitFor();
  await page.getByLabel(/^Stock — /).first().fill("9");
  await page.getByRole("button", { name: "Enregistrer le relevé" }).click();
  await page.getByText(/1 saisie en attente/).waitFor();
  ok("relevé de stock saisi sans réseau, en attente");
  await ctx.setOffline(false);
  await page.goto(`${base}/m/mois`);
  await page.getByRole("heading", { level: 1 }).waitFor();
  await ctx.clearCookies();
  await page.evaluate(async () => { localStorage.removeItem("comanet_user"); });
  await page.goto(`${base}/login?next=/m`);
  await page.fill("#email", imane.email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname === "/m");
  await page.getByRole("heading", { name: /Bonjour Imane/ }).waitFor({ timeout: 20000 });
  const seen = await page.locator("body").innerText();
  check(!seen.includes("Salma"), "Imane ne voit rien de Salma sur le même téléphone");
  await page.waitForTimeout(1500);
  const leaked = await q(`select count(*)::int as n from client_stock_readings where user_id = $1`, [imane.id]);
  check(leaked[0].n === 0, "la saisie de Salma n'est pas partie au nom d'Imane");
  await ctx.close();
}

/* -- iPhone ------------------------------------------------------------------------ */
await (await run("Gabarit iPhone 13", DEVICES["iPhone 13"], salma, clients[2], "iphone")).ctx.close();

await browser.close();
await db.end();
console.log(`\n${step} contrôles passés.`);
process.exit(0);
