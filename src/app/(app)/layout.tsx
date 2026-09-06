import { requireUser } from "@/lib/auth";
import { getUserPermissions, homeForUser } from "@/lib/permissions";
import { can } from "@/lib/permissions-shared";
import { navForPermissions, mobileTabsForPermissions } from "@/components/nav-config";
import { AppShell } from "@/components/shell/app-shell";
import { logoutAction } from "@/app/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [perms, home] = await Promise.all([getUserPermissions(), homeForUser()]);
  return (
    <AppShell
      groups={navForPermissions(perms)}
      tabs={mobileTabsForPermissions(perms, home)}
      user={user}
      logout={logoutAction}
      canSearch={can(perms, "recherche")}
    >
      {children}
    </AppShell>
  );
}
