import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { placeWebChecks } from "@/db/schema";
import { getSettings, DEFAULT_WEB_PLACES } from "@/lib/settings";
import { notify } from "@/lib/content/notify";
import { applyWebPositionToCabinet } from "@/lib/medical/chrono";
import { applyWebPositionToPointOfSale } from "@/lib/crm/visits";
import { googleKey, searchPlaces, GooglePlacesError } from "./google";
import { webChecksFor } from "./store";
import type { MapCabinet } from "@/components/medical/field-map";
import { positionWatchers } from "./out-of-zone";
import {
  buildQuery, searchable, pickPlace, compareWithWeb,
  type PlaceKind, type PlaceSubject, type GpsSource, type WebVerdict, type FichePosition,
} from "./web-check-shared";

/**
 * Contrôle Internet des positions : recherche Google Maps des cabinets et points de vente, par lots. Seule écriture de
 * `place_web_checks`. Après chaque recherche, la position de la fiche passe par `applyWebPositionToCabinet()` /
 * `applyWebPositionToPointOfSale()` (proposition ou validation automatique, jamais d'écrasement d'une position validée).
 * Appelé par le cron horaire médical (`settings.webPlaces.batchPerRun` fiches par passage) et par le bouton
 * « Vérifier maintenant » des écrans de suivi. Sans `GOOGLE_MAPS_API_KEY`, rien ne part.
 */

export function webCheckConfigured(): boolean {
  return googleKey() !== null;
}

type Due = {
  kind: PlaceKind; id: string; first_name: string | null; last_name: string | null; name: string | null; specialty: string | null;
  address: string | null; city: string | null; gps_lat: string | null; gps_lng: string | null; gps_status: string | null; gps_source: GpsSource | null;
};

const positionOf = (d: Pick<Due, "gps_lat" | "gps_lng" | "gps_status" | "gps_source">): FichePosition =>
  d.gps_lat === null || d.gps_lng === null ? null : { lat: Number(d.gps_lat), lng: Number(d.gps_lng), validated: d.gps_status === "VALIDEE", source: d.gps_source };

const subjectOf = (d: Due): PlaceSubject =>
  d.kind === "doctor"
    ? { kind: "doctor", firstName: d.first_name ?? "", lastName: d.last_name ?? "", specialty: d.specialty, address: d.address, city: d.city }
    : { kind: "client", name: d.name ?? "", address: d.address, city: d.city };

/**
 * Fiches à (re)vérifier, les plus utiles d'abord : positions « à valider », puis validées, puis fiches visitées ou
 * planifiées, puis le reste. Une fiche est revérifiée après `recheckDays`, une erreur d'appel le lendemain.
 */
const staleSql = (recheckDays: number) =>
  sql`(w.id is null or (w.status = 'ERREUR' and w.checked_at < now() - interval '1 day') or w.checked_at < now() - make_interval(days => ${recheckDays}))`;

/** Nombre de fiches encore à vérifier (même définition que `dueEntities`). */
async function dueCount(recheckDays: number, only?: PlaceKind): Promise<number> {
  const stale = staleSql(recheckDays);
  const r = await db.execute<{ n: number }>(sql`
    select (
      ${only === "client" ? sql`0` : sql`(select count(*) from doctors d left join place_web_checks w on w.entity_type = 'doctor' and w.entity_id = d.id where d.status <> 'INACTIF' and ${stale})`}
      + ${only === "doctor" ? sql`0` : sql`(select count(*) from clients c left join place_web_checks w on w.entity_type = 'client' and w.entity_id = c.id where c.active and not c.is_internal and ${stale})`}
    )::int as n`);
  return r.rows[0]?.n ?? 0;
}

async function dueEntities(limit: number, recheckDays: number, only?: PlaceKind): Promise<Due[]> {
  const stale = staleSql(recheckDays);
  const r = await db.execute<Due & { rank: number }>(sql`
    select * from (
      select 'doctor' as kind, d.id, d.first_name, d.last_name, null::text as name, sp.name as specialty, d.address_line as address, d.city,
        d.gps_lat, d.gps_lng, d.gps_status, d.gps_source,
        case when d.gps_status = 'A_CONFIRMER' then 0 when d.gps_status = 'VALIDEE' then 1
             when exists (select 1 from doctor_visits v where v.doctor_id = d.id and v.date >= current_date - 90) then 2 else 3 end as rank
      from doctors d
      left join medical_specialties sp on sp.id = d.specialty_id
      left join place_web_checks w on w.entity_type = 'doctor' and w.entity_id = d.id
      where d.status <> 'INACTIF' and ${stale} ${only === "client" ? sql`and false` : sql``}
      union all
      select 'client', c.id, null, null, c.name, null, c.billing_address, c.city,
        c.gps_lat, c.gps_lng, c.gps_status, c.gps_source,
        case when c.gps_status = 'A_CONFIRMER' then 0 when c.gps_status = 'VALIDEE' then 1
             when c.account_manager_id is not null or exists (select 1 from client_visits v where v.client_id = c.id) then 2 else 3 end
      from clients c
      left join place_web_checks w on w.entity_type = 'client' and w.entity_id = c.id
      where c.active and not c.is_internal and ${stale} ${only === "doctor" ? sql`and false` : sql``}
    ) x order by rank, kind, id
    limit ${limit}`);
  return r.rows;
}

