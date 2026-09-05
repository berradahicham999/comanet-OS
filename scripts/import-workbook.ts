/**
 * Charge le classeur « Compilé 2026 vf.xlsx » (ventes 2024→2026, correspondances, stock,
 * objectifs 2026, budgets marketing 2026) dans COMANET OS.
 *
 *   npx tsx scripts/import-workbook.ts /chemin/vers/Compile_2026_vf.xlsx [--reset]
 *
 * Même moteur que l'interface (/imports) et que la page /installation en ligne.
 */
import "dotenv/config";
import fs from "node:fs";
import { importWorkbook } from "../src/lib/import/workbook";

const file = process.argv[2];
if (!file) { console.error("Usage: tsx scripts/import-workbook.ts <fichier.xlsx> [--reset]"); process.exit(1); }
const reset = process.argv.includes("--reset");
const buffer = fs.readFileSync(file);
const fileName = file.split("/").pop()!;

importWorkbook(buffer, fileName, { reset, log: (l) => console.log(l) })
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
