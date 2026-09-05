import { requireUser } from "@/lib/auth";
import { canAccess } from "@/lib/access-shared";
import { navForRole, mobileTabsForRole } from "@/components/nav-config";
import { AppShell } from "@/components/shell/app-shell";
import { logoutAction } from "@/app/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <AppShell
      groups={navForRole(user.role)}
      tabs={mobileTabsForRole(user.role)}
      user={user}
      logout={logoutAction}
      canSearch={canAccess(user.role, "recherche")}
    >
      {children}
    </AppShell>
  );
}
