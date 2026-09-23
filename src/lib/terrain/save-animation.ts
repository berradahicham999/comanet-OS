import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { animations, animationLines, animationRevisions } from "@/db/schema";
import { normalizeCity } from "@/lib/animations-shared";
import {
  animationDedupeKey, valueAnimationLines,
  type AnimationErrorCode, type ParsedAnimation,
} from "./animation-input";
import { EVENT_SOURCES, EVENT_TYPES, emitEvent, eventKey, obsoleteEvent } from "@/lib/events/emit";
import { recordReadings, deleteReadingsOfAnimation, type Executor } from "@/lib/client-stock";
import { diffAnimation, snapshotSummary, type AnimationSnapshot, type RevisionAction, type RevisionChange } from "./revisions";

/**
 * ENREGISTREMENT D'UNE ANIMATION — service métier transactionnel.
 *
 * Trois écritures séquentielles hors transaction pouvaient laisser une animation avec des
 * lignes partielles : l'insertion réussissait, la purge ou la réinsertion des lignes non.
 * Tout est désormais dans une transaction unique, sur le modèle de `medical/visits.ts`.
 *
 * L'événement est écrit DANS la même transaction (pattern outbox). Son traitement, lui, a
 * lieu après — la saisie ne peut jamais être annulée par l'échec d'une règle.
 *
 * `source = 'saisie'` est posé à chaque écriture humaine, y compris sur la correction d'une
 * animation venue de l'import : à partir de là, le fichier ne la remplacera plus.
 */

export type SaveAnimationOutcome =
  | { ok: false; error: AnimationErrorCode }
  | { ok: false; error: "doublon"; existingId: string }
  | { ok: true; animationId: string; eventId: string | null; missingPrice: boolean; overlaps: number };

/** Qui écrit : sert à l'historique du rapport. */
export type Actor = { id: string; name: string };

export type SaveAnimationContext = {
  /** `null` pour une création. */
  id: string | null;
  parsed: ParsedAnimation;
  actor: Actor;
};

type ClientRow = { client_name: string; client_city: string | null; animatrice_name: string | null };

