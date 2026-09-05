/**
 * Domaine réglementaire (Maroc — DMP).
 *
 * Parcours d'un dossier :
 *   Dossier constitué → Dépôt DMP → **ATD** (attestation de dépôt, validité limitée)
 *   → demande de **CE** (certificat d'enregistrement) → CE obtenu.
 *
 * Une même référence donne lieu à PLUSIEURS dossiers : un par variante déposée
 * (modèle de vente, échantillon, minidose, travel size) et par contenance.
 *
 * Rien n'est figé : l'écart en jours et la situation sont recalculés à chaque affichage
 * (contrairement à une colonne Excel qui date du jour où la formule a été saisie).
 */
import type { Tone } from "@/components/ui";

/* ------------------------------ Nomenclatures ----------------------------- */

export const VARIANT_TYPES = {
  MODELE_VENTE: "Modèle de vente",
  ECHANTILLON: "Échantillon",
  MINIDOSE: "Minidose",
  TRAVEL_SIZE: "Travel size",
  DECLARATION: "Déclaration société",
  TRANSFERT: "Transfert de titularité",
  AUTRE: "Autre",
} as const;
export type VariantType = keyof typeof VARIANT_TYPES;

export const DOCUMENT_TYPES = {
  ATD: "ATD — attestation de dépôt",
  CE: "CE — certificat d'enregistrement",
  ATTESTATION: "Attestation",
  TRANSFERT: "Transfert",
  AUCUN: "Aucun",
} as const;
export type DocumentType = keyof typeof DOCUMENT_TYPES;

export const CERTIFICATE_STATUS: Record<string, { label: string; short: string; tone: Tone }> = {
  OBTENU: { label: "CE obtenu", short: "Obtenu", tone: "green" },
  EN_ATTENTE: { label: "CE demandé — en attente DMP", short: "En attente", tone: "blue" },
  A_DEMANDER: { label: "Demande de CE à faire", short: "À demander", tone: "orange" },
  DOCS_LABO: { label: "En attente des documents laboratoire", short: "Docs labo", tone: "yellow" },
  NON_APPLICABLE: { label: "Sans objet", short: "—", tone: "gray" },
};
export type CertificateStatus = keyof typeof CERTIFICATE_STATUS;

export const EVENT_KINDS: Record<string, { label: string; tone: Tone }> = {
  DEPOT: { label: "Dépôt DMP", tone: "blue" },
  ATD: { label: "ATD reçue", tone: "green" },
  CE: { label: "Certificat d'enregistrement", tone: "green" },
  RENOUVELLEMENT: { label: "Redépôt / renouvellement", tone: "accent" },
  EXPIRATION: { label: "Expiration", tone: "red" },
  BLOCAGE: { label: "Blocage", tone: "red" },
  NOTE: { label: "Note", tone: "gray" },
  IMPORT: { label: "Import", tone: "gray" },
};

/** Formats rencontrés dans les fichiers COMANET, normalisés (tube/TUBE/Tube → TUBE). */
export const PACKAGINGS: Record<string, string> = {
  TUBE: "Tube",
  FLACON: "Flacon",
  FLACON_POMPE: "Flacon pompe",
  POT: "Pot",
  SACHET: "Sachet",
  SPRAY: "Spray",
  ROLL_ON: "Roll-on",
  FOAMER: "Foamer",
  STICK: "Stick",
  AMPOULE: "Ampoule",
  AUTRE: "Autre",
};

/* ------------------------------ Normalisation ----------------------------- */

const strip = (v: string) =>
  v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

export function normalizeVariantType(raw: unknown): VariantType {
  const k = strip(String(raw ?? ""));
  if (!k) return "MODELE_VENTE";
  if (k.includes("MODELE")) return "MODELE_VENTE";
  if (k.includes("ECHANTILLON") || k.includes("SAMPLE")) return "ECHANTILLON";
  if (k.includes("MINIDOSE") || k.includes("MINI DOSE")) return "MINIDOSE";
  if (k.includes("TRAVEL")) return "TRAVEL_SIZE";
  if (k.includes("DECLARATION")) return "DECLARATION";
  if (k.includes("TRANSFERT")) return "TRANSFERT";
  return "AUTRE";
}

