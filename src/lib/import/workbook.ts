/**
 * Chargement du classeur compilé « Compilé 2026 vf.xlsx » (ventes 2024→2026, correspondances,
 * stock, objectifs, budgets marketing) — même moteur que l'interface /imports.
 *
 * Utilisé par `scripts/import-workbook.ts` (ligne de commande) et par la page /installation (en ligne).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { seedBase } from "@/db/seed-base";
import { listSheets, parseSheet } from "./parse";
import { autoMap } from "./fields";
import { runImport, type ImportSummary } from "./run";

export type WorkbookStep = { label: string; inserted: number; updated: number; duplicates: number; errors: number; warnings: string[]; firstErrors: string[]; skipped?: string };
export type WorkbookResult = {
  steps: WorkbookStep[];
  stats: { sales: number; ca: number; products: number; productsReview: number; clients: number; clientsReview: number };
};

/** Feuilles attendues (le nom est comparé sans espaces de bord ni casse). */
const SHEETS = {
  clients: "Correspondance CLIENTS",
  brands: "Correspondance MARQUES",
  sales: "Compil a a date",
  sales2024: "Sheet3",
  stock: "stock",
  objectives: "objectif 2026",
};

function findSheet(names: string[], wanted: string) {
  const k = wanted.trim().toLowerCase();
  return names.find((n) => n.trim().toLowerCase() === k) ?? null;
}

/**
 * Vide toutes les données importées (ventes, stock, clients, produits, budgets…) — conserve utilisateurs, marques et paramètres.
 *
 * Refusé dès que la gestion commerciale contient des données saisies dans l'application : le
 * TRUNCATE en cascade effacerait le journal de stock (d'ailleurs protégé par trigger) et
 * l'identité légale des clients, qu'aucun classeur ne permet de reconstituer.
 */
export async function resetImportedData() {
  const r = await db.execute<{ movements: number; legal: number }>(sql`
    select (select count(*)::int from stock_movements) as movements,
           (select count(*)::int from clients where legal_name is not null or ice is not null or account_code is not null) as legal`);
  const { movements, legal } = r.rows[0] ?? { movements: 0, legal: 0 };
  if (movements || legal) {
    throw new Error(`Réinitialisation refusée : la gestion commerciale contient ${movements} mouvement(s) de stock et ${legal} fiche(s) client complétée(s) dans l'application. Elles seraient effacées. Réimportez sans réinitialiser.`);
  }
  await db.execute(sql`TRUNCATE TABLE sales, stock_snapshots, product_aliases, client_aliases, objectives, budget_lines, budgets, imports, animation_lines, animations, regulatory_files, content_items, marketing_expenses, campaigns, task_comments, tasks, products, clients RESTART IDENTITY CASCADE`);
}