export async function saveAnimation({ id, parsed, actor }: SaveAnimationContext): Promise<SaveAnimationOutcome> {
  /* -- 1) Point de vente, animatrice, ville normalisée, clé de déduplication -------- */
  const ctx = await db.execute(sql`
    select c.name as client_name, c.city as client_city,
           (select u.name from users u where u.id = ${parsed.animatriceId}::uuid) as animatrice_name
    from clients c where c.id = ${parsed.clientId}::uuid`);
  const row = ctx.rows[0] as ClientRow | undefined;
  if (!row) return { ok: false, error: "client" };

  const city = normalizeCity(row.client_city);
  const dedupeKey = animationDedupeKey({
    date: parsed.date,
    clientCity: row.client_city,
    clientName: row.client_name,
    animatriceName: row.animatrice_name,
  });

  const clash = await db.execute(sql`
    select id::text as id from animations
    where dedupe_key = ${dedupeKey} ${id ? sql`and id <> ${id}::uuid` : sql``} limit 1`);
  if (clash.rows.length) {
    return { ok: false, error: "doublon", existingId: (clash.rows[0] as { id: string }).id };
  }

  /* -- 2) Valorisation officielle des lignes ---------------------------------------- */
  const priceByProduct = new Map<string, unknown>();
  if (parsed.lines.length) {
    const ids = [...new Set(parsed.lines.map((l) => l.productId))];
    const prices = await db.execute(sql`
      select id::text as id, price_retail::float8 as price_retail from products
      where id in (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)})`);
    for (const p of prices.rows as { id: string; price_retail: number | null }[]) priceByProduct.set(p.id, p.price_retail);
  }
  const { valued, missingPrice } = valueAnimationLines(parsed.lines, priceByProduct);

  /* -- 3) Écriture : animation, lignes et événement, dans UNE transaction ------------ */
  const values = {
    clientId: parsed.clientId,
    date: parsed.date,
    startDate: parsed.startDate,
    days: parsed.days,
    status: parsed.status,
    animatriceId: parsed.animatriceId,
    brandId: parsed.brandId,
    city,
    dedupeKey,
    source: "saisie",
    cost: parsed.cost.toFixed(2),
    durationHours: parsed.durationHours === null ? null : parsed.durationHours.toFixed(1),
    customersAdvised: parsed.customersAdvised,
    samples: parsed.samples,
    comment: parsed.comment,
    photoUrl: parsed.photoUrl,
  };

  const result = await db.transaction(async (tx) => {
    let animationId = id ?? "";
    const before = id ? await loadSnapshot(tx, id) : null;
    if (id) {
      await tx.update(animations).set(values).where(eq(animations.id, id));
      await tx.delete(animationLines).where(eq(animationLines.animationId, id));
    } else {
      const [created] = await tx.insert(animations).values(values).returning({ id: animations.id });
      animationId = created.id;
    }

    if (valued.length) {
      await tx.insert(animationLines).values(
        valued.map((l) => ({
          animationId,
          productId: l.productId,
          quantitySold: l.quantitySold,
          stockObserved: l.stockObserved,
          unitPrice: l.unitPrice === null ? null : l.unitPrice.toFixed(2),
          amount: l.amount === null ? null : l.amount.toFixed(2),
        })),
      );
    }

    // Historique : photo après écriture, comparée à celle d'avant. Une correction sans effet
    // (formulaire renvoyé tel quel) n'écrit rien.
    const after = await loadSnapshot(tx, animationId);
    if (after) {
      const changes = before ? diffAnimation(before, after) : [];
      if (!before || changes.length) await logRevision(tx, animationId, actor, before ? "MODIFICATION" : "CREATION", snapshotSummary(after), changes);
    }

    // Stock constaté en rayon : relevé daté du jour de l'animation, dans la table commune aux
    // deux canaux (`client_stock_readings`). Une correction remplace les relevés de CETTE animation.
    // Seule une animation réalisée constitue un relevé ; prévue ou annulée, ses relevés sont retirés.
    await recordReadings({
      clientId: parsed.clientId,
      userId: parsed.animatriceId,
      channel: "ANIMATION",
      readAt: parsed.date,
      animationId,
      lines: parsed.status === "DONE"
        ? valued.filter((l) => l.stockObserved !== null).map((l) => ({ productId: l.productId, quantity: l.stockObserved as number }))
        : [],
    }, tx);

    // Seule une journée RÉALISÉE est un fait métier. Une animation prévue n'a rien produit ;
    // une animation annulée retire le fait sans effacer sa trace.
    const key = eventKey(EVENT_TYPES.ANIMATION_COMPLETED, animationId);
    if (parsed.status !== "DONE") {
      await obsoleteEvent(tx, key);
      return { ok: true as const, animationId, eventId: null, missingPrice, overlaps: 0 };
    }

    const event = await emitEvent(tx, {
      type: EVENT_TYPES.ANIMATION_COMPLETED,
      entityType: "animation",
      entityId: animationId,
      dedupeKey: key,
      source: EVENT_SOURCES.SAISIE_TERRAIN,
      occurredAt: new Date(`${parsed.date}T12:00:00Z`),
      payload: {
        animationId,
        date: parsed.date,
        startDate: parsed.startDate,
        days: parsed.days,
        city,
        clientId: parsed.clientId,
        clientName: row.client_name,
        animatriceId: parsed.animatriceId,
        animatriceName: row.animatrice_name,
        brandId: parsed.brandId,
        lines: valued.map((l) => ({
          productId: l.productId,
          quantitySold: l.quantitySold,
          stockObserved: l.stockObserved,
          amount: l.amount,
        })),
        unitsSold: valued.reduce((a, l) => a + l.quantitySold, 0),
        selloutAmount: valued.reduce((a, l) => a + (l.amount ?? 0), 0),
        measurable: !missingPrice,
      },
    });

    return { ok: true as const, animationId, eventId: event.id, missingPrice, overlaps: 0 };
  });

  return { ...result, overlaps: await countOverlaps(result.animationId, parsed) };
}

