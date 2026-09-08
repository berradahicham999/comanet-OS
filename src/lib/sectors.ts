/**
 * Secteurs commerciaux COMANET (partagé client / serveur / import).
 *
 * Un secteur regroupe plusieurs villes ; c'est la maille d'analyse des ventes.
 * Le secteur d'un client est déduit de sa ville (`cityToSector`) et stocké sur la fiche
 * (`clients.sector`) pour pouvoir être corrigé à la main et filtré en SQL.
 */

export const SECTORS = [
  "AGADIR",
  "BENI MELLAL",
  "CASABLANCA-ELJADIDA",
  "FES",
  "GRAND SUD",
  "MARRAKECH",
  "MEKNES",
  "ORIENTAL",
  "RABAT REGION",
  "TANGER",
  "TETOUAN",
] as const;

export type Sector = (typeof SECTORS)[number];

/** Valeur de filtre désignant les clients sans secteur. */
export const NO_SECTOR = "__none__";

/** Villes rattachées à chaque secteur (clé de comparaison : majuscules, sans accent). */
const CITIES_BY_SECTOR: Record<Sector, string[]> = {
  AGADIR: ["AGADIR", "AIT MELLOUL", "INEZGANE", "TAROUDANT", "TIZNIT", "DCHEIRA", "BIOUGRA", "OULAD TEIMA"],
  "BENI MELLAL": ["BENI MELLAL", "KHOURIBGA", "FKIH BENSALEH", "FKIH BEN SALAH", "SOUK SEBT OULAD NEMMA", "SOUK SEBT", "BEJAAD", "OUED ZEM", "AZILAL", "KASBA TADLA"],
  "CASABLANCA-ELJADIDA": ["CASABLANCA", "CASA", "EL JADIDA", "MOHAMMEDIA", "SETTAT", "BERRECHID", "BOUSKOURA", "HAD SOUALEM", "DEROUA", "BEN AHMED", "BENSLIMANE", "BOUZNIKA", "OULED AZZOUZ", "NOUACEUR", "DAR BOUAZZA", "AZEMMOUR", "SIDI BENNOUR", "MEDIOUNA"],
  FES: ["FES", "SEFROU", "TAZA", "MOULAY YACOUB"],
  "GRAND SUD": ["LAAYOUNE", "DAKHLA", "TANTAN", "TAN TAN", "GUELMIM", "OUARZAZATE", "ERRACHIDIA", "TATA", "ZAGORA", "SIDI IFNI", "BOUJDOUR", "ES SEMARA", "SMARA", "TINGHIR"],
  MARRAKECH: ["MARRAKECH", "ESSAOUIRA", "SAFI", "KELAA SRAGHNA", "EL KELAA DES SRAGHNA", "BENGUERIR", "BEN GUERIR", "OURIKA", "CHAMAIYA", "YOUSSOUFIA", "CHICHAOUA", "AMIZMIZ", "TAHANNAOUT"],
  MEKNES: ["MEKNES", "AZROU", "IFRANE", "KHENIFRA", "EL HAJEB", "MIDELT"],
  ORIENTAL: ["OUJDA", "BERKANE", "NADOR", "TAOURIRT", "DRIOUCH", "AL HOCEIMA", "GUERCIF", "JERADA", "SAIDIA", "ZAIO"],
  "RABAT REGION": ["RABAT", "SALE", "KENITRA", "TEMARA", "AIN AOUDA", "SKHIRAT", "KHEMISSET", "SIDI SLIMANE", "SIDI KACEM", "SOUK EL ARBAA", "HARHOURA"],
  TANGER: ["TANGER", "ASILAH", "LARACHE", "KSAR EL KEBIR"],
  TETOUAN: ["TETOUAN", "MDIQ", "M DIQ", "FNIDEQ", "MARTIL", "CHEFCHAOUEN", "OUAZZANE"],
};

const strip = (v: string) =>
  v.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

const SECTOR_BY_CITY: Map<string, Sector> = new Map();
for (const sector of SECTORS) for (const city of CITIES_BY_SECTOR[sector]) SECTOR_BY_CITY.set(strip(city), sector);

/** Secteur commercial déduit d'une ville ; `null` si la ville est inconnue ou vide. */
export function cityToSector(city: unknown): Sector | null {
  const k = strip(String(city ?? ""));
  if (!k) return null;
  return SECTOR_BY_CITY.get(k) ?? null;
}

/** Vérifie qu'une valeur saisie est un secteur connu. */
export function asSector(v: unknown): Sector | null {
  const k = strip(String(v ?? ""));
  return (SECTORS as readonly string[]).find((x) => strip(x) === k) as Sector | undefined ?? null;
}

/** Villes connues d'un secteur (pour la migration SQL et l'aide à la saisie). */
export function citiesOf(sector: Sector): string[] {
  return CITIES_BY_SECTOR[sector];
}
