import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SignJWT, jwtVerify } from "jose";
import { isPublicPath } from "@/lib/public-paths";
import { RENEW_AFTER_S, deviceLabel, isPhone, sessionVerdict, touchDue } from "@/lib/sessions-shared";
import { renewedToken, signSessionToken } from "@/lib/session-token";
import { personaOf } from "@/lib/mobile/persona";
import { noPermissions, type PermissionSet } from "@/lib/permissions-shared";
import { MODULE_KEYS, type ModuleKey } from "@/lib/access-shared";
import { ANIMATRICE_TABS, mobileTabsForPermissions } from "@/components/nav-config";
import { SHELL_PAGES, USER_PAGES, swSource } from "@/lib/mobile/sw-source";
import manifest from "@/app/manifest";
import { monthFigures } from "@/lib/mobile/snapshot-shared";

const secret = new TextEncoder().encode("secret-de-test-0123456789");

function perms(list: [ModuleKey, ("view" | "create" | "edit" | "validate")[]][]): PermissionSet {
  const p = noPermissions();
  for (const [m, actions] of list) for (const a of actions) p[m][a] = true;
  return p;
}

describe("chemins publics", () => {
  test("l'app mobile et l'installation sont ouvertes", () => {
    for (const p of ["/m", "/m/saisie", "/app", "/sw.js", "/.well-known/assetlinks.json", "/downloads/comanet-os.apk", "/login", "/d/abc", "/api/health"]) {
      assert.equal(isPublicPath(p), true, p);
    }
  });

  test("un préfixe ne suffit jamais : /m n'ouvre ni /marketing, ni /medical, ni /marques", () => {
    for (const p of ["/marketing", "/marketing/plan", "/medical/journee", "/marques", "/api/medical/visit-events", "/api/mobile", "/application", "/download", "/", "/clients", "/gestion/pnl", "/parametres"]) {
      assert.equal(isPublicPath(p), false, p);
    }
  });
});

