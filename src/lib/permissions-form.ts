import { FLAG_KEYS, MODULE_KEYS, SCOPE_KEYS, type ScopeKey } from "./access-shared";
import { ACTIONS, noFlags, noPermissions, normalizeMatrix, type AccessConfig } from "./permissions-shared";

/** Lit la matrice, la portée, les interrupteurs et les assignations envoyés par `PermissionMatrix`. */
export function readConfig(fd: FormData): AccessConfig {
  const perms = noPermissions();
  for (const m of MODULE_KEYS) for (const a of ACTIONS) perms[m][a] = fd.get(`p_${m}_${a}`) === "1";
  const flags = noFlags();
  for (const f of FLAG_KEYS) flags[f] = fd.get(`f_${f}`) === "on";
  const rawScope = String(fd.get("scope") ?? "ALL");
  const scope: ScopeKey = (SCOPE_KEYS as readonly string[]).includes(rawScope) ? (rawScope as ScopeKey) : "ALL";
  const brandIds: string[] = [], clientIds: string[] = [];
  for (const [k, v] of fd.entries()) {
    if (!v) continue;
    if (k.startsWith("brand_")) brandIds.push(k.slice(6));
    else if (k.startsWith("client_")) clientIds.push(k.slice(7));
  }
  return { perms: normalizeMatrix(perms), scope, flags, brandIds, clientIds };
}
