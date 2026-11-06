import { hasPermission } from '@pulseops/contracts';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { RulesView } from '@/features/alerts/rules-view';
import { getMe } from '@/lib/session';

export const metadata: Metadata = { title: 'Alert rules' };

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
    <RulesView
      orgId={membership.organizationId}
      canManage={hasPermission(membership.role, 'alert-rule:manage')}
    />
  );
}
