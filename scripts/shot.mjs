// Usage: node scripts/shot.mjs <out-dir> <path>[,<path>...] [--mobile] [--user=email]
// Prend des captures d'écran authentifiées de l'application (dev server sur :3000).
import { chromium } from "playwright";
import fs from "node:fs";

const args = process.argv.slice(2);
const outDir = args[0] ?? "shots";
const paths = (args[1] ?? "/").split(",");
const mobile = args.includes("--mobile");
const userArg = args.find((a) => a.startsWith("--user="));
const email = userArg ? userArg.slice(7) : "hicham@comanet.ma";
const base = process.env.BASE_URL ?? "http://localhost:3000";

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await browser.newContext(
  mobile
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

await page.goto(`${base}/login`);
await page.fill("#email", email);
await page.fill("#password", "comanet2026");
await page.click("button[type=submit]");
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });

for (const p of paths) {
  const res = await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const name = (p === "/" ? "cockpit" : p.replace(/^\//, "").replace(/[\/?=&]/g, "_")) + (mobile ? "_mobile" : "");
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
  console.log(`${res?.status()} ${p} → ${outDir}/${name}.png`);
}
if (errors.length) console.log("ERREURS:\n" + errors.join("\n"));
await browser.close();
