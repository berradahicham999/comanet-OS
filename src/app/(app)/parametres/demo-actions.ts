"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/access";
import { seedDemo, purgeDemo } from "@/db/seed-demo";
import { seedContentDemo, purgeContentDemo } from "@/lib/content/demo";

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