export type WebCheckRun = { checked: number; found: number; proposed: number; validated: number; gaps: number; error: string | null; remaining: number };

/** Vérifie une fiche : recherche, enregistrement, puis effet sur la position. Renvoie le verdict avant / après. */
async function checkOne(d: Due, actorId: string | null): Promise<{ status: string; action: "PROPOSE" | "VALIDATE" | null; newGap: boolean }> {
  const all = await getSettings();
  const cfg = all.webPlaces;
  const subject = subjectOf(d);
  const query = buildQuery(subject);
  const previous = (await webChecksFor(d.kind, [d.id])).get(d.id) ?? null;
  const before: WebVerdict = compareWithWeb(positionOf(d), previous, cfg).verdict;

  let row: typeof placeWebChecks.$inferInsert;
  if (!searchable(subject)) {
    row = { entityType: d.kind, entityId: d.id, query, status: "INTROUVABLE", error: "Nom trop générique pour une recherche.", candidates: [], checkedBy: actorId };
  } else {
    const places = await searchPlaces(query);
    const pick = pickPlace(subject, places, cfg);
    row = {
      entityType: d.kind, entityId: d.id, query, status: pick.status,
      placeId: pick.place?.placeId ?? null, placeName: pick.place?.name ?? null, placeAddress: pick.place?.address ?? null,
      lat: pick.place ? pick.place.lat.toFixed(6) : null, lng: pick.place ? pick.place.lng.toFixed(6) : null,
      nameScore: pick.place ? pick.place.score.toFixed(3) : null,
      candidates: pick.candidates.map((c) => ({ name: c.name, address: c.address, lat: c.lat, lng: c.lng, score: c.score, cityOk: c.cityOk })),
      error: pick.status === "TROUVE" ? null : pick.reason, checkedBy: actorId,
    };
  }

  return db.transaction(async (tx) => {
    await tx.insert(placeWebChecks).values(row).onConflictDoUpdate({
      target: [placeWebChecks.entityType, placeWebChecks.entityId],
      set: {
        query: row.query, status: row.status, placeId: row.placeId ?? null, placeName: row.placeName ?? null, placeAddress: row.placeAddress ?? null,
        lat: row.lat ?? null, lng: row.lng ?? null, nameScore: row.nameScore ?? null, candidates: row.candidates ?? null, error: row.error ?? null,
        checkedBy: row.checkedBy ?? null, checkedAt: new Date(),
      },
    });
    const action = d.kind === "doctor"
      ? await applyWebPositionToCabinet(tx, d.id, { field: all.medicalField, web: cfg })
      : await applyWebPositionToPointOfSale(tx, d.id, { crm: all.crm, web: cfg });
    const web = row.status === "TROUVE" ? { status: row.status, lat: Number(row.lat), lng: Number(row.lng) } : { status: row.status, lat: null, lng: null };
    const after = compareWithWeb(positionOf(d), web, cfg).verdict;
    // Écart nouveau sur une position déjà VALIDÉE : à signaler (une position « à valider » est déjà dans les écrans de contrôle).
    return { status: row.status, action, newGap: after === "ECART" && before !== "ECART" && d.gps_status === "VALIDEE" };
  });
}

/**
 * Un lot de vérifications. S'arrête au premier refus de Google (clé invalide, API non activée, quota) pour ne pas
 * brûler le lot : l'erreur est rendue telle quelle à l'écran.
 */
