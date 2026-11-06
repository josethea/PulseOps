import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { DashboardView } from '@/features/dashboard/dashboard-view';
import { getMe } from '@/lib/session';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const me = await getMe();
  if (!me) redirect('/login');

  // Organization switching arrives later; use the default (oldest) membership for now.
  const membership = me.memberships[0];
  if (!membership) {
    return (
      <p className="text-sm text-muted-foreground">You are not a member of any organization yet.</p>
    );
  }

  // useSearchParams (URL-synced filters) needs a Suspense boundary.
  return (
    <Suspense>
      <DashboardView orgId={membership.organizationId} timezone={membership.timezone} />
    </Suspense>
  );
}
