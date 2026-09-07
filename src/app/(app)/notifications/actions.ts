"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAnyModule } from "@/lib/access";
import { markRead } from "@/lib/content/notify";

export async function markAllRead() {
  const user = await requireAnyModule();
  await markRead(user.id);
  revalidatePath("/notifications"); revalidatePath("/", "layout");
}

/** Ouvre une notification : marquée lue, puis redirection vers l'élément concerné. */
export async function openNotification(formData: FormData) {
  const user = await requireAnyModule();
  const id = String(formData.get("id") ?? ""); const href = String(formData.get("href") ?? "");
  if (id) await markRead(user.id, id);
  revalidatePath("/notifications"); revalidatePath("/", "layout");
  redirect(href.startsWith("/") ? href : "/notifications");
}