export async function importWorkbook(
  buffer: Buffer,
  fileName: string,
  opts: { reset?: boolean; userId?: string; log?: (line: string) => void } = {},
): Promise<WorkbookResult> {
  const log = opts.log ?? (() => {});
  const steps: WorkbookStep[] = [];
  const step = (label: string, r: ImportSummary) => {
    const s: WorkbookStep = { label, inserted: r.inserted, updated: r.updated, duplicates: r.duplicates, errors: r.errors.length, warnings: r.warnings, firstErrors: r.errors.slice(0, 5).map((e) => `L${e.row}: ${e.message}`) };
    steps.push(s);
    log(`▶ ${label}: ${r.inserted} insérés, ${r.updated} mis à jour, ${r.duplicates} doublons, ${r.errors.length} erreurs`);
    for (const w of r.warnings) log("  ⚠ " + w);
    if (s.firstErrors.length) log("  ✗ " + s.firstErrors.join(" | "));
    return s;
  };
  const skip = (label: string, reason: string) => {
    steps.push({ label, inserted: 0, updated: 0, duplicates: 0, errors: 0, warnings: [], firstErrors: [], skipped: reason });
    log(`○ ${label}: ignoré — ${reason}`);
  };

  if (opts.reset) {
    log("⚠️  Réinitialisation des données importées…");
    await resetImportedData();
  }
  await seedBase();
  const userId = opts.userId ?? ((await db.execute(sql`select id from users where email = 'hicham@comanet.ma'`)).rows[0]?.id as string | undefined);

  const names = listSheets(buffer);
  const sheet = (key: keyof typeof SHEETS) => findSheet(names, SHEETS[key]);

  // 1) Correspondance clients (raison sociale → client fonctionnel + ville)
  const corrName = sheet("clients");
  if (corrName) {
    const corr = parseSheet(buffer, corrName);
    step("Correspondance clients", await runImport({ type: "CLIENTS", rows: corr.rows, mapping: { name: "Client fonctionnel", rawName: "Clients", city: "Ville" }, fileName: `${fileName} · ${corr.name.trim()}`, userId }));
  } else skip("Correspondance clients", `feuille « ${SHEETS.clients} » absente`);

  // 2) Correspondance marques (désignation → marque) : crée les produits canoniques avec leur marque
  const brandsName = sheet("brands");
  if (brandsName) {
    const marques = parseSheet(buffer, brandsName);
    const longestFirst = [...marques.rows].sort((a, b) => String(b.Designation ?? "").length - String(a.Designation ?? "").length);
    step("Correspondance marques", await runImport({ type: "PRODUCTS", rows: longestFirst, mapping: { name: "Designation", brand: "Marque" }, fileName: `${fileName} · ${marques.name}`, userId }));
  } else skip("Correspondance marques", `feuille « ${SHEETS.brands} » absente`);

  // 3) Ventes compilées 2025 → 2026
  const salesName = sheet("sales");
  if (salesName) {
    const compil = parseSheet(buffer, salesName);
    const salesMap = autoMap("SALES", compil.headers);
    log("Mapping ventes : " + JSON.stringify(salesMap));
    step("Ventes 2025-2026 (Compil à date)", await runImport({ type: "SALES", rows: compil.rows, mapping: salesMap, fileName: `${fileName} · ${compil.name.trim()}`, userId }));
  } else skip("Ventes 2025-2026", `feuille « ${SHEETS.sales} » absente`);

  // 4) Ventes 2024 (Sheet3)
  const s3Name = sheet("sales2024");
  if (s3Name) {
    const s3 = parseSheet(buffer, s3Name);
    step("Ventes 2024 (Sheet3)", await runImport({ type: "SALES", rows: s3.rows, mapping: autoMap("SALES", s3.headers), fileName: `${fileName} · Sheet3 (2024)`, userId }));
  } else skip("Ventes 2024", `feuille « ${SHEETS.sales2024} » absente`);

  // 5) Stock
  const stockName = sheet("stock");
  if (stockName) {
    const stock = parseSheet(buffer, stockName);
    const stockMap = autoMap("STOCK", stock.headers);
    log("Mapping stock : " + JSON.stringify(stockMap));
    step("Stock", await runImport({ type: "STOCK", rows: stock.rows, mapping: stockMap, fileName: `${fileName} · stock`, userId, options: { stockDate: new Date().toISOString().slice(0, 10) } }));
  } else skip("Stock", `feuille « ${SHEETS.stock} » absente`);

  // 6) Objectifs 2026 (tableau 1 de la feuille « objectif 2026 ») + 7) budgets marketing 2026
  const objName = sheet("objectives");
  if (objName) {
    const obj = parseSheet(buffer, objName, { headerRow: 2, stopAtBlank: true });
    const objMap = autoMap("OBJECTIVES", obj.headers);
    log("Mapping objectifs : " + JSON.stringify(objMap));
    step("Objectifs 2026", await runImport({ type: "OBJECTIVES", rows: obj.rows, mapping: objMap, fileName: `${fileName} · objectif 2026`, userId, options: { year: 2026 } }));

    // Budgets : synthèse (ligne 74) + détail par catégorie (ligne 86)
    const bs = parseSheet(buffer, objName, { headerRow: 73, stopAtBlank: true });
    const bsMap = { brand: "Marque", amount: "Total budget marketing", referenceRevenue: "CA de référence (feuille M)", pct: "% budget marketing prévu" };
    step("Budgets 2026 — synthèse", await runImport({ type: "BUDGETS", rows: bs.rows, mapping: bsMap, fileName: `${fileName} · budgets 2026`, userId, options: { year: 2026 } }));
    const extra: Record<string, unknown>[] = [];
    for (const r of bs.rows) {
      for (const [col, label] of [["Montant FOC", "FOC (produits offerts)"], ["Échantillons VM", "Échantillons visite médicale"], ["Échantillons digital / cadeau", "Échantillons digital / cadeaux"]]) {
        const v = Number(r[col] ?? 0);
        if (v > 0) extra.push({ Marque: r.Marque, Catégorie: label, Budget: v });
      }
    }
    if (extra.length) step("Budgets 2026 — FOC & échantillons", await runImport({ type: "BUDGETS", rows: extra, mapping: { brand: "Marque", label: "Catégorie", amount: "Budget" }, fileName: `${fileName} · FOC & échantillons`, userId, options: { year: 2026 } }));
    const bl = parseSheet(buffer, objName, { headerRow: 85, stopAtBlank: true });
    const blMap = autoMap("BUDGETS", bl.headers);
    log("Mapping budgets (détail) : " + JSON.stringify(blMap));
    step("Budgets 2026 — détail par catégorie", await runImport({ type: "BUDGETS", rows: bl.rows, mapping: blMap, fileName: `${fileName} · budgets par catégorie`, userId, options: { year: 2026 } }));
  } else skip("Objectifs & budgets 2026", `feuille « ${SHEETS.objectives} » absente`);

  const stats = (await db.execute(sql`
    select (select count(*) from sales)::int as sales, (select coalesce(round(sum(amount)),0)::float8 from sales) as ca,
           (select count(*) from products)::int as products, (select count(*) from products where needs_review)::int as products_review,
           (select count(*) from clients)::int as clients, (select count(*) from clients where needs_review)::int as clients_review`)).rows[0] as Record<string, number>;
  const result: WorkbookResult = {
    steps,
    stats: { sales: stats.sales, ca: Number(stats.ca ?? 0), products: stats.products, productsReview: stats.products_review, clients: stats.clients, clientsReview: stats.clients_review },
  };
  log("✓ Terminé : " + JSON.stringify(result.stats));
  return result;
}
