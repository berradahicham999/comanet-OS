import "server-only";
import { redirect } from "next/navigation";
import { requireUser, type SessionUser } from "./auth";
import { canAccess, homeFor, type ModuleKey } from "./access-shared";

export { canAccess, homeFor, MODULES, type ModuleKey } from "./access-shared";

export async function requireAccess(module: ModuleKey): Promise<SessionUser> {
  const user = await requireUser();
  if (!canAccess(user.role, module)) redirect(homeFor(user.role));
  return user;
}
