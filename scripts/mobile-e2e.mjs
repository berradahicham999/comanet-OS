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
  await page.evaluate(() => { localStorage.removeItem("comanet_user"); });
  await page.goto("about:blank");
  await ctx.clearCookies();
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

/* -- Commercial -------------------------------------------------------------------- */
console.log("\n— Commercial, 360×800");
{
  const hash = await bcrypt.hash(PASSWORD, 4);
  const [u] = await q(`insert into users(name,email,password_hash,role) values ('Karim',$1,$2,'TRADE') returning id, email`, [`karim-${tag}@e2e.ma`, hash]);
  for (const [m, c] of [["clients", true], ["commandes", true], ["taches", true], ["reglements", false]]) {
    await q(`insert into user_permissions(user_id,module,can_view,can_create,can_edit,can_validate) values ($1,$2,true,$3,$3,false)`, [u.id, m, c]);
  }
  await q(`insert into user_scope(user_id,scope) values ($1,'OWN')`, [u.id]);
  const portfolio = [];
  for (let i = 0; i < 3; i++) {
    const [c] = await q(`insert into clients(name_key,name,city,type,account_manager_id) values ($1,$2,'RABAT','PHARMACIE',$3) returning id, name`, [`e2e-com-${tag}-${i}`, `Pharmacie Agdal ${tag} ${i}`, u.id]);
    portfolio.push(c);
    await q(`insert into user_client_assignments(user_id,client_id) values ($1,$2)`, [u.id, c.id]);
    await q(`insert into sales(date,client_id,product_id,quantity,amount,line_hash,site) values (current_date - 20,$1,$2,3,$3,$4,'COMANET')`, [c.id, products[0].id, 1000 * (i + 1), `e2e-${tag}-${i}`]);
  }
  await q(`insert into client_visits(client_id,date,user_id) values ($1,current_date,$2)`, [portfolio[0].id, u.id]);

  const ctx = await browser.newContext(DEVICES["360×800"]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/login`);
  await page.fill("#email", u.email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((x) => x.pathname === "/m", { timeout: 30000 });
  ok("téléphone du commercial : la connexion ouvre l'app, pas la liste des commandes");
  await page.getByRole("heading", { name: "Mes clients" }).waitFor({ timeout: 20000 });
  const firstRow = page.locator("main ul li").first();
  check((await firstRow.innerText()).includes(portfolio[0].name) && (await firstRow.innerText()).includes("Visite aujourd'hui"), "le client à visiter aujourd'hui ouvre la liste");
  if (shots) await page.screenshot({ path: `${shots}/commercial-1-clients.png` });

  await page.getByLabel("Rechercher un client").fill(`agdal ${tag} 2`);
  await page.getByRole("link", { name: new RegExp(`${portfolio[2].name}`) }).waitFor();
  check((await page.locator("main ul li").count()) === 1, "recherche instantanée, sans accents ni majuscules");
  await page.getByRole("link", { name: new RegExp(`${portfolio[2].name}`) }).click();
  await page.getByRole("heading", { name: portfolio[2].name }).waitFor({ timeout: 15000 });
  await page.getByRole("heading", { name: "Impayés" }).waitFor({ timeout: 15000 });
  await page.getByRole("heading", { name: "Pack conseillé" }).waitFor();
  ok("fiche courte : CA, tendance, segment, impayés, pack conseillé");
  if (shots) await page.screenshot({ path: `${shots}/commercial-2-fiche.png`, fullPage: true });
  const size = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, small: [...document.querySelectorAll("main a, main button, main input")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height < 44; }).map((e) => (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 30)) }));
  check(size.overflow === 0 && size.small.length === 0, `fiche à 360 px : aucun débordement, aucune cible sous 44 px${size.small.length ? " : " + size.small.join(", ") : ""}`);

  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30000 }).catch(() => page.reload());
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30000 });
  await page.goto(`${base}/m/client?id=${portfolio[2].id}`);
  await page.getByRole("heading", { name: "Pack conseillé" }).waitFor({ timeout: 15000 });

  await ctx.setOffline(true);
  await page.reload();
  await page.getByRole("heading", { name: portfolio[2].name }).waitFor({ timeout: 15000 });
  await page.getByRole("heading", { name: "Impayés" }).waitFor({ timeout: 15000 });
  await page.getByText(/Copie du/).waitFor();
  ok("mode avion : la fiche s'ouvre depuis le téléphone, datée");
  check((await page.locator('[aria-disabled="true"]').count()) === 1, "visite signalée comme indisponible sans réseau");

  await page.getByLabel("Chercher un produit").fill(tag);
  await page.getByLabel(/^Stock — /).first().fill("11");
  await page.getByRole("button", { name: "Enregistrer le relevé" }).click();
  await page.getByText(/1 saisie en attente/).waitFor({ timeout: 8000 });
  ok("stock chez le client modifié sans réseau, en attente");
  check((await q(`select count(*)::int as n from client_stock_readings where client_id = $1`, [portfolio[2].id]))[0].n === 0, "rien en base tant que le téléphone est hors réseau");

  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.getByText(/1 saisie en attente/).waitFor({ state: "detached", timeout: 30000 });
  const readings = await q(`select channel::text as channel, quantity, user_id from client_stock_readings where client_id = $1`, [portfolio[2].id]);
  check(readings.length === 1 && readings[0].channel === "TOURNEE_COMMERCIALE" && readings[0].quantity === 11 && readings[0].user_id === u.id, "retour du réseau : un seul relevé, canal Tournée, à son nom");

  await ctx.setOffline(true);
  await page.goto(`${base}/m/client?id=${portfolio[1].id}`);
  await page.getByRole("heading", { name: portfolio[1].name }).waitFor({ timeout: 15000 });
  await page.getByRole("link", { name: "Commande", exact: true }).click();
  await page.waitForURL((x) => x.pathname === "/m/commande", { timeout: 15000 });
  await page.getByLabel("Chercher un produit").fill(tag);
  await page.getByRole("button", { name: new RegExp(`réparateur ${tag} 1`) }).click();
  await page.getByRole("button", { name: /Une unité de plus/ }).first().click();
  if (shots) await page.screenshot({ path: `${shots}/commercial-3-commande.png` });
  await page.getByRole("button", { name: "Enregistrer sur le téléphone" }).click();
  await page.waitForURL((x) => x.pathname === "/m/client", { timeout: 15000 });
  await page.getByText(/1 saisie en attente/).waitFor({ timeout: 8000 });
  ok("commande prise sans réseau, en attente");
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.getByText(/1 saisie en attente/).waitFor({ state: "detached", timeout: 30000 });
  const orders = await q(`select status::text as status, type::text as type, (select count(*)::int from sales_document_lines l where l.document_id = d.id) as lines, (select quantity from sales_document_lines l where l.document_id = d.id limit 1) as qty from sales_documents d where client_id = $1`, [portfolio[1].id]);
  check(orders.length === 1 && orders[0].status === "BROUILLON" && orders[0].type === "COMMANDE" && Number(orders[0].qty) === 2, "retour du réseau : un seul brouillon de commande, rien de confirmé");

  await page.goto(`${base}/m/saisie`);
  await page.waitForURL((x) => x.pathname === "/m", { timeout: 15000 });
  ok("un écran d'animatrice ramène à ses clients");
  await page.getByRole("link", { name: "Commandes", exact: true }).click();
  await page.waitForURL((x) => x.pathname === "/gestion/pieces", { timeout: 20000 });
  ok("onglet Commandes : la page existante, en ligne");
  check(errors.length === 0, `aucune erreur JavaScript${errors.length ? " : " + errors[0] : ""}`);
  await ctx.close();
}

/* -- Déléguée médicale -------------------------------------------------------------- */
console.log("\n— Déléguée, 360×800");
{
  const hash = await bcrypt.hash(PASSWORD, 4);
  const [u] = await q(`insert into users(name,email,password_hash,role) values ('Nadia',$1,$2,'DELEGUE_MEDICAL') returning id, email`, [`nadia-${tag}@e2e.ma`, hash]);
  for (const m of ["medical", "taches"]) await q(`insert into user_permissions(user_id,module,can_view,can_create,can_edit,can_validate) values ($1,$2,true,true,true,false)`, [u.id, m]);
  await q(`insert into user_scope(user_id,scope) values ($1,'OWN')`, [u.id]);
  const [d] = await q(`insert into doctors(first_name,last_name,city,delegate_id) values ('Salma',$1,'RABAT',$2) returning id, last_name`, [`Bennani${tag}`, u.id]);
  const [planned] = await q(`insert into doctor_visits(doctor_id,date,delegate_id) values ($1,current_date,$2) returning id`, [d.id, u.id]);

  const ctx = await browser.newContext({ ...DEVICES["360×800"], permissions: ["geolocation"], geolocation: { latitude: 34.0209, longitude: -6.8416, accuracy: 12 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/login`);
  await page.fill("#email", u.email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((x) => x.pathname === "/m/tournee", { timeout: 40000 });
  ok("téléphone de la déléguée : la connexion ouvre sa tournée");

  await page.getByRole("button", { name: /J'ai compris/ }).click();
  await page.getByText(`Dr Salma ${d.last_name}`).first().waitFor({ timeout: 20000 });
  ok("avis GPS accepté, visite du jour affichée");
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30000 }).catch(() => page.reload());
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30000 });
  await page.waitForTimeout(1500);

  await page.goto(`${base}/m/medecins`);
  await page.getByRole("link", { name: new RegExp(d.last_name) }).click();
  await page.waitForURL((x) => x.pathname === "/m/fiche-medecin", { timeout: 15000 });
  await page.getByRole("link", { name: "Démarrer une visite" }).waitFor({ timeout: 15000 });
  ok("fiche médecin depuis la liste de ses secteurs");

  await ctx.setOffline(true);
  await page.goto(`${base}/m/tournee`);
  await page.getByText(`Dr Salma ${d.last_name}`).first().waitFor({ timeout: 15000 });
  ok("mode avion : la tournée s'ouvre depuis le téléphone");
  await page.getByRole("button", { name: "Démarrer" }).first().click();
  await page.getByRole("button", { name: "Terminer la visite" }).waitFor({ timeout: 25000 });
  ok("Démarrer sans réseau : le chrono tourne");
  check((await q(`select count(*)::int as n from visit_events where visit_id = $1`, [planned.id]))[0].n === 0, "rien en base tant que le téléphone est hors réseau");
  await page.getByRole("button", { name: "Terminer la visite" }).click();
  await page.waitForURL((x) => x.pathname === "/m/compte-rendu", { timeout: 25000 });
  await page.fill('input[name="objective"]', "Présenter le sérum");
  if (shots) await page.screenshot({ path: `${shots}/deleguee-1-compte-rendu.png` });
  await page.getByRole("button", { name: "Valider le compte rendu" }).click();
  await page.waitForURL((x) => x.pathname === "/m/tournee", { timeout: 15000 });
  await page.getByText(/1 saisie en attente/).waitFor({ timeout: 8000 });
  ok("Terminer puis compte rendu sans réseau : enregistrés sur le téléphone");
  await page.reload();
  await page.getByText(/1 saisie en attente/).waitFor({ timeout: 10000 });
  ok("rechargement sans réseau : le compte rendu est toujours là");

  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.getByText(/1 saisie en attente/).waitFor({ state: "detached", timeout: 75000 });
  const visits = await q(`select id, status::text as status, report_status, objective, started_at, ended_at from doctor_visits where doctor_id = $1`, [d.id]);
  check(visits.length === 1, `0 doublon : une seule visite, la planifiée (${visits.length})`);
  check(visits[0].status === "REALISEE" && !!visits[0].started_at && !!visits[0].ended_at, "visite réalisée, heures enregistrées");
  check(visits[0].report_status === "VALIDE" && visits[0].objective === "Présenter le sérum", "compte rendu rattaché à la bonne visite");
  const ev = await q(`select type::text as type, lat from visit_events where visit_id = $1 order by server_time`, [visits[0].id]);
  check(ev.length === 2 && ev.every((e) => e.lat !== null), "Démarrer et Terminer horodatés avec position");

  await page.goto(`${base}/m/historique`);
  await page.getByText(new RegExp(d.last_name)).first().waitFor({ timeout: 15000 });
  await page.getByText("Compte rendu ✓").first().waitFor({ timeout: 15000 });
  ok("historique à jour");
  check(errors.length === 0, `aucune erreur JavaScript${errors.length ? " : " + errors[0] : ""}`);
  await ctx.close();
}

