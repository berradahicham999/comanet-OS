// Parcours fonctionnel de bout en bout (serveur sur :3000).
//   node scripts/e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
let step = 0;
const ok = (msg) => console.log(`✓ ${++step}. ${msg}`);
const fail = (msg) => { console.log(`✗ ${msg}`); process.exitCode = 1; };

async function login(email) {
  await ctx.clearCookies();
  await page.goto(`${base}/login`);
  await page.fill("#email", email);
  await page.fill("#password", "comanet2026");
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

// 1. Connexion + cockpit
await login("hicham@comanet.ma");
await page.goto(`${base}/`);
const h1 = await page.textContent("h1");
h1?.includes("Bonjour") ? ok(`Cockpit chargé (${h1.trim()})`) : fail("Cockpit");

// 2. Action Center → créer une tâche depuis la première recommandation
await page.goto(`${base}/actions?cat=STOCK`);
const firstTitle = (await page.locator("article h3").first().textContent())?.trim();
await page.locator("article summary").first().click();
await page.locator("article form button[type=submit]").first().click();
await page.waitForLoadState("networkidle");
await page.goto(`${base}/actions?cat=STOCK&all=1`);
const badge = await page.locator("article", { hasText: firstTitle ?? "" }).first().locator("text=Tâche créée").count();
badge > 0 ? ok(`Tâche créée depuis la recommandation « ${firstTitle} »`) : fail("Création de tâche depuis Action Center");

// 3. La tâche existe dans le Kanban
await page.goto(`${base}/taches`);
const inKanban = await page.locator("text=Commande fournisseur").count();
inKanban > 0 ? ok("Tâche visible dans le Kanban") : fail("Tâche absente du Kanban");

// 4. Import CSV de ventes (août 2026) via l'interface
const csv = [
  "Date Lvc;Client fonctionnel;Raison sociale;Ville;Designation;Gamme;Qte;Total HT;Facture N°;Site",
  "2026-08-12;LA CDP;LA CDP;CASABLANCA;PRO COLLAGENIUM 25ML;AURACOS;120;41760;FAC2608TEST1;COMANET",
  "2026-08-12;LA CDP;LA CDP;CASABLANCA;GAMARDE FLUIDE HYDRATANT LEGER ACTIVE Tube 40 g;GAMARDE;12;1462,5;FAC2608TEST1;COMANET",
  "2026-08-20;PARA TEST E2E;PARA TEST E2E;FES;GAMARDE SOIN ECLAT NUIT Tube 40 g;GAMARDE;6;1031,25;FAC2608TEST2;COS",
  "2026-08-12;LA CDP;LA CDP;CASABLANCA;PRO COLLAGENIUM 25ML;AURACOS;120;41760;FAC2608TEST1;COMANET",
].join("\n");
const csvPath = path.join("/tmp", "ventes-aout-e2e.csv");
fs.writeFileSync(csvPath, csv);
await page.goto(`${base}/imports`);
await page.selectOption("select[name=type]", "SALES");
await page.setInputFiles("input[type=file]", csvPath);
await page.click("form button[type=submit]");
await page.waitForURL(/\/imports\/nouveau/);
const detected = await page.locator("text=colonnes reconnues").count();
detected > 0 ? ok("Mapping automatique des colonnes") : fail("Mapping auto");
await page.click("text=Lancer l'import");
await page.waitForURL(/\/imports\/[0-9a-f-]{36}$/);
const summary = await page.textContent("main");
summary?.includes("Insérées") ? ok("Import exécuté : " + (await page.locator(".kpi").allTextContents()).join(" / ")) : fail("Import");
const dupCount = (await page.locator(".kpi").allTextContents())[3];
dupCount === "1" ? ok("Doublon détecté (ligne identique dans le fichier)") : fail(`Doublons attendus 1, obtenu ${dupCount}`);

// 5. Le cockpit se recale sur août
await page.goto(`${base}/`);
const sub = await page.locator("main").textContent();
sub?.includes("août 2026") ? ok("Cockpit recalé sur août 2026 après import") : fail("Cockpit non recalé");

// 6. Nouveau client créé par l'import visible et « à qualifier »
await page.goto(`${base}/clients?q=TEST E2E`);
(await page.locator("text=PARA TEST E2E").count()) > 0 ? ok("Client créé automatiquement par l'import") : fail("Client E2E absent");

// 7. Saisie terrain
await page.goto(`${base}/terrain/saisie`);
await page.fill("input[placeholder='Filtrer par nom ou ville…']", "LA CDP");
const cdpValue = await page.locator("select[name=clientId] option", { hasText: "LA CDP" }).first().getAttribute("value");
await page.selectOption("select[name=clientId]", cdpValue);
await page.selectOption("select[name=animatriceId]", { index: 1 });
const productSelect = page.locator("select[name=product_0]");
await productSelect.selectOption({ index: 1 });
await page.fill("input[name=qty_0]", "9");
await page.fill("input[name=stock_0]", "4");
await page.fill("input[name=customersAdvised]", "22");
await page.fill("textarea[name=comment]", "Test E2E animation");
await page.click("button[type=submit]:has-text('Enregistrer')");
await page.waitForURL(/\/terrain\/[0-9a-f-]{36}$/);
ok("Animation enregistrée : " + (await page.textContent("h1"))?.trim());

// 8. Rôle animatrice : accès restreint
await login("animatrice@comanet.ma");
page.url().includes("/terrain/saisie") ? ok("Animatrice redirigée vers la saisie") : fail("Redirection animatrice");
await page.goto(`${base}/parametres`);
!page.url().includes("/parametres") ? ok("Paramètres inaccessibles à l'animatrice") : fail("Contrôle d'accès");

// 9. Rôle réglementaire
await login("reglementaire@comanet.ma");
page.url().includes("/reglementaire") ? ok("Réglementaire redirigé vers son module") : fail("Redirection réglementaire");

// 10. Recherche universelle (admin)
await login("hicham@comanet.ma");
await page.goto(`${base}/recherche?q=collagen`);
(await page.locator("text=Produits").count()) > 0 ? ok("Recherche universelle") : fail("Recherche");

if (errors.length) { console.log("Erreurs navigateur :\n" + errors.join("\n")); process.exitCode = 1; }
await browser.close();
