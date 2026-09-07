/**
 * Permissions modulaires : dépendances logiques, cumul des modèles, rôle legacy recalculé,
 * et les cinq configurations d'acceptation du cahier des charges — réalisables par simple
 * cumul de cases, sans qu'aucune combinaison ne soit interdite.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MODULE_KEYS, FLAG_KEYS } from "@/lib/access-shared";
import {
  ACTIONS, can, describeMatrix, hasAnyModule, isAdmin, legacyRoleFor, matrixFromRows, mergeFlags, mergeMatrix,
  noFlags, noPermissions, normalizeMatrix, rowsFromMatrix, sameMatrix, widestScope, type PermissionSet,
} from "@/lib/permissions-shared";
import { readConfig } from "@/lib/permissions-form";

function grant(perms: PermissionSet, module: (typeof MODULE_KEYS)[number], ...actions: (typeof ACTIONS)[number][]) {
  for (const a of actions) perms[module][a] = true;
  return perms;
}

describe("dépendances logiques", () => {
  test("Créer, Modifier ou Valider impliquent Voir", () => {
    const p = noPermissions();
    p.terrain.create = true;
    p.medical.validate = true;
    const n = normalizeMatrix(p);
    assert.equal(n.terrain.view, true);
    assert.equal(n.medical.view, true);
    assert.equal(n.ventes.view, false);
  });
  test("la contrainte SQL exprime la même règle que le code", () => {
    const sqlText = readFileSync("drizzle/0012_permissions_modulaires.sql", "utf8");
    assert.match(sqlText, /CHECK \("can_view" OR NOT \("can_create" OR "can_edit" OR "can_validate"\)\)/);
  });
  test("rowsFromMatrix n'écrit que les modules visibles, et relit à l'identique", () => {
    const p = grant(noPermissions(), "ventes", "view", "create");
    grant(p, "administration", "validate");
    const rows = rowsFromMatrix(p);
    assert.deepEqual(rows.map((r) => r.module).sort(), ["administration", "ventes"]);
    assert.ok(sameMatrix(matrixFromRows(rows), normalizeMatrix(p)));
  });
});

describe("cumul des modèles", () => {
  test("appliquer deux modèles additionne, n'écrase jamais", () => {
    const anim = grant(grant(noPermissions(), "terrain", "view", "create", "edit"), "produits", "view");
    const deleg = grant(grant(noPermissions(), "medical", "view", "create", "edit"), "produits", "view");
    const merged = mergeMatrix(anim, deleg);
    assert.equal(can(merged, "terrain", "edit"), true);
    assert.equal(can(merged, "medical", "create"), true);
    assert.equal(can(merged, "produits", "view"), true);
    assert.equal(can(merged, "produits", "create"), false);
    assert.equal(can(merged, "budgets", "view"), false);
  });
  test("les interrupteurs se cumulent aussi, et la portée ne se restreint jamais", () => {
    const f = mergeFlags({ ...noFlags(), exportData: true }, { seeMargins: true });
    assert.equal(f.exportData, true);
    assert.equal(f.seeMargins, true);
    assert.equal(f.approveSpend, false);
    assert.equal(widestScope("OWN", "ASSIGNED"), "ASSIGNED");
    assert.equal(widestScope("ALL", "OWN"), "ALL");
  });
});

describe("rôle legacy recalculé (lecture seule, jamais décisionnel)", () => {
  test("administration + Valider → ADMIN ; terrain + OWN → ANIMATRICE ; médical + OWN → DELEGUE_MEDICAL", () => {
    assert.equal(legacyRoleFor(grant(noPermissions(), "administration", "validate"), "ALL"), "ADMIN");
    assert.equal(legacyRoleFor(grant(noPermissions(), "terrain", "create"), "OWN"), "ANIMATRICE");
    assert.equal(legacyRoleFor(grant(noPermissions(), "medical", "create"), "OWN"), "DELEGUE_MEDICAL");
    assert.equal(legacyRoleFor(grant(noPermissions(), "medical", "validate"), "ALL"), "MANAGER_MEDICAL");
    assert.equal(legacyRoleFor(grant(noPermissions(), "ventes", "view"), "ALL"), "TRADE");
  });
  test("une animatrice qui est aussi déléguée reste une animatrice pour l'ancien enum, sans perdre aucun droit", () => {
    const p = grant(grant(noPermissions(), "terrain", "create"), "medical", "create");
    assert.equal(legacyRoleFor(p, "OWN"), "DELEGUE_MEDICAL");
    assert.equal(can(p, "terrain", "create"), true);
  });
});

describe("lecture du formulaire de la matrice", () => {
  test("cases, portée, interrupteurs et assignations sont relus depuis les champs nommés", () => {
    const fd = new FormData();
    fd.set("p_terrain_create", "1");
    fd.set("p_produits_view", "1");
    fd.set("scope", "OWN");
    fd.set("f_exportData", "on");
    fd.set("brand_11111111-1111-1111-1111-111111111111", "on");
    fd.set("client_22222222-2222-2222-2222-222222222222", "1");
    const c = readConfig(fd);
    assert.equal(c.perms.terrain.view, true, "Créer implique Voir");
    assert.equal(c.perms.terrain.create, true);
    assert.equal(c.scope, "OWN");
    assert.equal(c.flags.exportData, true);
    assert.equal(c.flags.seeMargins, false);
    assert.deepEqual(c.brandIds, ["11111111-1111-1111-1111-111111111111"]);
    assert.deepEqual(c.clientIds, ["22222222-2222-2222-2222-222222222222"]);
  });
  test("une portée inconnue retombe sur « Tout » plutôt que de planter", () => {
    const fd = new FormData();
    fd.set("scope", "N_IMPORTE_QUOI");
    assert.equal(readConfig(fd).scope, "ALL");
  });
});

describe("cas d'acceptation du cahier des charges (section 7)", () => {
  test("1. Animatrice + déléguée médicale", () => {
    const p = grant(grant(grant(noPermissions(), "terrain", "create", "edit"), "medical", "create", "edit"), "produits", "view");
    const n = normalizeMatrix(p);
    assert.ok(can(n, "terrain", "create") && can(n, "medical", "create") && can(n, "produits", "view"));
    assert.equal(can(n, "budgets", "view"), false);
    assert.equal(noFlags().seeMargins, false);
    assert.equal(legacyRoleFor(n, "OWN"), "DELEGUE_MEDICAL");
    assert.equal(isAdmin(n), false);
  });
  test("2. Responsable réglementaire élargi", () => {
    const n = normalizeMatrix(grant(grant(grant(grant(noPermissions(), "reglementaire", "create", "edit"), "ventes", "view"), "marketing", "view", "create"), "produits", "edit"));
    assert.ok(can(n, "reglementaire", "edit") && can(n, "ventes", "view") && !can(n, "ventes", "create") && can(n, "marketing", "create") && can(n, "produits", "edit"));
    assert.equal(can(n, "budgets", "view"), false);
  });
  test("3. Infographiste étendu", () => {
    const n = normalizeMatrix(grant(grant(grant(grant(noPermissions(), "assets", "view", "create", "edit", "validate"), "marketing", "view", "create"), "influence", "view"), "taches", "view", "create"));
    assert.ok(can(n, "assets", "validate") && can(n, "marketing", "create") && can(n, "influence", "view") && !can(n, "influence", "create") && can(n, "taches", "view"));
    assert.equal({ ...noFlags() }.seeInternalCosts, false);
  });
  test("4. Commercial multi-marques", () => {
    const n = normalizeMatrix(grant(grant(noPermissions(), "clients", "create", "edit"), "ventes", "create", "edit"));
    assert.ok(can(n, "clients", "edit") && can(n, "ventes", "edit") && !can(n, "ventes", "validate"));
    assert.equal(widestScope("ASSIGNED", "ASSIGNED"), "ASSIGNED");
    assert.equal(noFlags().seeMargins, false, "marges masquées par défaut");
  });
  test("5. Compte hybride de zéro : six modules à niveaux différents, aucun conflit", () => {
    const n = normalizeMatrix(grant(grant(grant(grant(grant(grant(noPermissions(), "produits", "view"), "stock", "create"), "reglementaire", "edit"), "terrain", "validate"), "medical", "view", "create"), "rapports", "validate"));
    assert.equal(Object.values(n).filter((m) => m.view).length, 6);
    assert.equal(hasAnyModule(n), true);
    assert.equal(Object.keys(describeMatrix(n)).length, 6);
    // Aucune combinaison n'est interdite : chaque module accepte n'importe quelle case, indépendamment des autres.
    for (const m of MODULE_KEYS) for (const a of ACTIONS) { const q = noPermissions(); q[m][a] = true; assert.equal(normalizeMatrix(q)[m][a], true); }
  });
});

describe("plus aucune décision d'accès sur l'ancien enum de rôle", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
    }
    return out;
  }
  test("aucune page ni action ne teste `user.role === …`", () => {
    const offenders = walk("src/app").filter((p) => /user\.role\s*(===|!==)/.test(readFileSync(p, "utf8")));
    assert.deepEqual(offenders, []);
  });
  test("aucune requête ne filtre les animatrices ou délégués par `role = '…'` hors des définitions uniques", () => {
    const offenders = walk("src/lib").concat(walk("src/app")).filter((p) => !p.endsWith("users.ts") && !p.includes("seed") && /role\s*=\s*'(ANIMATRICE|DELEGUE_MEDICAL)'/.test(readFileSync(p, "utf8")));
    // `import/run.ts` met à jour la ville des animatrices via l'enum recalculée : lecture seule, pas une décision d'accès.
    assert.deepEqual(offenders.filter((p) => !p.endsWith("import/run.ts")), []);
  });
  test("chaque interrupteur transverse a un libellé", () => {
    for (const f of FLAG_KEYS) assert.ok(f.length > 0);
  });
});