/**
 * Autres animations non annulées de la même animatrice dont la période croise celle-ci
 * (même point de vente saisi deux fois, ou deux endroits les mêmes jours). Signalé, jamais
 * bloquant : deux demi-journées dans deux points de vente restent possibles. Une période
 * inconnue (import) se réduit à son dernier jour.
 */
async function countOverlaps(animationId: string, parsed: ParsedAnimation): Promise<number> {
  if (!parsed.animatriceId || parsed.status === "CANCELLED") return 0;
  const r = await db.execute(sql`
    select count(*)::int as n from animations
    where animatrice_id = ${parsed.animatriceId}::uuid and id <> ${animationId}::uuid
      and status <> 'CANCELLED'
      and coalesce(start_date, date) <= ${parsed.date}::date and date >= ${parsed.startDate}::date`);
  return Number((r.rows[0] as { n: number }).n);
}

/**
 * Suppression : les lignes suivent par cascade, le fait devient caduc. L'historique garde
 * le contenu effacé (une ligne par champ renseigné), pour pouvoir le ressaisir au besoin.
 */
export async function deleteAnimation(id: string, actor: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await loadSnapshot(tx, id);
    if (before) {
      const empty: AnimationSnapshot = { ...before, cost: 0, durationHours: null, customersAdvised: 0, samples: 0, comment: null, photoUrl: null, lines: {} };
      const erased = diffAnimation(before, empty).map((c) => ({ ...c, after: null }));
      await logRevision(tx, id, actor, "SUPPRESSION", snapshotSummary(before), erased);
    }
    await obsoleteEvent(tx, eventKey(EVENT_TYPES.ANIMATION_COMPLETED, id));
    await deleteReadingsOfAnimation(id, tx);
    await tx.delete(animations).where(eq(animations.id, id));
  });
}

/** Photo d'un rapport, noms résolus, lue dans la transaction en cours. */
async function loadSnapshot(ex: Executor, id: string): Promise<AnimationSnapshot | null> {
  const r = await ex.execute(sql`
    select a.start_date::text as start_date, a.date::text as date, a.days, a.status::text as status,
           c.name as client_name, u.name as animatrice_name, b.name as brand_name,
           a.cost::float8 as cost, a.duration_hours::float8 as duration_hours,
           a.customers_advised, a.samples, a.comment, a.photo_url,
           coalesce((select json_agg(json_build_object('name', p.name, 'sold', al.quantity_sold, 'stock', al.stock_observed))
                     from animation_lines al join products p on p.id = al.product_id where al.animation_id = a.id), '[]'::json) as lines
    from animations a join clients c on c.id = a.client_id
    left join users u on u.id = a.animatrice_id left join brands b on b.id = a.brand_id
    where a.id = ${id}::uuid`);
  const x = r.rows[0] as Record<string, unknown> | undefined;
  if (!x) return null;
  const lines: AnimationSnapshot["lines"] = {};
  for (const l of x.lines as { name: string; sold: number; stock: number | null }[]) lines[l.name] = { sold: Number(l.sold), stock: l.stock === null ? null : Number(l.stock) };
  return {
    startDate: (x.start_date as string | null) ?? null,
    date: String(x.date),
    days: Number(x.days),
    status: String(x.status),
    clientName: String(x.client_name),
    animatriceName: (x.animatrice_name as string | null) ?? null,
    brandName: (x.brand_name as string | null) ?? null,
    cost: Number(x.cost),
    durationHours: x.duration_hours === null ? null : Number(x.duration_hours),
    customersAdvised: Number(x.customers_advised),
    samples: Number(x.samples),
    comment: (x.comment as string | null) ?? null,
    photoUrl: (x.photo_url as string | null) ?? null,
    lines,
  };
}

async function logRevision(ex: Executor, animationId: string, actor: Actor, action: RevisionAction, summary: string, changes: RevisionChange[]) {
  await ex.insert(animationRevisions).values({ animationId, actorId: actor.id, actorName: actor.name, action, summary, changes });
}