/* -- Direction ---------------------------------------------------------------------- */
console.log("\n— Direction, 360×800");
{
  const hash = await bcrypt.hash(PASSWORD, 4);
  const [u] = await q(`insert into users(name,email,password_hash,role) values ('Direction',$1,$2,'ADMIN') returning id, email`, [`dg-${tag}@e2e.ma`, hash]);
  for (const m of ["produits","stock","reglementaire","ventes","clients","commandes","livraisons","facturation","reglements","achats","marketing","influence","budgets","terrain","medical","taches","assets","rapports","administration"]) {
    await q(`insert into user_permissions(user_id,module,can_view,can_create,can_edit,can_validate) values ($1,$2,true,true,true,true)`, [u.id, m]);
  }
  await q(`insert into user_scope(user_id,scope) values ($1,'ALL')`, [u.id]);
  await q(`insert into user_flags(user_id,override_commercial,approve_spend) values ($1,true,true)`, [u.id]);
  // Base jetable, parcours rejouable : la file doit contenir exactement ce que ce parcours y met.
  await q(`update content_items set status = 'IDEE' where status = 'A_VALIDER'`);
  await q(`update sales_documents set approval_requested_at = null where approval_requested_at is not null`);
  const [brand] = await q(`select id from brands limit 1`);
  const content = [];
  for (const t of ["Reel solaire", "Carrousel routine"]) {
    const [c] = await q(`insert into content_items(date,brand_id,title,status,validator_id) values (current_date,$1,$2,'A_VALIDER',$3) returning id, title`, [brand.id, `${t} ${tag}`, u.id]);
    content.push(c);
  }
  const [blocked] = await q(`insert into clients(name_key,name,city,type,blocked,blocked_reason) values ($1,$2,'FES','PHARMACIE',true,'Impayés') returning id, name`, [`e2e-dg-${tag}`, `Pharmacie Bloquée ${tag}`]);
  const [piece] = await q(`insert into sales_documents(type,date,client_id,site,approval_requested_at,approval_requested_by_id,ttc) values ('BL',current_date,$1,'COMANET',now(),$2,1200) returning id`, [blocked.id, u.id]);

  const ctx = await browser.newContext(DEVICES["360×800"]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/login`);
  await page.fill("#email", u.email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((x) => x.pathname === "/m/brief", { timeout: 40000 });
  await page.getByText(/3 décisions à prendre/).waitFor({ timeout: 20000 });
  ok("téléphone de la direction : le brief, avec le nombre de décisions");
  await page.getByRole("link", { name: "Valider", exact: true }).click();
  await page.waitForURL((x) => x.pathname === "/m/validations", { timeout: 15000 });

  const swipe = async (dx) => {
    const box = await page.locator("article").boundingBox();
    const y = box.y + 30;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, y, { steps: 8 });
    await page.mouse.up();
  };
  const statusOf = async (id) => (await q(`select status from content_items where id = $1`, [id]))[0].status;
  const until = async (fn) => { for (let i = 0; i < 60; i++) { if (await fn()) return true; await page.waitForTimeout(250); } return false; };

  await page.getByText(blocked.name).first().waitFor({ timeout: 15000 });
  if (shots) await page.screenshot({ path: `${shots}/direction-1-validation.png` });
  await swipe(-180);
  await page.getByPlaceholder("Motif (obligatoire)").waitFor();
  check(await page.getByRole("button", { name: "Envoyer" }).isDisabled(), "glisser à gauche : un motif est exigé");
  await page.getByPlaceholder("Motif (obligatoire)").fill("Régler l'impayé d'abord");
  await page.getByRole("button", { name: "Envoyer" }).click();
  check(await until(async () => (await q(`select approval_requested_at from sales_documents where id = $1`, [piece.id]))[0].approval_requested_at === null), "blocage non levé : demande retirée après le délai d'annulation");
  check((await q(`select status::text as s from sales_documents where id = $1`, [piece.id]))[0].s === "BROUILLON", "la pièce reste un brouillon");

  // L'ordre de deux contenus du même instant n'est pas fixé : on suit celui qui s'affiche.
  await page.locator("article h2").waitFor({ timeout: 15000 });
  const shownTitle = (await page.locator("article h2").textContent())?.trim();
  const [one, two] = shownTitle === content[0].title ? content : [content[1], content[0]];
  await swipe(40);
  await page.waitForTimeout(300);
  check((await page.getByText(/^Validé :/).count()) === 0, "un petit mouvement ne valide rien");
  await swipe(170);
  await page.getByText(/^Validé :/).waitFor({ timeout: 4000 });
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await page.getByText(one.title).first().waitFor({ timeout: 4000 });
  await page.waitForTimeout(5600);
  check((await statusOf(one.id)) === "A_VALIDER", "glisser puis Annuler : rien n'est parti");
  await swipe(170);
  check(await until(async () => (await statusOf(one.id)) === "VALIDE"), "glisser à droite : contenu validé par la transition officielle");

  await page.getByText(two.title).first().waitFor({ timeout: 15000 });
  await swipe(-180);
  await page.getByPlaceholder("Motif (obligatoire)").fill("Revoir la légende");
  await page.getByRole("button", { name: "Envoyer" }).click();
  check(await until(async () => (await statusOf(two.id)) === "CORRECTIONS"), "glisser à gauche : renvoyé en corrections");
  check((await q(`select comment from content_status_history where content_id = $1 order by created_at desc limit 1`, [two.id]))[0].comment === "Revoir la légende", "le motif est dans l'historique");
  await page.getByText("Rien à valider.").waitFor({ timeout: 8000 });
  ok("file vide");

  for (const route of ["/actions", "/recherche?q=pharmacie"]) {
    await page.goto(base + route, { waitUntil: "networkidle" });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(over === 0, `${route.split("?")[0]} : aucun débordement à 360 px (${over} px)`);
  }
  check(errors.length === 0, `aucune erreur JavaScript${errors.length ? " : " + errors[0] : ""}`);
  await ctx.close();
}

await browser.close();
await db.end();
console.log(`\n${step} contrôles passés.`);
process.exit(0);
