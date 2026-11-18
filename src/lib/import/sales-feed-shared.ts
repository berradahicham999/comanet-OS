/**
 * Flux de ventes automatique — partie pure (lecture du classeur, clés stables, fenêtre, garde-fou).
 *
 * Le fichier type est celui de Pharmafirst pour Auracos : un classeur réécrit chaque heure, onglet « Detail »
 * (Date, Piece, Type, Client, Commercial, Ville, Unites, CA HT, Remarque) sous un titre
 * « Detail des lignes · PRO COLLAGENIUM 25ML · 2026 », et un onglet « Synthese » qui porte l'heure de mise à jour.
 *
 * Trois particularités imposent une clé à part (et non `saleLineHash()` avec le numéro de ligne) :
 *  · le détail est trié du plus récent au plus ancien : chaque nouvelle vente décale toutes les lignes ;
 *  · un même BL peut porter des lignes strictement identiques qui sont de vraies ventes (BL261091) ;
 *  · un avoir n'a pas de numéro de pièce.
 * La clé = contenu de la ligne + rang d'apparition parmi les lignes identiques : stable d'une heure à l'autre.
 */
import * as XLSX from "xlsx";
import { createHash } from "crypto";
import { cleanText, normKey, toISODate, toNumber } from "./normalize";

export type FeedLine = {
  /** Ligne du classeur (1 = première ligne), pour les messages. */
  row: number;
  date: string;
  piece: string | null;
  type: string | null;
  client: string;
  rep: string | null;
  city: string | null;
  quantity: number;
  amount: number;
  remark: string | null;
  product: string;
  isSample: boolean;
};

export type ParsedFeed = {
  sheet: string;
  /** « 17/11/2026 22:20 » : heure de mise à jour écrite par le prestataire (affichage seulement). */
  stamp: string | null;
  /** Années couvertes par le fichier (titre « · 2026 », sinon dates des lignes). */
  years: number[];
  lines: FeedLine[];
  errors: { row: number; message: string }[];
};

const COLUMNS = {
  date: ["DATE"],
  piece: ["PIECE", "N PIECE", "BL", "N BL"],
  type: ["TYPE"],
  client: ["CLIENT", "RAISON SOCIALE"],
  rep: ["COMMERCIAL", "REPRESENTANT", "VENDEUR"],
  city: ["VILLE"],
  quantity: ["UNITES", "QTE", "QUANTITE"],
  amount: ["CA HT", "MONTANT HT", "TOTAL HT"],
  remark: ["REMARQUE", "OBSERVATION"],
  product: ["PRODUIT", "ARTICLE", "DESIGNATION"],
} as const;
type Col = keyof typeof COLUMNS;
const REQUIRED: Col[] = ["date", "client", "quantity", "amount"];

/** Lien de partage (Google Drive, Google Sheets, OneDrive…) → adresses de téléchargement à essayer dans l'ordre. */
export function feedDownloadUrls(link: string): string[] {
  const url = link.trim();
  const id = url.match(/\/d\/([A-Za-z0-9_-]{20,})/)?.[1] ?? (/google\.com/.test(url) ? url.match(/[?&]id=([A-Za-z0-9_-]{20,})/)?.[1] : undefined);
  if (!id) return [url];
  // Un .xlsx déposé sur le Drive se télécharge par `uc` ; une vraie feuille Google s'exporte.
  return [
    `https://drive.google.com/uc?export=download&id=${id}`,
    `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`,
  ];
}

/** Un classeur xlsx est une archive zip : il commence par « PK ». Une page HTML (connexion Google) ne l'est pas. */
export function looksLikeXlsx(data: Uint8Array): boolean {
  return data.length > 4 && data[0] === 0x50 && data[1] === 0x4b;
}

/** Échantillon gratuit : remarque « Echantillon » ou client « ECHANTILLON ». */
export function isSampleLine(client: string, remark: string | null): boolean {
  return normKey(client) === "ECHANTILLON" || normKey(remark).includes("ECHANTILLON");
}

