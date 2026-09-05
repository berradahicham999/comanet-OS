import * as XLSX from "xlsx";

export type ParsedSheet = { name: string; headers: string[]; rows: Record<string, unknown>[]; headerRow: number; totalRows: number };

/** Liste les feuilles d'un fichier (xlsx/xls/csv). */
export function listSheets(buffer: ArrayBuffer | Buffer): string[] {
  const wb = XLSX.read(buffer, { type: "buffer", bookSheets: true });
  return wb.SheetNames;
}

/**
 * Parse une feuille en tableau d'objets. Détecte la ligne d'en-tête
 * (première ligne avec ≥ 3 cellules texte non vides).
 */
export function parseSheet(buffer: ArrayBuffer | Buffer, sheetName?: string, opts: { headerRow?: number; maxRows?: number; stopAtBlank?: boolean } = {}): ParsedSheet {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: true });
  const name = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
  const ws = wb.Sheets[name];
  const matrix: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
  let headerRow = opts.headerRow ?? -1;
  if (headerRow < 0) {
    headerRow = matrix.findIndex((r) => r.filter((c) => typeof c === "string" && c.trim()).length >= 3);
    if (headerRow < 0) headerRow = 0;
  }
  const rawHeaders = (matrix[headerRow] ?? []).map((h, i) => (h === null || h === undefined || String(h).trim() === "" ? `col_${i + 1}` : String(h).trim()));
  // dédoublonner les en-têtes
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h) => {
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    return n ? `${h} (${n + 1})` : h;
  });
  const rows: Record<string, unknown>[] = [];
  for (let i = headerRow + 1; i < matrix.length; i++) {
    const r = matrix[i];
    if (!r || r.every((c) => c === null || c === undefined || String(c).trim() === "")) {
      if (opts.stopAtBlank) break;
      continue;
    }
    const obj: Record<string, unknown> = {};
    headers.forEach((h, j) => { obj[h] = r[j] ?? null; });
    rows.push(obj);
    if (opts.maxRows && rows.length >= opts.maxRows) break;
  }
  return { name, headers, rows, headerRow, totalRows: rows.length };
}
