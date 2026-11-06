import type { AssigneeOption, IncidentEvent } from '@pulseops/contracts';

import { formatInstant } from '@/features/dashboard/format';

/** One readable sentence per timeline entry (FR-INC-004, FR-INC-011). */
function describe(event: IncidentEvent, people: Map<string, string>): string {
  const after = event.after ?? {};
  const before = event.before ?? {};
  switch (event.action) {
    case 'created':
      return 'created the incident';
    case 'status.acknowledge':
      return 'acknowledged the incident';
    case 'status.investigate':
      return 'started investigating';
    case 'status.resolve':
      return 'resolved the incident';
    case 'status.reopen':
      return 'reopened the incident';
    case 'assigned':
      return `assigned it to ${people.get(String(after.assigneeId)) ?? 'a team member'}`;
    case 'unassigned':
      return `removed the assignee (${people.get(String(before.assigneeId)) ?? 'a team member'})`;
    case 'updated': {
      const fields = Object.keys(after).map(
        (key) => `${key} (${String(before[key])} → ${String(after[key])})`,
      );
      return `changed ${fields.join(', ')}`;
    }
    default:
      return event.action;
  }
}

interface Props {
  events: IncidentEvent[];
  assignees: AssigneeOption[];
  timezone: string;
}

export function Timeline({ events, assignees, timezone }: Props) {
  const people = new Map(assignees.map((a) => [a.userId, a.displayName]));

  return (
    <ol className="space-y-4">
      {events.map((event) => {
        const reason = typeof event.after?.reason === 'string' ? event.after.reason : null;
        return (
          <li key={event.id} className="relative border-l pl-4">
            <span
              aria-hidden
              className="absolute -left-[5px] top-1.5 size-2.5 rounded-full bg-muted-foreground"
            />
            <p className="text-sm">
              <strong className="font-medium">{event.actor.displayName}</strong>{' '}
              {describe(event, people)}
            </p>
            {reason && <p className="mt-1 text-sm text-muted-foreground">Reason: {reason}</p>}
            <time dateTime={event.occurredAt} className="text-xs text-muted-foreground">
              {formatInstant(event.occurredAt, timezone, true)} ({timezone})
            </time>
          </li>
        );
      })}
    </ol>
  );
}
