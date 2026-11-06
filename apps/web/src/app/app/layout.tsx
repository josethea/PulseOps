import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { SidebarNav } from '@/components/layout/sidebar-nav';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { UserMenu } from '@/components/layout/user-menu';
import { LiveStatus } from '@/components/layout/live-status';
import { NotificationBell } from '@/features/notifications/notification-bell';
import { RealtimeProvider } from '@/lib/realtime/realtime-provider';
import { getMe } from '@/lib/session';

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Private area: the API must confirm the session before anything renders.
  const me = await getMe();
  if (!me) redirect('/login');

  // Organization switching (UC-02) comes later; until then use the first membership.
  const membership = me.memberships[0];

  const shell = (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r bg-sidebar md:block">
        <div className="flex h-14 items-center border-b px-5 text-base font-semibold">PulseOps</div>
        <SidebarNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-4 md:px-6">
          <span className="text-sm text-muted-foreground">
            {membership?.organizationName ?? 'No organization'}
          </span>
          <div className="flex items-center gap-2">
            <LiveStatus />
            {membership && <NotificationBell orgId={membership.organizationId} />}
            <ThemeToggle />
            <UserMenu displayName={me.user.displayName} role={membership?.role ?? 'VIEWER'} />
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );

  // One socket per organization, shared by every page below.
  return membership ? (
    <RealtimeProvider orgId={membership.organizationId} userId={me.user.id}>
      {shell}
    </RealtimeProvider>
  ) : (
    shell
  );
}
