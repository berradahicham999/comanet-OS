import "server-only";
import type { WebPlace } from "./web-check-shared";

/**
 * Recherche de lieux Google Maps (Places API « Text Search », nouvelle version). Lecture seule. La clé reste en
 * variable d'environnement (`GOOGLE_MAPS_API_KEY`), jamais en base ni dans le code : le dépôt est public.
 * Seuls le nom, l'adresse, la position et l'identifiant du lieu sont demandés (masque de champs) ; la recherche est
 * limitée au Maroc.
 */
const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const FIELDS = "places.id,places.displayName,places.formattedAddress,places.location";
/** Rectangle englobant le Maroc (y compris les provinces du Sud). */
const MOROCCO = { low: { latitude: 20.7, longitude: -17.2 }, high: { latitude: 35.95, longitude: -0.99 } };

export function googleKey(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY?.trim() || null;
}

export class GooglePlacesError extends Error {}

type ApiPlace = { id?: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number } };

export async function searchPlaces(query: string, opts: { timeoutMs?: number } = {}): Promise<WebPlace[]> {
  const key = googleKey();
  if (!key) throw new GooglePlacesError("GOOGLE_MAPS_API_KEY absente : contrôle Internet désactivé.");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS },
    body: JSON.stringify({ textQuery: query, languageCode: "fr", regionCode: "MA", pageSize: 5, locationRestriction: { rectangle: MOROCCO } }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const msg = (() => {
      try {
        return (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? body;
      } catch {
        return body;
      }
    })();
    throw new GooglePlacesError(`Google Maps a refusé la recherche (${res.status}) : ${msg.slice(0, 300)}`);
  }
  const json = (await res.json()) as { places?: ApiPlace[] };
  return (json.places ?? [])
    .filter((p) => p.id && p.location && typeof p.location.latitude === "number" && typeof p.location.longitude === "number")
    .map((p) => ({ placeId: p.id!, name: p.displayName?.text ?? "", address: p.formattedAddress ?? "", lat: p.location!.latitude!, lng: p.location!.longitude! }));
}