export function normalizePackaging(raw: unknown): string | null {
  const k = strip(String(raw ?? ""));
  if (!k) return null;
  if (k.includes("POMPE")) return "FLACON_POMPE";
  if (k.includes("ROLL")) return "ROLL_ON";
  if (k.includes("FOAMER")) return "FOAMER";
  if (k.includes("STICK")) return "STICK";
  if (k.includes("SPRAY")) return "SPRAY";
  if (k.includes("SACHET")) return "SACHET";
  if (k.startsWith("TUBE")) return "TUBE";
  if (k.startsWith("FLACON")) return "FLACON";
  if (k.startsWith("POT")) return "POT";
  if (k.includes("AMPOULE")) return "AMPOULE";
  return "AUTRE";
}

/** Contenance normalisée pour l'affichage et la clé d'identité : « 40 G », « 1,5 ML ». */
export function normalizeSize(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const m = v.replace(",", ".").match(/([\d.]+)\s*(ml|l|g|gr|kg|cl)?/i);
  if (!m) return v.toUpperCase();
  const n = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  const u = unit === "gr" ? "g" : unit;
  return `${Number.isFinite(n) ? String(n).replace(".", ",") : m[1]}${u ? " " + u : ""}`.toUpperCase();
}

export function normalizeBool(raw: unknown): boolean | null {
  const k = strip(String(raw ?? ""));
  if (!k) return null;
  if (["OUI", "YES", "1", "X", "VRAI", "TRUE", "O"].includes(k)) return true;
  if (["NON", "NO", "0", "FAUX", "FALSE", "N"].includes(k)) return false;
  return null;
}

/** « Etat » du fichier source → statut du dossier. */
export function normalizeState(raw: unknown): "VALIDE" | "A_DEPOSER" | "EN_COURS" {
  const k = strip(String(raw ?? ""));
  if (!k) return "EN_COURS";
  if (k.startsWith("ENREGISTRE")) return "VALIDE";
  if (k === "NON" || k.startsWith("NON ") || k.startsWith("PAS")) return "A_DEPOSER";
  if (k.includes("COURS") || k.includes("DEPOSE")) return "EN_COURS";
  return "EN_COURS";
}

/** Colonne « Observation » du fichier source → étape CE + éventuel blocage. */
export function normalizeObservation(raw: unknown): { certificateStatus: CertificateStatus; blocked: boolean; note: string | null } {
  const text = String(raw ?? "").trim();
  const k = strip(text);
  if (!k) return { certificateStatus: "A_DEMANDER", blocked: false, note: null };
  if (k.includes("CANNABIS") || k.includes("INTERDIT") || k.includes("NON CONFORME")) {
    return { certificateStatus: "NON_APPLICABLE", blocked: true, note: text };
  }
  if (k.includes("DOCUMENT") && k.includes("LABORATOIRE")) return { certificateStatus: "DOCS_LABO", blocked: false, note: text };
  if (k.includes("DEMANDE") && k.includes("CE")) return { certificateStatus: "A_DEMANDER", blocked: false, note: text };
  if (k.includes("ATTENTE") && k.includes("CE")) return { certificateStatus: "EN_ATTENTE", blocked: false, note: text };
  if (k.includes("OK") || k.includes("RECUPERER")) return { certificateStatus: "OBTENU", blocked: false, note: text };
  return { certificateStatus: "A_DEMANDER", blocked: false, note: text };
}

