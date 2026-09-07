"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { animations, animationLines } from "@/db/schema";
import { requireAccess } from "@/lib/access";
import { animationKey, normalizeCity } from "@/lib/animations-shared";
import { lineSellout, toFiniteNumber } from "@/lib/sellout";

/**
 * Saisie d'une animation depuis l'application.
 *
 * Ce chemin doit produire EXACTEMENT les mêmes données que l'import du fichier quotidien
 * (`importAnimations` dans `src/lib/import/run.ts`). Ce n'était pas le cas avant le 7/09/2026 :
 *   · `animation_lines.unit_price` et `.amount` n'étaient jamais renseignés → toute animation
 *     saisie à la main valait 0 MAD partout où le CA vient de `amount` ;
 *   · `animations.city` n'était jamais renseignée → la ligne sortait des agrégats par ville
 *     et du calcul d'objectif de l'animatrice ;
 *   · `animations.dedupe_key` n'était jamais renseignée → une même journée pouvait être
 *     saisie deux fois, ou saisie puis réimportée, sans que rien ne le détecte.
 *
 * Règles appliquées ici :
 *   · Ville  : `normalizeCity(client.city)` — même normalisation qu'à l'import (CASA → CASABLANCA).
 *   · Clé    : `animationKey({ date, city, pos: client.name, animatrice: user.name })` — même
 *              fonction, mêmes composants, donc même clé pour la même journée.
 *   · Prix   : priorité officielle de `src/lib/sellout.ts` — prix saisi, puis prix public du
 *              produit. Aucun prix inventé : sans prix fiable la ligne est enregistrée avec
 *              un montant NULL (jamais 0) et l'écran le signale.
 *   · Nombres: toute valeur non numérique est refusée, jamais convertie en 0.
 *   · Doublon: une autre animation portant la même clé fait échouer l'enregistrement avec un
 *              message explicite, plutôt que d'écraser silencieusement une ligne existante.
 */

type Line = { productId: string; quantitySold: number; stockObserved: number | null };

function back(target: string, params: Record<string, string>): never {
  const q = new URLSearchParams(params).toString();
  redirect(`${target}${q ? `?${q}` : ""}`);
}