export async function runWebChecks(opts: { limit?: number; actorId?: string | null; only?: PlaceKind } = {}): Promise<WebCheckRun> {
  const out: WebCheckRun = { checked: 0, found: 0, proposed: 0, validated: 0, gaps: 0, error: null, remaining: 0 };
  if (!webCheckConfigured()) return { ...out, error: "GOOGLE_MAPS_API_KEY absente : ajoutez-la dans les variables d'environnement Vercel." };
  const cfg = (await getSettings()).webPlaces;
  const limit = Math.max(1, Math.min(200, opts.limit ?? (cfg.batchPerRun || DEFAULT_WEB_PLACES.batchPerRun)));
  const due = await dueEntities(limit, cfg.recheckDays, opts.only);
  const gaps: string[] = [];
  const queue = [...due];
  const worker = async () => {
    for (let d = queue.shift(); d && !out.error; d = queue.shift()) {
      try {
        const r = await checkOne(d, opts.actorId ?? null);
        out.checked++;
        if (r.status === "TROUVE") out.found++;
        if (r.action === "PROPOSE") out.proposed++;
        if (r.action === "VALIDATE") out.validated++;
        if (r.newGap) gaps.push(d.kind === "doctor" ? `Dr ${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() : d.name ?? "");
      } catch (e) {
        if (e instanceof GooglePlacesError || (e as Error).name === "TimeoutError") {
          out.error = (e as Error).message;
          await db.insert(placeWebChecks).values({ entityType: d.kind, entityId: d.id, query: buildQuery(subjectOf(d)), status: "ERREUR", error: out.error.slice(0, 500), checkedBy: opts.actorId ?? null })
            .onConflictDoUpdate({ target: [placeWebChecks.entityType, placeWebChecks.entityId], set: { status: "ERREUR", error: out.error.slice(0, 500), checkedAt: new Date() } })
            .catch(() => {});
        } else throw e;
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  out.gaps = gaps.length;
  if (gaps.length) {
    await notify(await positionWatchers(null), {
      type: "PLACE_WEB_GAP",
      title: `${gaps.length} position(s) validée(s) en désaccord avec Google Maps`,
      body: `${gaps.slice(0, 5).join(", ")}${gaps.length > 5 ? "…" : ""}. À revoir sur la carte du suivi.`,
      href: "/medical/suivi#positions-internet",
    }).catch((e) => console.error("[positions] notification d'écart", e));
  }
  out.remaining = await dueCount(cfg.recheckDays, opts.only);
  return out;
}

/** Variante silencieuse du cron : jamais d'exception. */
export async function runWebChecksQuietly(): Promise<WebCheckRun | null> {
  if (!webCheckConfigured() || (await getSettings()).webPlaces.batchPerRun <= 0) return null;
  return runWebChecks().catch((e) => {
    console.error("[positions] contrôle Internet", e);
    return null;
  });
}

/* ------------------------------------------------------------------ */
/* Lecture pour les écrans de suivi                                    */
/* ------------------------------------------------------------------ */

export type WebCheckRow = {
  id: string; name: string; city: string | null; verdict: WebVerdict; distanceM: number | null; validated: boolean; source: GpsSource | null;
  position: { lat: number; lng: number } | null; web: { lat: number; lng: number; name: string | null; address: string | null } | null; note: string | null;
};

/** Toutes les fiches d'un type avec leur verdict Internet (le verdict se calcule ici, jamais stocké). */
export async function webCheckOverview(kind: PlaceKind): Promise<{ rows: WebCheckRow[]; counts: Record<WebVerdict, number> }> {
  const cfg = (await getSettings()).webPlaces;
  const r = await db.execute<{ id: string; name: string; city: string | null; gps_lat: string | null; gps_lng: string | null; gps_status: string | null; gps_source: GpsSource | null }>(
    kind === "doctor"
      ? sql`select id, first_name || ' ' || last_name as name, city, gps_lat, gps_lng, gps_status, gps_source from doctors where status <> 'INACTIF'`
      : sql`select id, name, city, gps_lat, gps_lng, gps_status, gps_source from clients where active and not is_internal`,
  );
  const checks = await db.execute<{ entity_id: string; status: string; lat: string | null; lng: string | null; place_name: string | null; place_address: string | null; error: string | null }>(sql`
    select entity_id, status, lat, lng, place_name, place_address, error from place_web_checks where entity_type = ${kind}`).catch(() => ({ rows: [] as never[] }));
  const byId = new Map(checks.rows.map((c) => [String(c.entity_id), c]));
  const counts = { NON_VERIFIE: 0, INTROUVABLE: 0, AMBIGU: 0, SANS_POSITION: 0, SOURCE_INTERNET: 0, CONCORDE: 0, ECART: 0 } as Record<WebVerdict, number>;
  const rows = r.rows.map((x): WebCheckRow => {
    const c = byId.get(String(x.id));
    const pos = positionOf(x);
    const web = c ? { status: c.status as "TROUVE", lat: c.lat === null ? null : Number(c.lat), lng: c.lng === null ? null : Number(c.lng), name: c.place_name, address: c.place_address } : null;
    const { verdict, distanceM } = compareWithWeb(pos, web, cfg);
    counts[verdict]++;
    return {
      id: String(x.id), name: x.name, city: x.city, verdict, distanceM, validated: x.gps_status === "VALIDEE", source: x.gps_source,
      position: pos ? { lat: pos.lat, lng: pos.lng } : null,
      web: web && web.lat !== null && web.lng !== null ? { lat: web.lat, lng: web.lng, name: web.name ?? null, address: web.address ?? null } : null,
      note: c?.error ?? null,
    };
  });
  return { rows, counts };
}

/** Ajoute aux points de la carte le lieu Google de chaque fiche et son écart (concorde / écart). */
export async function withWebPositions(kind: PlaceKind, places: MapCabinet[]): Promise<MapCabinet[]> {
  const cfg = (await getSettings()).webPlaces;
  const checks = await webChecksFor(kind, places.map((p) => p.doctorId));
  return places.map((p) => {
    const w = checks.get(p.doctorId);
    if (!w || w.status !== "TROUVE" || w.lat === null || w.lng === null) return p;
    const { distanceM } = compareWithWeb({ lat: p.lat, lng: p.lng, validated: p.validated, source: null }, w, cfg);
    return { ...p, web: { lat: w.lat, lng: w.lng, name: w.name ?? null, address: w.address ?? null, distanceM, concordant: distanceM !== null && distanceM <= cfg.concordanceM } };
  });
}