/** « MARRAKECH PHAR (AMAL MICHMICH) (comptoir) » → le client, sans la mention de vente au comptoir. */
export function feedClientName(raw: string): string {
  return raw.replace(/\s*\(\s*comptoir\s*\)\s*$/i, "").trim();
}

function headerIndex(row: unknown[]): Partial<Record<Col, number>> | null {
  const keys = row.map((c) => normKey(c));
  const out: Partial<Record<Col, number>> = {};
  for (const col of Object.keys(COLUMNS) as Col[]) {
    const i = keys.findIndex((k) => (COLUMNS[col] as readonly string[]).includes(k));
    if (i >= 0) out[col] = i;
  }
  return REQUIRED.every((c) => out[c] !== undefined) ? out : null;
}

/** « … · PRO COLLAGENIUM 25ML · 2026 » → produit et année du titre. */
function titleParts(title: string | null): { product: string | null; year: number | null } {
  if (!title) return { product: null, year: null };
  const parts = title.split(/\s*[·|]\s*/).map((p) => p.trim()).filter(Boolean);
  const yearPart = parts.find((p) => /^(19|20)\d{2}$/.test(p));
  const product = parts.length >= 2 ? parts.filter((p) => p !== yearPart).slice(-1)[0] ?? null : null;
  return { product: product && !/d[eé]tail/i.test(product) ? product : null, year: yearPart ? Number(yearPart) : null };
}

/**
 * Lit le classeur du prestataire. Les dates sont lues en numéro de série (pas en objet Date) : une conversion
 * par le fuseau de la machine décalerait d'un jour les ventes d'été sur un poste à l'heure de Casablanca.
 */
export function parseFeedWorkbook(data: Uint8Array): ParsedFeed {
  const wb = XLSX.read(data, { type: "array", cellDates: false });
  let found: { name: string; matrix: unknown[][]; hdr: number; idx: Partial<Record<Col, number>> } | null = null;
  const order = [...wb.SheetNames].sort((a, b) => Number(/d[eé]tail/i.test(b)) - Number(/d[eé]tail/i.test(a)));
  for (const name of order) {
    const matrix: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true });
    for (let r = 0; r < Math.min(matrix.length, 30); r++) {
      const idx = headerIndex(matrix[r] ?? []);
      if (idx) { found = { name, matrix, hdr: r, idx }; break; }
    }
    if (found) break;
  }
  if (!found) throw new Error("Aucun onglet de détail reconnu : il faut une ligne d'en-tête avec Date, Client, Unites et CA HT.");

  // Heure de mise à jour : « Mis a jour le 17/11/2026 a 22:20 » dans n'importe quel onglet, en tête.
  let stamp: string | null = null;
  for (const name of wb.SheetNames) {
    const matrix: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
    for (const row of matrix.slice(0, 5)) for (const cell of row ?? []) {
      const m = String(cell ?? "").match(/mis\s+a\s+jour\s+le\s+(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+(?:a|à)\s+(\d{1,2}:\d{2}))?/i);
      if (m && !stamp) stamp = m[2] ? `${m[1]} ${m[2]}` : m[1];
    }
  }

  const { matrix, hdr, idx, name } = found;
  const title = matrix.slice(0, hdr).flat().map((c) => cleanText(c)).find((c) => !!c && c.includes("·")) ?? null;
  const fromTitle = titleParts(title);
  const at = (row: unknown[], col: Col) => (idx[col] === undefined ? null : row[idx[col]!]);
  const lines: FeedLine[] = [];
  const errors: ParsedFeed["errors"] = [];
  for (let r = hdr + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    if (row.every((c) => c === null || c === "")) continue;
    const rowNo = r + 1;
    const date = toISODate(at(row, "date"));
    const client = cleanText(at(row, "client"));
    const quantity = toNumber(at(row, "quantity"));
    const amount = toNumber(at(row, "amount"));
    const product = cleanText(at(row, "product")) ?? fromTitle.product;
    if (!date) { errors.push({ row: rowNo, message: "Date absente ou illisible" }); continue; }
    if (!client) { errors.push({ row: rowNo, message: "Client absent" }); continue; }
    if (quantity === null) { errors.push({ row: rowNo, message: "Unités absentes" }); continue; }
    if (amount === null) { errors.push({ row: rowNo, message: "CA HT absent" }); continue; }
    if (!product) { errors.push({ row: rowNo, message: "Produit inconnu : ni colonne Produit, ni produit dans le titre de l'onglet" }); continue; }
    const remark = cleanText(at(row, "remark"));
    const rep = cleanText(at(row, "rep"));
    lines.push({
      row: rowNo, date, piece: cleanText(at(row, "piece")), type: cleanText(at(row, "type")), client,
      rep: rep && normKey(rep) !== "NON ATTRIBUE" ? rep : null, city: cleanText(at(row, "city")),
      quantity, amount, remark, product, isSample: isSampleLine(client, remark),
    });
  }
  const years = fromTitle.year ? [fromTitle.year] : [...new Set(lines.map((l) => Number(l.date.slice(0, 4))))].sort();
  return { sheet: name, stamp, years, lines, errors };
}

