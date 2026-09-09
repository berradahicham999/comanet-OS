/** Construit le contexte d'exécution des outils pour la personne connectée (droits résolus côté serveur). */
import "server-only";
import { requireAccessContext } from "@/lib/permissions";
import { getRefDate } from "@/lib/ref-date";
import { getSettings } from "@/lib/settings";
import { today } from "@/lib/format";
import { isAdmin } from "@/lib/permissions-shared";
import type { ToolAccess, ToolContext } from "./types";
import { realDeps } from "./deps";

export async function buildToolContext(opts: { messageId?: string | null } = {}): Promise<ToolContext> {
  const a = await requireAccessContext();
  const admin = isAdmin(a.perms);
  const access: ToolAccess = {
    userId: a.user.id,
    userName: a.user.name,
    perms: a.perms,
    scope: a.scope,
    brandIds: a.scope === "ASSIGNED" && !admin ? a.brandIds : null,
    clientIds: a.scope === "ASSIGNED" && !admin && a.clientIds.length ? a.clientIds : null,
    ownOnly: a.scope === "OWN" && !admin,
    seeInternalCosts: admin || a.flags.seeInternalCosts,
  };
  const [{ ref }, settings] = await Promise.all([getRefDate(), getSettings()]);
  return { access, refDate: ref, now: today(), settings, deps: realDeps, messageId: opts.messageId ?? null };
}
