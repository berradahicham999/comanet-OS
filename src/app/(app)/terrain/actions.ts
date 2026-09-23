"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, isOwnOnly } from "@/lib/access";
import { parseAnimationInput, type RawAnimationInput } from "@/lib/terrain/animation-input";
import { saveAnimation as persistAnimation, deleteAnimation as removeAnimation } from "@/lib/terrain/save-animation";
import { dispatchEvent } from "@/lib/events/dispatch";
import { refreshAfterWrite } from "@/lib/analytics-marketing/refresh";

/**
 * Saisie d'une animation depuis l'application.
 *
 * Cette action ne décide de rien : elle lit le formulaire, délègue la validation à
 * `parseAnimationInput()` (pur, testé) et l'écriture à `saveAnimation()` (transactionnel),
 * puis déclenche le traitement de l'événement — hors transaction, sans jamais pouvoir
 * annuler la saisie.
 */

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

function readForm(formData: FormData, forcedAnimatriceId: string | null): RawAnimationInput {
  const lines: RawAnimationInput["lines"] = [];
  // 60 : la saisie rapide affiche jusqu'à 20 produits habituels et permet d'en ajouter
  // d'autres — la journée la plus dense observée dans l'historique en compte 28.
  for (let i = 0; i < 60; i++) {
    const productId = str(formData, `product_${i}`).trim();
    if (!productId) continue;
    lines.push({ productId, qty: str(formData, `qty_${i}`), stock: str(formData, `stock_${i}`) });
  }
  return {
    clientId: str(formData, "clientId"),
    date: str(formData, "date"),
    startDate: str(formData, "startDate"),
    days: str(formData, "days"),
    status: str(formData, "status") || "DONE",
    animatriceId: forcedAnimatriceId ?? str(formData, "animatriceId"),
    brandId: str(formData, "brandId"),
    cost: str(formData, "cost"),
    durationHours: str(formData, "durationHours"),
    customersAdvised: str(formData, "customersAdvised"),
    samples: str(formData, "samples"),
    comment: str(formData, "comment"),
    photoUrl: str(formData, "photoUrl"),
    lines,
  };
}

function back(target: string, params: Record<string, string>): never {
  const q = new URLSearchParams(params).toString();
  redirect(`${target}${q ? `?${q}` : ""}`);
}

export async function saveAnimation(formData: FormData) {
  const id = str(formData, "id").trim() || null;
  const user = await requirePermission("terrain", id ? "edit" : "create");
  const ownOnly = await isOwnOnly();
  const formTarget = id ? `/terrain/${id}` : "/terrain/saisie";

  const parsed = parseAnimationInput(readForm(formData, ownOnly ? user.id : null));
  if (!parsed.ok) back(formTarget, { error: parsed.error });

  const saved = await persistAnimation({ id, parsed: parsed.value, actor: { id: user.id, name: user.name } });
  if (!saved.ok) {
    if (saved.error === "doublon") back(`/terrain/${saved.existingId}`, { error: "doublon" });
    back(formTarget, { error: saved.error });
  }

  // La transaction est validée : à partir d'ici, plus rien ne peut défaire la saisie.
  // `dispatchEvent` ne lève jamais — un handler en échec met l'événement en `failed`.
  if (saved.eventId) await dispatchEvent(saved.eventId);
  await refreshAfterWrite(["ANIMATION"]);

  revalidatePath("/terrain");
  revalidatePath("/terrain/animatrices");
  revalidatePath("/terrain/rapports");
  revalidatePath(`/terrain/${saved.animationId}`);
  revalidatePath("/");
  const warns = [saved.missingPrice && "prix", saved.overlaps > 0 && "chevauchement"].filter(Boolean);
  const params: Record<string, string> = warns.length ? { warn: warns.join(",") } : {};
  if (ownOnly) back("/terrain/saisie", { ...params, done: "1" });
  back(`/terrain/${saved.animationId}`, params);
}

export async function deleteAnimation(formData: FormData) {
  const user = await requirePermission("terrain", "validate");
  const id = str(formData, "id").trim();
  if (!id) return;
  await removeAnimation(id, { id: user.id, name: user.name });
  await refreshAfterWrite(["ANIMATION"]);
  revalidatePath("/terrain");
  revalidatePath("/terrain/animatrices");
  revalidatePath("/terrain/rapports");
  // Retour à la liste d'où l'on vient (filtres conservés), sinon à la liste complète.
  const back = str(formData, "back");
  const target = back.startsWith("/terrain/rapports") ? back : "/terrain/rapports";
  redirect(`${target}${target.includes("?") ? "&" : "?"}deleted=1`);
}
