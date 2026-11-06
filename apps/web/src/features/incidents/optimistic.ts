import { transitionTarget } from '@pulseops/contracts';
import type { Incident, IncidentTransition, Role } from '@pulseops/contracts';

/** A change the user asked for, before the server has confirmed it. */
export type IncidentAction =
  | { kind: 'transition'; transition: IncidentTransition; reason?: string }
  | { kind: 'assign'; assignee: { userId: string; displayName: string } | null }
  | { kind: 'update'; patch: Partial<Pick<Incident, 'title' | 'description' | 'severity'>> };

/**
 * What the incident will look like if the server accepts the action. Shown immediately
 * (FR-INC-010) and replaced by the server's response, or rolled back on error. Mirrors the
 * server's rules: the version bump keeps the UI from sending a stale `expectedVersion`.
 */
export function predictIncident(current: Incident, action: IncidentAction, role: Role): Incident {
  const now = new Date().toISOString();
  const next: Incident = { ...current, version: current.version + 1, updatedAt: now };

  switch (action.kind) {
    case 'assign':
      next.assignee = action.assignee;
      return next;
    case 'update':
      return { ...next, ...action.patch };
    case 'transition': {
      const target = transitionTarget(action.transition, current.status, role);
      if (!target) return current;
      next.status = target;
      if (action.transition === 'acknowledge') next.acknowledgedAt = now;
      if (action.transition === 'resolve') next.resolvedAt = now;
      if (action.transition === 'reopen') next.resolvedAt = null;
      return next;
    }
  }
}
