/**
 * File d'envoi de l'app mobile — logique pure (`tests/mobile-outbox.test.ts`). L'accès à IndexedDB vit dans `outbox.ts`.
 *
 * Une saisie ne disparaît jamais en silence : elle sort de la file parce que le serveur l'a enregistrée, ou parce que la
 * personne l'abandonne elle-même depuis « À corriger ». Tout le reste reste sur le téléphone.
 */
export type OutboxKind = "ANIMATION" | "STOCK";

export type GpsFix = { lat: number | null; lng: number | null; accuracyM: number | null; error: string | null };

export type AnimationPayload = {
  clientId: string;
  /** Dernier jour : celui du relevé des ventes. */
  date: string;
  startDate?: string;
  lines: { productId: string; qty: string; stock: string }[];
  customersAdvised?: string;
  samples?: string;
  comment?: string;
};

export type StockPayload = {
  clientId: string;
  date: string;
  lines: { productId: string; qty: string }[];
  comment?: string;
};

export type OutboxItem = {
  clientEventId: string;
  kind: OutboxKind;
  userId: string;
  payload: AnimationPayload | StockPayload;
  /** Libellé affiché dans la file (« Pharmacie X — 5 produits »). Jamais envoyé au serveur. */
  label: string;
  deviceTime: string;
  state: "PENDING" | "A_CORRIGER";
  /** Position attendue : l'envoi patiente, dans la limite de `GPS_WAIT_MS`. */
  gpsPending?: boolean;
  gps?: GpsFix;
  error?: { code: string; message: string; existingId?: string };
};

export type MutationOk = { clientEventId: string; ok: true; id?: string; replayed?: boolean; warnings?: string[] };
export type MutationKo = { clientEventId: string; ok: false; code: MutationCode; message: string; existingId?: string };
export type MutationResult = MutationOk | MutationKo;

export type MutationCode = "CONFLICT" | "INVALID" | "FORBIDDEN" | "WRONG_USER" | "SERVER";

/** Le serveur n'a pas pu trancher, ou la saisie appartient à un autre compte : elle reste en file, sans déranger personne. */
const RETRYABLE: MutationCode[] = ["WRONG_USER", "SERVER"];

/** Au-delà, on envoie sans position plutôt que de retenir la saisie. */
export const GPS_WAIT_MS = 30000;

export type Settlement = {
  remove: string[];
  toFix: { clientEventId: string; error: NonNullable<OutboxItem["error"]> }[];
  keep: string[];
};

/** Ce que devient chaque saisie envoyée, d'après la réponse du serveur. Une saisie sans réponse reste en file. */
export function settle(sent: { clientEventId: string }[], results: MutationResult[]): Settlement {
  const out: Settlement = { remove: [], toFix: [], keep: [] };
  const byId = new Map(results.map((r) => [r.clientEventId, r]));
  for (const { clientEventId } of sent) {
    const r = byId.get(clientEventId);
    if (!r) out.keep.push(clientEventId);
    else if (r.ok) out.remove.push(clientEventId);
    else if (RETRYABLE.includes(r.code)) out.keep.push(clientEventId);
    else out.toFix.push({ clientEventId, error: { code: r.code, message: r.message, existingId: r.existingId } });
  }
  return out;
}

/** Les saisies à envoyer maintenant : celles de la personne connectée, prêtes, dans l'ordre où elles ont été faites. */
export function sendable(items: OutboxItem[], userId: string, now: number): OutboxItem[] {
  return items
    .filter((i) => i.userId === userId && i.state === "PENDING")
    .filter((i) => !i.gpsPending || now - new Date(i.deviceTime).getTime() >= GPS_WAIT_MS)
    .sort((a, b) => a.deviceTime.localeCompare(b.deviceTime));
}

/** Ce qui part sur le réseau : ni le libellé, ni l'état local. Sans position reçue, la saisie est marquée comme telle. */
export function wireEvent(i: OutboxItem, sentAt: string) {
  return {
    clientEventId: i.clientEventId,
    kind: i.kind,
    userId: i.userId,
    deviceTime: i.deviceTime,
    sentAt,
    payload: i.payload,
    gps: i.gps ?? { lat: null, lng: null, accuracyM: null, error: "SANS_POSITION" },
  };
}

export type WireEvent = ReturnType<typeof wireEvent>;

/** Référentiels locaux : sans contact avec le serveur depuis ce délai, ils sont effacés (téléphone perdu ou compte révoqué). */
export const SNAPSHOT_MAX_AGE_DAYS = 14;

export function snapshotExpired(generatedAt: string, now: number): boolean {
  return now - new Date(generatedAt).getTime() > SNAPSHOT_MAX_AGE_DAYS * 86400000;
}
