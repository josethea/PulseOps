import { Injectable } from '@nestjs/common';
import type { RealtimeEnvelope, RealtimeEventType } from '@pulseops/contracts';

import { Prisma } from '../generated/prisma/client.js';

export interface OutboxEvent {
  organizationId: string;
  type: RealtimeEventType;
  entityId: string;
  /** Aggregate version for versioned entities, so clients can drop stale events. */
  version?: number | null;
  /** Small hints only: no PII or secrets (spec 11.5). */
  payload?: Record<string, unknown>;
}

interface StoredRow {
  id: string;
  organizationId: string;
  eventType: string;
  aggregateId: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
  sequence: bigint;
}

/**
 * Transactional outbox (spec 11.4). Events are written in the same transaction as the
 * business change, so a rolled-back change never leaks an event and a committed one is
 * never lost. A publisher forwards them to Socket.IO afterwards.
 */
@Injectable()
export class OutboxService {
  /**
   * Takes the tenant's next sequence and stores the event. The upsert row-locks the
   * counter until commit, so sequences are gap-free and commit in order.
   */
  async append(tx: Prisma.TransactionClient, event: OutboxEvent): Promise<bigint> {
    const counter = await tx.eventSequence.upsert({
      where: { organizationId: event.organizationId },
      create: { organizationId: event.organizationId, lastSequence: 1 },
      update: { lastSequence: { increment: 1 } },
    });
    await tx.eventOutbox.create({
      data: {
        organizationId: event.organizationId,
        eventType: event.type,
        aggregateId: event.entityId,
        sequence: counter.lastSequence,
        payload: {
          entityId: event.entityId,
          version: event.version ?? null,
          ...event.payload,
        } as Prisma.InputJsonObject,
      },
    });
    return counter.lastSequence;
  }

  toEnvelope(row: StoredRow): RealtimeEnvelope {
    const { entityId, version, ...rest } = (row.payload ?? {}) as Record<string, unknown>;
    return {
      eventId: row.id,
      organizationId: row.organizationId,
      sequence: Number(row.sequence),
      type: row.eventType as RealtimeEventType,
      occurredAt: row.createdAt.toISOString(),
      entityId: typeof entityId === 'string' ? entityId : row.aggregateId,
      version: typeof version === 'number' ? version : null,
      payload: rest,
    };
  }
}
