"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/access";
import { seedDemo, purgeDemo } from "@/db/seed-demo";
import { seedContentDemo, purgeContentDemo } from "@/lib/content/demo";
import { seedActivationDemo, purgeActivationDemo } from "@/lib/activations/demo";

export async function seedDemoAction() {
  await requireAdmin();
  await seedDemo();
  revalidatePath("/", "layout");
}

export async function purgeDemoAction() {
  await requireAdmin();
  await purgeDemo();
  revalidatePath("/", "layout");
}

/** Démo du seul planning éditorial : ne dépend pas des ventes importées, s'appuie sur les marques et produits réels. */
export async function seedContentDemoAction() {
  await requireAdmin();
  await seedContentDemo();
  revalidatePath("/", "layout");
}

export async function purgeContentDemoAction() {
  await requireAdmin();
  await purgeContentDemo();
  revalidatePath("/", "layout");
}

/** Démo des activations et de l'inventaire matériel : marques, produits, clients et villes réels. */
export async function seedActivationDemoAction() {
  await requireAdmin();
  await seedActivationDemo();
  revalidatePath("/", "layout");
}

export async function purgeActivationDemoAction() {
  await requireAdmin();
  await purgeActivationDemo();
  revalidatePath("/", "layout");
}
