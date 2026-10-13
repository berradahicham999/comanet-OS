/**
 * Reprise des factures de vente en bloc émises dans Sage (COSPHARMA STE), pour que le P&L lise leur CA et leur coût
 * (décision du 12/10/2026, `importBulkInvoices()` dans `src/lib/gestion/documents.ts`).
 *
 * Fichier JSON : [{ "number": "FA…", "date": "2026-02-19", "paid": true,
 *                   "lines": [{ "productRef": "GAM01", "quantity": "120", "freeQuantity": "0", "unitPriceHt": "150.00", "discountPct": "0" }] }]
 *
 *   DATABASE_URL=… node --conditions=react-server --import tsx scripts/reprise-ventes-bloc.ts factures.json            # contrôle, rien n'est écrit
 *   DATABASE_URL=… node --conditions=react-server --import tsx scripts/reprise-ventes-bloc.ts factures.json --apply    # écrit
 *
 * Exige le client « vente en bloc » dans Paramètres → Gestion. Idempotent : un numéro déjà repris est ignoré.
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";

async function main() {
  const file = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!file) {
    console.error("Usage : scripts/reprise-ventes-bloc.ts <factures.json> [--apply]");
    process.exit(1);
  }
  const rows = JSON.parse(readFileSync(file, "utf8"));
  const { db } = await import("@/db");
  const { importBulkInvoices } = await import("@/lib/gestion/documents");
  const u = (await db.execute<{ id: string; name: string }>(sql`select id, name from users where active order by created_at limit 1`)).rows[0];
  const res = await importBulkInvoices(rows, { id: u.id, name: `${u.name} (reprise)` }, { apply });
  for (const p of res.preview) console.log(`${p.number} : ${p.lines} ligne(s), ${p.netHt} MAD HT, ${p.ttc} MAD TTC`);
  for (const s of res.skipped) console.log(`ignorée — ${s}`);
  console.log(apply ? `${res.inserted} facture(s) reprise(s).` : "Contrôle seulement : relancez avec --apply pour écrire.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
