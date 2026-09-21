/**
 * STOCK CHEZ LE CLIENT — décisions pures, sans base de données.
 *
 * Définition officielle (une notion = une fonction) :
 *   - stock actuel d'un produit chez un client = DERNIER relevé (`latestByProduct`) ;
 *   - ancienneté d'un relevé (`agingOf`) : seuils dans `settings.clientStock`, jamais en dur ;
 *   - écart entre deux relevés (`deltaOf`) ;
 *   - couverture estimée en semaines (`estimatedCoverageWeeks`) : une ESTIMATION, affichée comme telle ;
 *   - qui peut relever, par canal (`canRecordReading`).
 *
 * Testé dans `tests/client-stock.test.ts`. Le module serveur `client-stock.ts` ne fait
 * que lire et écrire en base et appeler ces fonctions.
 */
import type { ClientStockSettings } from "@/lib/settings";
import { can, type PermissionSet } from "@/lib/permissions-shared";
import type { ScopeKey } from "@/lib/access-shared";

export type ClientStockChannel = "ANIMATION" | "TOURNEE_COMMERCIALE" | "IMPORT";

export const CHANNEL_LABELS: Record<ClientStockChannel, string> = {
  ANIMATION: "Animation",
  TOURNEE_COMMERCIALE: "Tournée",
  IMPORT: "Import",
};

export const CHANNEL_TONES: Record<ClientStockChannel, "accent" | "blue" | "gray"> = {
  ANIMATION: "accent",
  TOURNEE_COMMERCIALE: "blue",
  IMPORT: "gray",
};

/** Un relevé tel que lu en base (dates ISO `AAAA-MM-JJ`). */
export type Reading = {
  id: string;
  productId: string;
  quantity: number;
  readAt: string;
  createdAt: string;
  userId: string | null;
  userName: string | null;
  channel: ClientStockChannel;
  animationId: string | null;
  comment: string | null;
};

export type LatestReading = { latest: Reading; previous: Reading | null; history: Reading[] };

/**
 * Dernier relevé par produit. Deux relevés le même jour sont départagés par leur ordre
 * d'écriture (`createdAt`) : le plus récent gagne. L'historique est rendu du plus récent
 * au plus ancien.
 */
export function latestByProduct(readings: Reading[]): Map<string, LatestReading> {
  const byProduct = new Map<string, Reading[]>();
  for (const r of readings) {
    if (!byProduct.has(r.productId)) byProduct.set(r.productId, []);
    byProduct.get(r.productId)!.push(r);
  }
  const out = new Map<string, LatestReading>();
  for (const [productId, list] of byProduct) {
    const history = [...list].sort((a, b) => b.readAt.localeCompare(a.readAt) || b.createdAt.localeCompare(a.createdAt));
    out.set(productId, { latest: history[0], previous: history[1] ?? null, history });
  }
  return out;
}

export type Aging = "fresh" | "aging" | "stale" | "never";

export const AGING_META: Record<Aging, { label: string; tone: "green" | "orange" | "red" | "gray" }> = {
  fresh: { label: "Récent", tone: "green" },
  aging: { label: "À vérifier", tone: "orange" },
  stale: { label: "À refaire", tone: "red" },
  never: { label: "Jamais relevé", tone: "gray" },
};

const DAY_MS = 86_400_000;

/** Jours écoulés entre un relevé (ISO) et aujourd'hui, en dates UTC. */
export function ageDays(readAt: string | null | undefined, today: Date): number | null {
  if (!readAt) return null;
  const t = Date.parse(`${readAt}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.floor((now - t) / DAY_MS));
}

/** Ancienneté d'un relevé : vert < freshDays, orange < staleDays, rouge au-delà, gris si jamais relevé. */
export function agingOf(readAt: string | null | undefined, today: Date, s: Pick<ClientStockSettings, "freshDays" | "staleDays">): Aging {
  const d = ageDays(readAt, today);
  if (d === null) return "never";
  if (d < s.freshDays) return "fresh";
  if (d < s.staleDays) return "aging";
  return "stale";
}

/** Écart de quantité entre le dernier relevé et le précédent ; `null` sans relevé précédent. */
export function deltaOf(latest: Pick<Reading, "quantity"> | null, previous: Pick<Reading, "quantity"> | null): number | null {
  if (!latest || !previous) return null;
  return latest.quantity - previous.quantity;
}

/**
 * Couverture ESTIMÉE en semaines : stock relevé ÷ rythme hebdomadaire de sell-in Sage sur la
 * fenêtre. Le sell-in est ce que COMANET a livré : c'est un proxy de ce que le point de vente
 * écoule, pas une mesure. Sans livraison sur la fenêtre, rien n'est estimé (`null`).
 * Le sell-out animatrice est affiché à côté, jamais additionné au sell-in.
 */
export function estimatedCoverageWeeks(p: { stock: number; sellInUnits: number; windowDays: number }): number | null {
  if (p.windowDays <= 0 || !(p.sellInUnits > 0)) return null;
  const weekly = p.sellInUnits / (p.windowDays / 7);
  if (!(weekly > 0)) return null;
  return Math.round((p.stock / weekly) * 10) / 10;
}

export type RecordingActor = {
  userId: string;
  perms: PermissionSet;
  scope: ScopeKey;
  /** Clients assignés (portée ASSIGNED). */
  clientIds: string[];
};

/**
 * Qui peut relever, par canal :
 *   - ANIMATION : Créer sur Terrain ; en portée OWN, uniquement ses propres animations ;
 *   - TOURNEE_COMMERCIALE : Créer sur Clients ; en portée ASSIGNED / OWN, uniquement les clients de son portefeuille ;
 *   - IMPORT : Créer sur Clients, sans restriction de portée (réservé au moteur d'import).
 */
export function canRecordReading(
  actor: RecordingActor,
  p: { channel: ClientStockChannel; clientId: string; animatriceId?: string | null },
): boolean {
  switch (p.channel) {
    case "ANIMATION":
      if (!can(actor.perms, "terrain", "create")) return false;
      return actor.scope !== "OWN" || p.animatriceId === actor.userId;
    case "TOURNEE_COMMERCIALE":
      if (!can(actor.perms, "clients", "create")) return false;
      return actor.scope === "ALL" || actor.clientIds.includes(p.clientId);
    case "IMPORT":
      return can(actor.perms, "clients", "create");
  }
}

/** Lignes envoyées par un formulaire de relevé, en chaînes brutes. */
export type RawReadingLine = { productId: string; qty: string; changed: boolean };

export type ParsedReadingLine = { productId: string; quantity: number };

/**
 * Lit les lignes d'un relevé. `full = true` retient toutes les lignes renseignées (relevé
 * complet) ; sinon seules les lignes marquées modifiées. Une quantité illisible ou négative
 * est refusée (jamais convertie en 0) ; une ligne vide est ignorée.
 */
export function parseReadingLines(lines: RawReadingLine[], full: boolean): { ok: true; lines: ParsedReadingLine[] } | { ok: false; error: "quantite" } {
  const out: ParsedReadingLine[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    const productId = l.productId.trim();
    if (!productId || seen.has(productId)) continue;
    if (!full && !l.changed) continue;
    const v = l.qty.trim().replace(",", ".");
    if (v === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return { ok: false, error: "quantite" };
    seen.add(productId);
    out.push({ productId, quantity: n });
  }
  return { ok: true, lines: out };
}
