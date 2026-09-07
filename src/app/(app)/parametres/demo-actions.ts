"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/access";
import { seedDemo, purgeDemo } from "@/db/seed-demo";

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
