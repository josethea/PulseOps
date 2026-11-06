import { z } from 'zod';

import { REGIONS, SEVERITIES } from './metrics.js';
import { hasPermission } from './permissions.js';
import type { Role } from './permissions.js';

export const INCIDENT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

// ---------------------------------------------------------------- state machine (BR-003/004)

export const INCIDENT_TRANSITIONS = ['acknowledge', 'investigate', 'resolve', 'reopen'] as const;
export type IncidentTransition = (typeof INCIDENT_TRANSITIONS)[number];

/** Default transitions: OPEN -> ACKNOWLEDGED -> INVESTIGATING -> RESOLVED, and RESOLVED -> OPEN. */
const TRANSITIONS: Record<IncidentTransition, { from: IncidentStatus[]; to: IncidentStatus }> = {
  acknowledge: { from: ['OPEN'], to: 'ACKNOWLEDGED' },
  investigate: { from: ['ACKNOWLEDGED'], to: 'INVESTIGATING' },
  resolve: { from: ['INVESTIGATING'], to: 'RESOLVED' },
  reopen: { from: ['RESOLVED'], to: 'OPEN' },
};

/** BR-004: an Org Admin may resolve straight from ACKNOWLEDGED, documenting the reason. */
const ADMIN_RESOLVE_FROM: IncidentStatus[] = ['ACKNOWLEDGED'];

/** Transitions that must carry a written reason (FR-INC-008, UC-08). */
export const TRANSITIONS_REQUIRING_REASON: readonly IncidentTransition[] = ['resolve', 'reopen'];

/** The status a transition leads to, or null when it is not allowed from `status` for `role`. */
export function transitionTarget(
  transition: IncidentTransition,
  status: IncidentStatus,
  role: Role,
): IncidentStatus | null {
  if (!hasPermission(role, 'incident:update')) return null;
  const rule = TRANSITIONS[transition];
  if (rule.from.includes(status)) return rule.to;
  if (transition === 'resolve' && role === 'ORG_ADMIN' && ADMIN_RESOLVE_FROM.includes(status)) {
    return rule.to;
  }
  return null;
}

/** Transitions the role can apply right now: drives the actions shown on the detail page. */
export function availableTransitions(status: IncidentStatus, role: Role): IncidentTransition[] {
  return INCIDENT_TRANSITIONS.filter((t) => transitionTarget(t, status, role) !== null);
}

/** Title, description, severity and assignee are frozen once an incident is resolved. */
export function isEditable(status: IncidentStatus): boolean {
  return status !== 'RESOLVED';
}

// ---------------------------------------------------------------- requests

const title = z.string().trim().min(3).max(140);
const description = z.string().trim().max(4000);
const reason = z.string().trim().min(3).max(1000);
const expectedVersion = z.number().int().positive();

export const createIncidentSchema = z.object({
  title,
  description: description.default(''),
  serviceId: z.string().min(1).max(64),
  region: z.enum(REGIONS),
  severity: z.enum(SEVERITIES),
  assigneeId: z.string().min(1).max(64).optional(),
});
export type CreateIncidentRequest = z.infer<typeof createIncidentSchema>;

export const updateIncidentSchema = z
  .object({
    title: title.optional(),
    description: description.optional(),
    severity: z.enum(SEVERITIES).optional(),
    expectedVersion,
  })
  .refine((v) => v.title !== undefined || v.description !== undefined || v.severity !== undefined, {
    message: 'Provide at least one field to change',
  });
export type UpdateIncidentRequest = z.infer<typeof updateIncidentSchema>;

export const assignIncidentSchema = z.object({
  /** User id of the new assignee, or null to unassign. */
  assigneeId: z.string().min(1).max(64).nullable(),
  expectedVersion,
});
export type AssignIncidentRequest = z.infer<typeof assignIncidentSchema>;

/** acknowledge / investigate carry no reason. */
export const transitionIncidentSchema = z.object({ expectedVersion });
export type TransitionIncidentRequest = z.infer<typeof transitionIncidentSchema>;

/** resolve / reopen require a reason. */
export const reasonedTransitionSchema = z.object({ reason, expectedVersion });
export type ReasonedTransitionRequest = z.infer<typeof reasonedTransitionSchema>;

export const INCIDENT_SORTS = [
  'createdAt',
  '-createdAt',
  'updatedAt',
  '-updatedAt',
  'severity',
  '-severity',
] as const;
export type IncidentSort = (typeof INCIDENT_SORTS)[number];

export const incidentListQuerySchema = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  service: z.string().min(1).max(64).optional(),
  assignee: z.string().min(1).max(64).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(INCIDENT_SORTS).default('-createdAt'),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type IncidentListQuery = z.infer<typeof incidentListQuerySchema>;

// ---------------------------------------------------------------- responses

export interface PersonRef {
  userId: string;
  displayName: string;
}

export interface Incident {
  id: string;
  organizationId: string;
  serviceId: string;
  serviceName: string;
  region: string;
  title: string;
  description: string;
  severity: (typeof SEVERITIES)[number];
  status: IncidentStatus;
  assignee: PersonRef | null;
  createdBy: PersonRef;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  /** Optimistic-concurrency token: send it back as `expectedVersion` (FR-INC-009). */
  version: number;
  updatedAt: string;
}

export interface IncidentPage {
  items: Incident[];
  /** Opaque; pass back as `cursor`. Null on the last page. */
  nextCursor: string | null;
  /** Total matches for the filters (independent of the cursor). */
  total: number;
}

export interface IncidentEvent {
  id: string;
  action: string;
  actor: PersonRef;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  occurredAt: string;
}

/** A member who can be assigned incidents (active, with `incident:update`). */
export interface AssigneeOption extends PersonRef {
  role: Role;
}