describe("sessions par appareil", () => {
  const now = new Date("2026-11-07T12:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60000);

  test("une session révoquée ne vaut plus rien, même récente", () => {
    assert.equal(sessionVerdict({ revokedAt: ago(1), lastSeenAt: now, idleMinutes: null }, now), "REVOKED");
  });

  test("la limite d'inactivité ne s'applique qu'aux sessions qui en portent une", () => {
    assert.equal(sessionVerdict({ revokedAt: null, lastSeenAt: ago(31), idleMinutes: 30 }, now), "IDLE");
    assert.equal(sessionVerdict({ revokedAt: null, lastSeenAt: ago(29), idleMinutes: 30 }, now), "OK");
    assert.equal(sessionVerdict({ revokedAt: null, lastSeenAt: ago(60 * 24 * 20), idleMinutes: null }, now), "OK");
  });

  test("le dernier passage n'est pas réécrit à chaque requête", () => {
    assert.equal(touchDue({ revokedAt: null, lastSeenAt: ago(10), idleMinutes: null }, now), false);
    assert.equal(touchDue({ revokedAt: null, lastSeenAt: ago(61), idleMinutes: null }, now), true);
    assert.equal(touchDue({ revokedAt: null, lastSeenAt: ago(2), idleMinutes: 30 }, now), true);
  });

  test("les appareils sont lisibles et un poste de bureau n'est pas un téléphone", () => {
    const android = "Mozilla/5.0 (Linux; Android 11; SM-A125F) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36";
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
    assert.equal(deviceLabel(android), "Android · Chrome");
    assert.equal(deviceLabel(iphone), "iPhone · Safari");
    assert.equal(deviceLabel(mac), "Mac · Chrome");
    assert.equal(isPhone(android), true);
    assert.equal(isPhone(iphone), true);
    assert.equal(isPhone(mac), false);
    assert.equal(isPhone(null), false);
  });
});

describe("renouvellement du jeton", () => {
  const claims = { sub: "u1", name: "A", email: "a@b.c", role: "ANIMATRICE", sid: "s1" };

  test("un jeton récent n'est pas réémis", async () => {
    const t = await signSessionToken(claims, secret);
    assert.equal(await renewedToken(t, secret), null);
  });

  test("un jeton d'un jour est prolongé, avec le même compte et la même session", async () => {
    const t = await signSessionToken(claims, secret);
    const later = Math.floor(Date.now() / 1000) + RENEW_AFTER_S + 5;
    const renewed = await renewedToken(t, secret, later);
    assert.ok(renewed);
    const { payload } = await jwtVerify(renewed!, secret);
    assert.equal(payload.sub, "u1");
    assert.equal(payload.sid, "s1");
  });

  test("un jeton sans session n'est jamais prolongé : il ne serait pas révocable", async () => {
    const t = await new SignJWT({ name: "A" }).setProtectedHeader({ alg: "HS256" }).setSubject("u1").setIssuedAt(1000).setExpirationTime("3000d").sign(secret);
    assert.equal(await renewedToken(t, secret), null);
  });

  test("un jeton falsifié ou signé autrement n'est jamais prolongé", async () => {
    const t = await signSessionToken(claims, new TextEncoder().encode("une-autre-cle-0123456789"));
    assert.equal(await renewedToken(t, secret, Math.floor(Date.now() / 1000) + RENEW_AFTER_S + 5), null);
    assert.equal(await renewedToken("pas-un-jeton", secret), null);
  });
});

describe("persona et onglets", () => {
  const anim = perms([["terrain", ["view", "create", "edit"]], ["taches", ["view"]]]);
  const med = perms([["medical", ["view", "create"]], ["taches", ["view"]]]);
  const com = perms([["clients", ["view", "create"]], ["commandes", ["view", "create"]], ["taches", ["view"]]]);
  const reg = perms([["reglementaire", ["view", "create"]], ["taches", ["view"]]]);
  const adm = perms(MODULE_KEYS.map((m) => [m, ["view", "create", "edit", "validate"]]));

  test("le métier se déduit des droits", () => {
    assert.equal(personaOf(anim, "OWN"), "ANIMATRICE");
    assert.equal(personaOf(med, "OWN"), "DELEGUE");
    assert.equal(personaOf(com, "ASSIGNED"), "COMMERCIAL");
    assert.equal(personaOf(reg, "ALL"), "AUTRE");
    assert.equal(personaOf(adm, "ALL"), "DIRECTION");
  });

  test("un responsable terrain à portée large n'est pas une animatrice", () => {
    assert.equal(personaOf(anim, "ALL"), "AUTRE");
  });

  test("jamais plus de 4 onglets, et ni Cockpit ni Action Center pour le terrain", () => {
    for (const [p, s] of [[anim, "OWN"], [med, "OWN"], [com, "OWN"], [reg, "ALL"], [adm, "ALL"]] as const) {
      const tabs = mobileTabsForPermissions(p, s);
      assert.ok(tabs.length >= 1 && tabs.length <= 4, `${tabs.length}`);
    }
    assert.deepEqual(mobileTabsForPermissions(anim, "OWN"), ANIMATRICE_TABS);
    for (const p of [anim, med, com]) {
      const hrefs = mobileTabsForPermissions(p, "OWN").map((t) => t.href);
      assert.ok(!hrefs.includes("/") && !hrefs.includes("/actions"), hrefs.join());
    }
  });

  test("un onglet n'apparaît que si le droit existe", () => {
    const hrefs = mobileTabsForPermissions(perms([["clients", ["view", "create"]], ["commandes", ["view", "create"]]]), "OWN").map((t) => t.href);
    assert.ok(!hrefs.includes("/taches"));
  });
});

describe("service worker", () => {
  const src = swSource("abc123");

  test("il est valide, versionné, et change avec le déploiement", () => {
    assert.doesNotThrow(() => new Function(src));
    assert.ok(src.includes("comanet-shell-abc123"));
    assert.notEqual(src, swSource("def456"));
  });

  test("le motif des fichiers statiques retrouve les chunks dans le HTML", () => {
    const body = /html\.matchAll\((\/.*\/g)\)/.exec(src)?.[1];
    assert.ok(body);
    const re = new Function(`return ${body}`)() as RegExp;
    const html = `<script src="/_next/static/chunks/a1.js" async></script><link href="/_next/static/css/b2.css"/>\\"/_next/static/chunks/c3.js\\"`;
    assert.deepEqual([...html.matchAll(re)].map((m) => m[0]), ["/_next/static/chunks/a1.js", "/_next/static/css/b2.css", "/_next/static/chunks/c3.js"]);
  });

  test("la coquille ne précharge que les pages sans donnée", () => {
    assert.ok(SHELL_PAGES.every((p) => p === "/m" || p.startsWith("/m/")));
    assert.deepEqual(USER_PAGES, ["/medical/journee", "/clients/tournee"]);
  });

  test("l'API et les écritures ne passent jamais par le cache", () => {
    assert.ok(src.includes('if (req.method !== "GET") return;'));
    assert.ok(src.includes('if (req.mode !== "navigate") return;'));
    assert.ok(!/\/api\//.test(src.replace(/\/\*[\s\S]*?\*\//g, "")));
  });

  test("une session terminée vide les pages gardées", () => {
    assert.ok(src.includes("await caches.delete(USER);"));
  });
});

describe("manifest", () => {
  const m = manifest();
  test("il remplit les critères d'installation", () => {
    assert.equal(m.display, "standalone");
    assert.equal(m.start_url, "/m");
    assert.ok(m.name && m.short_name);
    const sizes = (m.icons ?? []).map((i) => i.sizes);
    assert.ok(sizes.includes("192x192") && sizes.includes("512x512"));
    assert.ok((m.icons ?? []).some((i) => i.purpose === "maskable"));
  });
});

describe("projet APK", () => {
  const twa = JSON.parse(readFileSync("twa/twa-manifest.json", "utf8"));

  test("package et domaine sont figés : les changer impose de tout réinstaller", () => {
    assert.equal(twa.packageId, "ma.comanet.os");
    assert.equal(twa.host, "app.comanet.ma");
  });

  test("toutes les adresses de l'APK pointent sur ce domaine et sur le point d'entrée du manifest", () => {
    for (const k of ["iconUrl", "maskableIconUrl", "webManifestUrl"]) assert.equal(new URL(twa[k]).host, twa.host, k);
    assert.equal(twa.startUrl, manifest().start_url);
  });

  test("GPS et notifications sont dans le premier APK : les ajouter plus tard ferait réinstaller", () => {
    assert.equal(twa.features.locationDelegation.enabled, true);
    assert.equal(twa.enableNotifications, true);
  });
});

describe("objectif du mois", () => {
  test("sans objectif, rien n'est estimé", () => {
    assert.deepEqual(monthFigures(120, 0, 30), { objectiveUnits: null, gapUnits: null, completionPct: null, dayObjectiveUnits: null });
  });

  test("écart, atteinte et moyenne du jour", () => {
    assert.deepEqual(monthFigures(90, 300, 30), { objectiveUnits: 300, gapUnits: -210, completionPct: 30, dayObjectiveUnits: 10 });
  });
});
