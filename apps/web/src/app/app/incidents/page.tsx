import { hasPermission } from '@pulseops/contracts';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { IncidentsView } from '@/features/incidents/incidents-view';
import { getMe } from '@/lib/session';

export const metadata: Metadata = { title: 'Incidents' };

export default async function IncidentsPage() {
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
      <IncidentsView
        orgId={membership.organizationId}
        timezone={membership.timezone}
        canCreate={hasPermission(membership.role, 'incident:create')}
      />
    </Suspense>
  );
}