export function normalizeDocumentType(raw: unknown): DocumentType {
  const k = strip(String(raw ?? ""));
  if (!k) return "AUCUN";
  if (k === "ATD" || (k.includes("ATTESTATION") && k.includes("DEPOT"))) return "ATD";
  if (k === "CE" || k.includes("CERTIFICAT")) return "CE";
  if (k.includes("TRANSFERT")) return "TRANSFERT";
  if (k.includes("ATTESTATION")) return "ATTESTATION";
  return "AUCUN";
}

/** Clé d'identité d'un dossier : marque | référence | type | contenance. */
export function regulatoryKey(parts: { brand?: string | null; reference: string; variantType: string; size?: string | null }) {
  return [strip(parts.brand ?? ""), strip(parts.reference), parts.variantType, strip(parts.size ?? "")].join("|");
}

/* -------------------------------- Situation ------------------------------- */

export type Situation =
  | "BLOQUE"
  | "EXPIRE"
  | "CRITIQUE"
  | "A_RENOUVELER"
  | "SANS_DATE"
  | "EN_INSTRUCTION"
  | "NON_DEPOSE"
  | "VALIDE";

export const SITUATIONS: Record<Situation, { label: string; tone: Tone; help: string }> = {
  BLOQUE: { label: "Bloqué", tone: "red", help: "Enregistrement impossible en l'état (formule ou ingrédient non conforme)." },
  EXPIRE: { label: "Expiré", tone: "red", help: "Validité dépassée : la commercialisation n'est plus couverte." },
  CRITIQUE: { label: "Critique", tone: "red", help: "Expire dans 30 jours ou moins." },
  A_RENOUVELER: { label: "À redéposer", tone: "orange", help: "Dans le délai d'anticipation du redépôt." },
  SANS_DATE: { label: "Date à retrouver", tone: "yellow", help: "Enregistré mais sans date de validité connue : impossible d'anticiper." },
  EN_INSTRUCTION: { label: "En instruction", tone: "blue", help: "Déposé à la DMP, en attente de l'ATD." },
  NON_DEPOSE: { label: "Non déposé", tone: "gray", help: "Aucun dépôt : le produit ne peut pas être commercialisé." },
  VALIDE: { label: "Valide", tone: "green", help: "Validité couverte au-delà du délai d'anticipation." },
};

export type SituationInput = {
  status: string;
  blocked: boolean;
  expiryDate: string | null;
  filingDate?: string | null;
};

export function daysUntil(date: string | null | undefined, ref: Date): number | null {
  if (!date) return null;
  return Math.round((new Date(date + "T12:00:00Z").getTime() - ref.getTime()) / 86400000);
}

export function situationOf(f: SituationInput, ref: Date, renewalDays: number): { situation: Situation; days: number | null } {
  const days = daysUntil(f.expiryDate, ref);
  if (f.blocked) return { situation: "BLOQUE", days };
  if (f.status === "A_DEPOSER") return { situation: "NON_DEPOSE", days };
  if (days === null) {
    if (f.status === "EN_COURS") return { situation: "EN_INSTRUCTION", days };
    return { situation: "SANS_DATE", days };
  }
  if (days < 0) return { situation: "EXPIRE", days };
  if (days <= 30) return { situation: "CRITIQUE", days };
  if (days <= renewalDays) return { situation: "A_RENOUVELER", days };
  return { situation: "VALIDE", days };
}

/** Une situation qui empêche (ou menace) la commercialisation. */
export const AT_RISK: Situation[] = ["BLOQUE", "EXPIRE", "CRITIQUE", "NON_DEPOSE"];

export function formatDays(days: number | null): string {
  if (days === null) return "—";
  if (days < 0) return `expiré depuis ${Math.abs(days)} j`;
  if (days === 0) return "expire aujourd'hui";
  if (days < 60) return `J-${days}`;
  return `J-${days} (${Math.round(days / 30)} mois)`;
}

export function variantLabel(t: string) {
  return VARIANT_TYPES[t as VariantType] ?? t;
}
export function packagingLabel(p: string | null) {
  return p ? PACKAGINGS[p] ?? p : "—";
}