/**
 * Clé stable d'une ligne du flux : contenu + rang parmi les lignes identiques. Deux lignes identiques d'un même BL
 * gardent deux clés ; une ligne qui change de place dans le fichier garde la sienne.
 */
export function feedLineKeys(site: string, lines: Pick<FeedLine, "date" | "piece" | "type" | "client" | "product" | "quantity" | "amount">[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base = [site.toUpperCase(), l.date, normKey(l.piece), normKey(l.type), normKey(l.client), normKey(l.product), l.quantity.toFixed(2), l.amount.toFixed(2)].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return "FEED:" + createHash("sha1").update(`${base}|${n}`).digest("hex");
  });
}

/**
 * Fenêtre remplacée par le flux : des années couvertes par le fichier, jamais avant `from`. Un fichier de 2027 ne
 * touche donc pas aux ventes 2026 déjà synchronisées.
 */
export function feedWindow(years: number[], from: string): { from: string; to: string } | null {
  if (!years.length) return null;
  const start = `${Math.min(...years)}-01-01`;
  const to = `${Math.max(...years)}-12-31`;
  const f = start > from ? start : from;
  return f <= to ? { from: f, to } : null;
}

/**
 * Garde-fou : le fichier ferait-il baisser le CA déjà enregistré sur la fenêtre de plus de `maxDropPct` % ?
 * Un fichier tronqué ou un mauvais export ne doit pas effacer l'historique en silence.
 */
export function feedDropMessage(before: number, after: number, maxDropPct: number): string | null {
  if (before <= 0) return null;
  const drop = (before - after) / before * 100;
  if (drop <= maxDropPct) return null;
  return `Le fichier ferait baisser le CA enregistré de ${Math.round(drop)} % (seuil : ${maxDropPct} %) : fichier tronqué ou mauvais export ? Rien n'a été modifié.`;
}

type FeedLike = { enabled: boolean; site: string; brandId: string | null; from: string | null };

/** Le flux est-il actif (activé, marque et date de départ choisies) ? */
export function feedActive(f: FeedLike): boolean {
  return f.enabled && !!f.brandId && !!f.from && !!f.site;
}

/**
 * Import manuel : une ligne du site et de la marque du flux, datée de `from` ou après, est ignorée — la même vente
 * vient du fichier relu chaque heure. Les autres marques du site restent importées.
 */
export function importSkippedForFeed(f: FeedLike, date: string, site: string | null, brandId: string | null): boolean {
  return feedActive(f) && !!site && !!brandId && site.toUpperCase() === f.site.toUpperCase() && brandId === f.brandId && date >= f.from!;
}
