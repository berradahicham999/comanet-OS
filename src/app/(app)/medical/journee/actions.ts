"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/access";
import { acceptGpsNotice } from "@/lib/medical/chrono";

/** Prise de connaissance de l'information GPS (horodatée, conservée). */
export async function acceptGpsNoticeAction() {
  const user = await requireAccess("medical");
  await acceptGpsNotice(user.id, (await headers()).get("user-agent"));
  revalidatePath("/medical/journee");
}
