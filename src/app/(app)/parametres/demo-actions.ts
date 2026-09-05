"use server";

import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/access";
import { seedDemo, purgeDemo } from "@/db/seed-demo";

export async function seedDemoAction() {
  await requireAccess("parametres");
  await seedDemo();
  revalidatePath("/", "layout");
}

export async function purgeDemoAction() {
  await requireAccess("parametres");
  await purgeDemo();
  revalidatePath("/", "layout");
}
