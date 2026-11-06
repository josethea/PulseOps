import { hasPermission } from '@pulseops/contracts';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { DemoView } from '@/features/demo/demo-view';
import { getMe } from '@/lib/session';

export const metadata: Metadata = { title: 'Demo' };

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

  return (
    <DemoView
      orgId={membership.organizationId}
      timezone={membership.timezone}
      canReset={hasPermission(membership.role, 'demo:reset')}
    />
  );
}
