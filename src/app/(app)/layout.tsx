import { requireAccessContext } from "@/lib/permissions";
import { hasAnyModule } from "@/lib/permissions-shared";
import { navForPermissions, mobileTabsForPermissions } from "@/components/nav-config";
import { AppShell } from "@/components/shell/app-shell";
import { logoutAction } from "@/app/login/actions";
import { unreadCount } from "@/lib/content/notify";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAccessContext();
  const unread = await unreadCount(access.user.id).catch(() => 0);
  return (
    <AppShell
      groups={navForPermissions(access.perms, access.flags)}
      tabs={mobileTabsForPermissions(access.perms, access.home, access.flags)}
      user={access.user}
      logout={logoutAction}
      canSearch={hasAnyModule(access.perms)}
      unread={unread}
      preview={access.preview ? { adminName: access.preview.adminName, targetName: access.user.name, targetId: access.user.id } : null}
    >
      {children}
    </AppShell>
  );
}
