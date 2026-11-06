/**
 * Real-time contract (spec section 11). Events are hints: the HTTP API stays the authority,
 * so a client that misses or doubts an event simply refetches.
 */

export const REALTIME_NAMESPACE = '/operations';

export const REALTIME_EVENT_TYPES = [
  'incident.created',
  'incident.updated',
  'incident.assigned',
  'incident.status.changed',
  'alert.triggered',
  'alert.cleared',
  'alert-rule.updated',
  'notification.created',
  'notification.read',
  'simulator.scenario.started',
  'simulator.scenario.finished',
  'simulator.reset',
] as const;
export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

/** Socket.IO message names (server -> client). */
export const SOCKET_MESSAGES = {
  event: 'event',
  /** Sent once the connection is accepted and any replay has been queued. */
  ready: 'ready',
  /** The client's cursor is too old to replay: refetch snapshots, then reconnect with `cursor`. */
  resync: 'resync_required',
} as const;

export interface RealtimeEnvelope {
  eventId: string;
  organizationId: string;
  /** Strictly increasing and gap-free within one organization's stream. */
  sequence: number;
  type: RealtimeEventType;
  occurredAt: string;
  entityId: string;
  /** Aggregate version when the entity is versioned; clients ignore events that go backwards. */
  version: number | null;
  payload: Record<string, unknown>;
}

export interface ReadyMessage {
  organizationId: string;
  /** Highest sequence the server holds for this tenant when the connection was accepted. */
  cursor: number;
  /** Events replayed to this client before `ready` (0 for a fresh connection). */
  replayed: number;
}

export interface ResyncMessage {
  reason: 'cursor_expired' | 'cursor_ahead' | 'replay_too_large';
  cursor: number;
}

/** Handshake `auth` payload. The tenant is validated against the session, never trusted. */
export interface RealtimeHandshake {
  organizationId: string;
  /** Last sequence the client applied; omit on first connect. */
  lastSeenSequence?: number;
}

export interface RealtimeCursor {
  cursor: number;
}
