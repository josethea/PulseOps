import type { RealtimeEnvelope } from '@pulseops/contracts';

export type Delivery = 'apply' | 'duplicate' | 'gap';

/**
 * Decides what to do with an incoming event given the last sequence applied (spec 11.4).
 * Sequences are gap-free per tenant, so anything but the next number is either already
 * seen or proof that something was lost.
 */
export function classify(lastSeen: number | null, sequence: number): Delivery {
  if (lastSeen === null) return 'apply';
  if (sequence <= lastSeen) return 'duplicate';
  return sequence === lastSeen + 1 ? 'apply' : 'gap';
}

/**
 * Cache entries an event makes stale. Events are hints (BR-016): rather than patching
 * data from the payload, the affected queries are refetched from the API.
 */
export function affectedQueries(
  event: Pick<RealtimeEnvelope, 'type' | 'payload'>,
  orgId: string,
  userId: string,
): (readonly string[])[] {
  const org = ['org', orgId] as const;
  switch (event.type) {
    case 'incident.created':
    case 'incident.updated':
    case 'incident.assigned':
    case 'incident.status.changed':
      return [
        [...org, 'incidents'],
        [...org, 'dashboard'],
      ];
    case 'alert.triggered':
    case 'alert.cleared':
      return [
        [...org, 'alerts'],
        [...org, 'dashboard'],
      ];
    case 'alert-rule.updated':
      return [[...org, 'alert-rules']];
    case 'simulator.scenario.started':
    case 'simulator.scenario.finished':
      return [
        [...org, 'demo'],
        [...org, 'dashboard'],
      ];
    case 'simulator.reset':
      // The whole tenant was restored: nothing cached for it can be trusted.
      return [org];
    case 'notification.created':
    case 'notification.read':
      // The stream is shared by the tenant; only the recipient has anything to refetch.
      return event.payload.recipientId === userId ? [[...org, 'notifications']] : [];
  }
}

/** Where the Socket.IO server lives: an explicit URL, or the API port on the current host. */
export function realtimeUrl(
  location: Pick<Location, 'protocol' | 'hostname'>,
  configured?: string,
): string {
  return configured || `${location.protocol}//${location.hostname}:4000`;
}

/** Handshake refusals that retrying cannot fix (spec 11.4: do not retry auth errors). */
export const FATAL_HANDSHAKE_ERRORS = [
  'unauthenticated',
  'forbidden',
  'forbidden_origin',
  'organization_required',
];
