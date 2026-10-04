import { requireAccessContext } from "@/lib/permissions";
import { hasAnyModule } from "@/lib/permissions-shared";
import { navForPermissions, mobileTabsForPermissions } from "@/components/nav-config";
import { AppShell } from "@/components/shell/app-shell";
import { logoutAction } from "@/app/login/actions";
import { unreadCount } from "@/lib/content/notify";
import { isAiConfigured } from "@/lib/ai/client";
import { copilotAllowed } from "@/lib/ai/service";
import { can } from "@/lib/permissions-shared";
import { runningVisitOf } from "@/lib/medical/chrono";
import { RunningVisitBanner } from "@/components/medical/running-visit-banner";
import { runningClientVisitOf } from "@/lib/crm/visits";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAccessContext();
  const unread = await unreadCount(access.user.id).catch(() => 0);
  const medical = can(access.perms, "medical", "create");
  const running = medical ? await runningVisitOf(access.user.id).catch(() => null) : null;
  // CRM commercial : visite en cours chez un client (Ma tournée).
  const crm = can(access.perms, "clients", "create");
  const crmRunning = crm ? await runningClientVisitOf(access.user.id).then((r) => (r ? { doctorName: r.clientName, startedAt: r.startedAt } : null)).catch(() => null) : null;
  return (
    <AppShell
      groups={navForPermissions(access.perms, access.flags)}
      tabs={mobileTabsForPermissions(access.perms, access.home, access.flags)}
      user={access.user}
      logout={logoutAction}
      canSearch={hasAnyModule(access.perms)}
      unread={unread}
      copilot={{ enabled: copilotAllowed(access), configured: isAiConfigured() }}
      preview={access.preview ? { adminName: access.preview.adminName, targetName: access.user.name, targetId: access.user.id } : null}
    >
      {medical && <RunningVisitBanner server={running} />}
      {crm && <RunningVisitBanner server={crmRunning} kind="crm" />}
      {children}
    </AppShell>
  );
}
