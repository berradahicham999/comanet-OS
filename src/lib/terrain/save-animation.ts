import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { animations, animationLines } from "@/db/schema";
import { normalizeCity } from "@/lib/animations-shared";
import {
  animationDedupeKey, valueAnimationLines,
  type AnimationErrorCode, type ParsedAnimation,
} from "./animation-input";
import { EVENT_SOURCES, EVENT_TYPES, emitEvent, eventKey, obsoleteEvent } from "@/lib/events/emit";

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
  | { ok: true; animationId: string; eventId: string | null; missingPrice: boolean };

export type SaveAnimationContext = {
  /** `null` pour une création. */
  id: string | null;
  parsed: ParsedAnimation;
};

type ClientRow = { client_name: string; client_city: string | null; animatrice_name: string | null };

export async function saveAnimation({ id, parsed }: SaveAnimationContext): Promise<SaveAnimationOutcome> {
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

  return db.transaction(async (tx) => {
    let animationId = id ?? "";
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

    // Seule une journée RÉALISÉE est un fait métier. Une animation prévue n'a rien produit ;
    // une animation annulée retire le fait sans effacer sa trace.
    const key = eventKey(EVENT_TYPES.ANIMATION_COMPLETED, animationId);
    if (parsed.status !== "DONE") {
      await obsoleteEvent(tx, key);
      return { ok: true as const, animationId, eventId: null, missingPrice };
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

    return { ok: true as const, animationId, eventId: event.id, missingPrice };
  });
}

/** Suppression : les lignes suivent par cascade, le fait devient caduc. */
export async function deleteAnimation(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await obsoleteEvent(tx, eventKey(EVENT_TYPES.ANIMATION_COMPLETED, id));
    await tx.delete(animations).where(eq(animations.id, id));
  });
}
