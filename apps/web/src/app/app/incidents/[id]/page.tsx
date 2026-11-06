import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { IncidentDetail } from '@/features/incidents/incident-detail';
import { getMe } from '@/lib/session';

export const metadata: Metadata = { title: 'Incident' };

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, me] = await Promise.all([params, getMe()]);
  if (!me) redirect('/login');

  const membership = me.memberships[0];
  if (!membership) {
    return (
      <p className="text-sm text-muted-foreground">You are not a member of any organization yet.</p>
    );
  }

  return (
    <IncidentDetail
      orgId={membership.organizationId}
      incidentId={id}
      role={membership.role}
      timezone={membership.timezone}
    />
  );
}