export async function saveAnimation(formData: FormData) {
  const user = await requireAccess("terrain");
  const id = String(formData.get("id") ?? "").trim();
  const formTarget = id ? `/terrain/${id}` : "/terrain/saisie";

  /* -------- 1) Champs d'en-tête -------------------------------------------------- */
  const clientId = String(formData.get("clientId") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  if (!clientId) back(formTarget, { error: "client" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) back(formTarget, { error: "date" });

  const rawStatus = String(formData.get("status") ?? "DONE");
  const status = (["PLANNED", "DONE", "CANCELLED"].includes(rawStatus) ? rawStatus : "DONE") as "PLANNED" | "DONE" | "CANCELLED";
  const animatriceId = user.role === "ANIMATRICE" ? user.id : String(formData.get("animatriceId") ?? "").trim() || null;
  const brandId = String(formData.get("brandId") ?? "").trim() || null;

  // Nombres d'en-tête : jamais convertis en 0 quand la saisie est illisible.
  const num = (key: string, { min = 0 }: { min?: number } = {}) => {
    const raw = String(formData.get(key) ?? "").trim();
    if (raw === "") return null;
    const v = toFiniteNumber(raw);
    if (v === null || v < min) return undefined; // undefined = invalide
    return v;
  };
  const cost = num("cost"), durationHours = num("durationHours");
  const customersAdvised = num("customersAdvised"), samples = num("samples");
  if (cost === undefined || durationHours === undefined || customersAdvised === undefined || samples === undefined) {
    back(formTarget, { error: "nombre" });
  }

  /* -------- 2) Point de vente, animatrice, ville, clé de déduplication ------------ */
  const ctx = await db.execute(sql`
    select c.name as client_name, c.city as client_city,
           (select u.name from users u where u.id = ${animatriceId ?? null}::uuid) as animatrice_name
    from clients c where c.id = ${clientId}::uuid`);
  const ctxRow = ctx.rows[0] as { client_name: string; client_city: string | null; animatrice_name: string | null } | undefined;
  if (!ctxRow) back(formTarget, { error: "client" });

  const city = normalizeCity(ctxRow.client_city);
  const dedupeKey = animationKey({ date, city, pos: ctxRow.client_name, animatrice: ctxRow.animatrice_name });

  const clash = await db.execute(sql`
    select id::text as id from animations
    where dedupe_key = ${dedupeKey} ${id ? sql`and id <> ${id}::uuid` : sql``} limit 1`);
  if (clash.rows.length) {
    const other = (clash.rows[0] as { id: string }).id;
    back(`/terrain/${other}`, { error: "doublon" });
  }

  /* -------- 3) Lignes produit : quantités, stock rayon, prix ---------------------- */
  const raw: { productId: string; qty: string; stock: string }[] = [];
  for (let i = 0; i < 30; i++) {
    const pid = String(formData.get(`product_${i}`) ?? "").trim();
    if (!pid) continue;
    raw.push({ productId: pid, qty: String(formData.get(`qty_${i}`) ?? "").trim(), stock: String(formData.get(`stock_${i}`) ?? "").trim() });
  }

  const lines: Line[] = [];
  for (const l of raw) {
    // Quantité : entier ≥ 0. Une quantité négative n'est pas une vente et n'est pas acceptée.
    let qty = 0;
    if (l.qty !== "") {
      const v = toFiniteNumber(l.qty);
      if (v === null || v < 0 || !Number.isInteger(v)) back(formTarget, { error: "quantite" });
      qty = v;
    }
    let stockObserved: number | null = null;
    if (l.stock !== "") {
      const v = toFiniteNumber(l.stock);
      if (v === null || v < 0 || !Number.isInteger(v)) back(formTarget, { error: "stock" });
      stockObserved = v;
    }
    // Une ligne sans vente ET sans stock constaté n'apporte rien : elle est ignorée,
    // comme à l'import qui ne retient que les colonnes portant une quantité.
    if (qty === 0 && stockObserved === null) continue;
    lines.push({ productId: l.productId, quantitySold: qty, stockObserved });
  }

  // Prix publics du référentiel, pour la valorisation officielle du sell-out.
  const priceByProduct = new Map<string, unknown>();
  if (lines.length) {
    const rows = await db.execute(sql`
      select id::text as id, price_retail::float8 as price_retail from products
      where id in (${sql.join([...new Set(lines.map((l) => l.productId))].map((x) => sql`${x}::uuid`), sql`, `)})`);
    for (const p of rows.rows as { id: string; price_retail: number | null }[]) priceByProduct.set(p.id, p.price_retail);
  }

  const valued = lines.map((l) => {
    const s = lineSellout({ quantitySold: l.quantitySold, productPriceRetail: priceByProduct.get(l.productId) ?? null });
    return { ...l, unitPrice: s.unitPrice, amount: s.amount, measurable: !(l.quantitySold > 0 && s.amount === null) };
  });
  const missingPrice = valued.some((v) => !v.measurable);

  /* -------- 4) Écriture ---------------------------------------------------------- */
  const values = {
    clientId, date, status, animatriceId, brandId, city, dedupeKey,
    cost: (cost ?? 0).toFixed(2),
    durationHours: durationHours === null ? null : durationHours.toFixed(1),
    customersAdvised: Math.round(customersAdvised ?? 0),
    samples: Math.round(samples ?? 0),
    comment: String(formData.get("comment") ?? "").trim() || null,
    photoUrl: String(formData.get("photoUrl") ?? "").trim() || null,
  };

  let animId = id;
  if (id) {
    await db.update(animations).set(values).where(eq(animations.id, id));
    await db.delete(animationLines).where(eq(animationLines.animationId, id));
  } else {
    const [row] = await db.insert(animations).values(values).returning();
    animId = row.id;
  }
  if (valued.length) {
    await db.insert(animationLines).values(
      valued.map((l) => ({
        animationId: animId,
        productId: l.productId,
        quantitySold: l.quantitySold,
        stockObserved: l.stockObserved,
        unitPrice: l.unitPrice === null ? null : l.unitPrice.toFixed(2),
        amount: l.amount === null ? null : l.amount.toFixed(2),
      })),
    );
  }

  revalidatePath("/terrain");
  revalidatePath("/terrain/animatrices");
  revalidatePath(`/terrain/${animId}`);
  revalidatePath("/");
  const params: Record<string, string> = missingPrice ? { warn: "prix" } : {};
  if (user.role === "ANIMATRICE") back("/terrain/saisie", { ...params, done: "1" });
  back(`/terrain/${animId}`, params);
}

export async function deleteAnimation(formData: FormData) {
  const user = await requireAccess("terrain");
  if (user.role === "ANIMATRICE") return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // `animation_lines.animation_id` est en ON DELETE CASCADE : les lignes suivent.
  await db.delete(animations).where(eq(animations.id, id));
  revalidatePath("/terrain");
  revalidatePath("/terrain/animatrices");
  redirect("/terrain");
}
