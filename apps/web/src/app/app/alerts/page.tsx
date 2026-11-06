import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AlertsView } from '@/features/alerts/alerts-view';
import { getMe } from '@/lib/session';

export const metadata: Metadata = { title: 'Alerts' };

export default async function Page() {
  const me = await getMe();
  if (!me) redirect('/login');

  // Organization switching arrives later; use the default (oldest) membership for now.
  const membership = me.memberships[0];
  if (!membership) {
    return (
      <p className="text-sm text-muted-foreground">You are not a member of any organization yet.</p>
    );
  }

  return <AlertsView orgId={membership.organizationId} timezone={membership.timezone} />;
}
