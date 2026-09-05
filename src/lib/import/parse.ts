import * as XLSX from "xlsx";

export type ParsedSheet = {
  name: string; headers: string[]; rows: Record<string, unknown>[]; headerRow: number; totalRows: number;
  /** Libellé de regroupement au-dessus de chaque colonne (ligne juste avant l'en-tête, reportée vers la droite).
   *  Utilisé par la matrice d'animations, où la marque est indiquée au-dessus des colonnes produits. */
  groups: Record<string, string>;
};

/**
 * Encodage d'un CSV. Les exports de régie (Meta, TikTok, Google) sont en UTF-8,
 * ceux de Sage et d'Excel Windows en Windows-1252 : sans détection, les accents
 * arrivent en « publicitÃ©s » et les colonnes ne sont plus reconnues.
 * On ne touche pas aux .xlsx, qui portent leur propre encodage.
 */
function codepageFor(buffer: ArrayBuffer | Buffer): number | undefined {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  // Un classeur binaire (xlsx = zip « PK », xls = OLE « \xD0\xCF ») : laisser SheetJS décider.
  if (buf.length >= 2 && ((buf[0] === 0x50 && buf[1] === 0x4b) || (buf[0] === 0xd0 && buf[1] === 0xcf))) return undefined;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 65001; // BOM UTF-8
  // Séquence UTF-8 valide multi-octets et aucun octet invalide → UTF-8.
  const sample = buf.subarray(0, 262144);
  let multibyte = false;
  for (let i = 0; i < sample.length; i++) {
    const c = sample[i];
    if (c < 0x80) continue;
    let extra = 0;
    if (c >= 0xc2 && c <= 0xdf) extra = 1;
    else if (c >= 0xe0 && c <= 0xef) extra = 2;
    else if (c >= 0xf0 && c <= 0xf4) extra = 3;
    else return 1252; // octet impossible en UTF-8
    for (let k = 1; k <= extra; k++) {
      const n = sample[i + k];
      if (n === undefined) return multibyte ? 65001 : 1252; // coupé par l'échantillon
      if (n < 0x80 || n > 0xbf) return 1252;
    }
    multibyte = true;
    i += extra;
  }
  return multibyte ? 65001 : undefined;
}

/** Liste les feuilles d'un fichier (xlsx/xls/csv). */
export function listSheets(buffer: ArrayBuffer | Buffer): string[] {
  const wb = XLSX.read(buffer, { type: "buffer", bookSheets: true, codepage: codepageFor(buffer) });
  return wb.SheetNames;
}

/**
 * Parse une feuille en tableau d'objets. Détecte la ligne d'en-tête
 * (première ligne avec ≥ 3 cellules texte non vides).
 */
export function parseSheet(buffer: ArrayBuffer | Buffer, sheetName?: string, opts: { headerRow?: number; maxRows?: number; stopAtBlank?: boolean } = {}): ParsedSheet {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: true, codepage: codepageFor(buffer) });
  const name = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
  const ws = wb.Sheets[name];
  const matrix: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
  let headerRow = opts.headerRow ?? -1;
  if (headerRow < 0) {
    const textCells = (r: unknown[] | undefined) => (r ?? []).filter((c) => typeof c === "string" && c.trim()).length;
    headerRow = matrix.findIndex((r) => textCells(r) >= 3);
    if (headerRow < 0) headerRow = 0;
    // Classeurs à double en-tête (matrice d'animations : une ligne de marques au-dessus des colonnes
    // produits) : si une ligne suivante est nettement plus fournie, c'est elle le véritable en-tête.
    for (let i = headerRow + 1; i < Math.min(headerRow + 4, matrix.length); i++) {
      if (textCells(matrix[i]) >= textCells(matrix[headerRow]) * 2) { headerRow = i; break; }
    }
  }
  const rawHeaders = (matrix[headerRow] ?? []).map((h, i) => (h === null || h === undefined || String(h).trim() === "" ? `col_${i + 1}` : String(h).trim()));
  // dédoublonner les en-têtes
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h) => {
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    return n ? `${h} (${n + 1})` : h;
  });
  // Ligne de regroupement (au-dessus de l'en-tête) : « AUR », « GAMARDE »… reportée sur les colonnes suivantes.
  const groups: Record<string, string> = {};
  if (headerRow > 0) {
    const gr = matrix[headerRow - 1] ?? [];
    let current = "";
    headers.forEach((h, j) => {
      const g = gr[j];
      if (g !== null && g !== undefined && String(g).trim()) current = String(g).trim();
      if (current) groups[h] = current;
    });
  }
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
  return { name, headers, rows, headerRow, totalRows: rows.length, groups };
}
