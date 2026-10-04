/**
 * Portée de décision de la personne connectée : contexte Marketing Intelligence (droits, portée marques et
 * clients, réglages, dates) + marques lues. Réutilisé par le Command Center, Priorités & actions, les
 * actions serveur (approuver / refuser) et l'outil du copilote.
 */
import "server-only";
import { requireAccessContext } from "@/lib/permissions";
import { isAdmin } from "@/lib/permissions-shared";
import { brandFilter } from "@/lib/access";
import { listBrands } from "@/lib/users";
import { getRefDate } from "@/lib/ref-date";
import { getSettings } from "@/lib/settings";
import { today } from "@/lib/format";
import { intelContextFor } from "@/lib/marketing-intel/server";
import type { MarketingPeriodKey } from "@/lib/marketing-intel/build";
import type { DecisionScope } from "./build";

export type UserDecisionScope = DecisionScope & { allBrands: { id: string; name: string; color: string }[]; selectedBrandId: string | null };

export async function decisionScopeFor(brandId: string | null, period: MarketingPeriodKey = "30d"): Promise<UserDecisionScope> {
  const [access, refDate, settings, scope, brandRows] = await Promise.all([requireAccessContext(), getRefDate(), getSettings(), brandFilter(), listBrands()]);
  const allBrands = brandRows.filter((b) => b.active && !b.mergedIntoId && (scope === null || scope.includes(b.id))).map((b) => ({ id: b.id, name: b.name, color: b.color }));
  const selectedBrandId = brandId && allBrands.some((b) => b.id === brandId) ? brandId : null;
  const ctx = intelContextFor({
    perms: access.perms, seeInternalCosts: isAdmin(access.perms) || access.flags.seeInternalCosts, scopeBrandIds: scope,
    scopeClientIds: access.scope === "ASSIGNED" && !isAdmin(access.perms) && access.clientIds.length ? access.clientIds : null,
    settings, refDate: refDate.ref, now: today(),
  });
  return { ctx, perms: access.perms, brands: selectedBrandId ? allBrands.filter((b) => b.id === selectedBrandId) : allBrands, period, allBrands, selectedBrandId };
}
