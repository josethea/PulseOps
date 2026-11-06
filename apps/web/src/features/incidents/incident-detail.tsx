'use client';

import { availableTransitions, hasPermission, isEditable } from '@pulseops/contracts';
import type { IncidentTransition, Role } from '@pulseops/contracts';
import { ArrowLeft, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { EmptyState, ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatInstant } from '@/features/dashboard/format';
import { ApiError } from '@/lib/api-client';
import { conflictOf, useAssignees, useIncident, useIncidentAction, useIncidentEvents } from './api';
import { EditIncidentDialog } from './edit-incident-dialog';
import { SeverityBadge, StatusBadge, TRANSITION_LABELS } from './labels';
import { ReasonDialog } from './reason-dialog';
import { Timeline } from './timeline';

interface Props {
  orgId: string;
  incidentId: string;
  role: Role;
  timezone: string;
}

const REASON_COPY = {
  resolve: {
    title: 'Resolve incident',
    description: 'Say how it was resolved. This is saved on the timeline.',
  },
  reopen: {
    title: 'Reopen incident',
    description: 'Say why it is being reopened. This is saved on the timeline.',
  },
} as const;

export function IncidentDetail({ orgId, incidentId, role, timezone }: Props) {
  const incident = useIncident(orgId, incidentId);
  const events = useIncidentEvents(orgId, incidentId);
  const assignees = useAssignees(orgId);
  const act = useIncidentAction(orgId, incidentId, role);

  const [reasonFor, setReasonFor] = useState<'resolve' | 'reopen' | null>(null);
  const [editing, setEditing] = useState(false);

  const back = (
    <Link
      href="/app/incidents"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden />
      All incidents
    </Link>
  );

  if (incident.isPending) {
    return (
      <div className="space-y-4">
        {back}
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (incident.error instanceof ApiError && incident.error.status === 404) {
    return (
      <div className="space-y-4">
        {back}
        <Card>
          <EmptyState
            title="Incident not found"
            hint="It may not exist, or you may not have access to it."
          />
        </Card>
      </div>
    );
  }

  if (!incident.data) {
    return (
      <div className="space-y-4">
        {back}
        <Card>
          <ErrorState
            error={incident.error}
            onRetry={() => incident.refetch()}
            title="Could not load the incident"
          />
        </Card>
      </div>
    );
  }

  const data = incident.data;
  const canUpdate = hasPermission(role, 'incident:update');
  const editable = canUpdate && isEditable(data.status);
  const transitions = availableTransitions(data.status, role);
  const busy = act.isPending;

  const run = (transition: IncidentTransition, reason?: string) =>
    act.mutate({
      action: { kind: 'transition', transition, reason },
      expectedVersion: data.version,
    });

  const conflict = conflictOf(act.error);
  const failure = act.error && !conflict ? act.error : null;

  return (
    <div className="space-y-6">
      {back}

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
            {data.title}
          </h1>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <SeverityBadge severity={data.severity} />
            <StatusBadge status={data.status} />
          </p>
        </div>
        {editable && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="mr-1.5 size-4" aria-hidden />
            Edit
          </Button>
        )}
      </header>

      {conflict && (
        <div role="alert" className="rounded-md border border-sev2 p-3 text-sm">
          This incident was changed by someone else, so your change was not applied. You are now
          seeing the latest version (v{conflict.version}); review it and try again.
        </div>
      )}
      {failure && (
        <div role="alert" className="rounded-md border border-sev1 p-3 text-sm">
          The change was not applied: {failure.message} The incident was restored to what it was.
          {failure instanceof ApiError && failure.requestId && (
            <span className="block text-xs text-muted-foreground">
              Request ID: {failure.requestId}
            </span>
          )}
        </div>
      )}

      {canUpdate && (
        <Card className="flex flex-wrap items-end gap-4 p-4" aria-label="Actions">
          <div className="flex flex-wrap gap-2">
            {transitions.map((transition) => (
              <Button
                key={transition}
                variant={
                  transition === 'resolve' || transition === 'reopen' ? 'outline' : 'default'
                }
                disabled={busy}
                onClick={() =>
                  transition === 'resolve' || transition === 'reopen'
                    ? setReasonFor(transition)
                    : run(transition)
                }
              >
                {TRANSITION_LABELS[transition]}
              </Button>
            ))}
            {transitions.length === 0 && (
              <p className="text-sm text-muted-foreground">No status changes available.</p>
            )}
          </div>

          <div className="min-w-48 space-y-1">
            <label htmlFor="assignee" className="text-xs font-medium text-muted-foreground">
              Assignee
            </label>
            <Select
              id="assignee"
              disabled={busy || !editable}
              value={data.assignee?.userId ?? ''}
              onChange={(e) => {
                const picked = assignees.data?.find((a) => a.userId === e.target.value) ?? null;
                act.mutate({
                  action: {
                    kind: 'assign',
                    assignee: picked && { userId: picked.userId, displayName: picked.displayName },
                  },
                  expectedVersion: data.version,
                });
              }}
            >
              <option value="">Unassigned</option>
              {assignees.data?.map((a) => (
                <option key={a.userId} value={a.userId}>
                  {a.displayName}
                </option>
              ))}
            </Select>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="space-y-4 p-4 lg:col-span-2" aria-labelledby="details-heading">
          <h2 id="details-heading" className="text-sm font-semibold">
            Details
          </h2>
          <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
            {data.description || <span className="text-muted-foreground">No description.</span>}
          </p>
          <dl className="grid gap-x-6 gap-y-3 border-t pt-4 text-sm sm:grid-cols-2">
            <Meta label="Service" value={`${data.serviceName} · ${data.region}`} />
            <Meta label="Assignee" value={data.assignee?.displayName ?? 'Unassigned'} />
            <Meta label="Created by" value={data.createdBy.displayName} />
            <Meta label="Created" value={stamp(data.createdAt, timezone)} />
            <Meta label="Acknowledged" value={stamp(data.acknowledgedAt, timezone)} />
            <Meta label="Resolved" value={stamp(data.resolvedAt, timezone)} />
            <Meta label="Version" value={`v${data.version}`} />
          </dl>
        </Card>

        <Card className="p-4" aria-labelledby="timeline-heading">
          <h2 id="timeline-heading" className="mb-4 text-sm font-semibold">
            Timeline
          </h2>
          {events.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : events.data ? (
            <Timeline events={events.data} assignees={assignees.data ?? []} timezone={timezone} />
          ) : (
            <ErrorState
              error={events.error}
              onRetry={() => events.refetch()}
              title="Could not load the timeline"
            />
          )}
        </Card>
      </div>

      {reasonFor && (
        <ReasonDialog
          open
          title={REASON_COPY[reasonFor].title}
          description={REASON_COPY[reasonFor].description}
          confirmLabel={TRANSITION_LABELS[reasonFor]}
          onClose={() => setReasonFor(null)}
          onConfirm={(reason) => run(reasonFor, reason)}
        />
      )}
      <EditIncidentDialog
        incident={data}
        open={editing}
        onClose={() => setEditing(false)}
        onSubmit={(patch) =>
          act.mutate({ action: { kind: 'update', patch }, expectedVersion: data.version })
        }
      />
    </div>
  );
}

function stamp(iso: string | null, timezone: string) {
  return iso ? `${formatInstant(iso, timezone, true)} (${timezone})` : '—';
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
