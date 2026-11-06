import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { ENV } from '../config/env.module.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from './outbox.service.js';
import { RealtimeGateway } from './realtime.gateway.js';

const BATCH = 200;
/** Published rows are kept this long so reconnecting clients can replay from a cursor. */
export const OUTBOX_RETENTION_MS = 60 * 60 * 1000;
const PRUNE_EVERY_MS = 5 * 60 * 1000;

/**
 * Forwards committed outbox rows to Socket.IO (spec 11.4). Delivery is at-least-once: a
 * crash between emit and marking leaves the row to be sent again, which clients tolerate
 * because they ignore sequences they already applied. One instance publishes at a time;
 * running several would need `FOR UPDATE SKIP LOCKED` batching.
 */
@Injectable()
export class OutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(OutboxPublisherService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastPrune = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly gateway: RealtimeGateway,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    if (!this.env.BACKGROUND_WORKERS) return;
    this.timer = setInterval(() => void this.tick(), this.env.OUTBOX_POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      while ((await this.publishPending()) === BATCH) {
        // Drain a backlog without waiting for the next tick.
      }
      await this.prune();
    } catch (error) {
      this.log.error('Outbox publishing failed', error as Error);
    } finally {
      this.running = false;
    }
  }

  /** Publishes one batch in tenant order and returns how many rows it handled. */
  async publishPending(): Promise<number> {
    const rows = await this.prisma.eventOutbox.findMany({
      where: { publishedAt: null },
      orderBy: [{ organizationId: 'asc' }, { sequence: 'asc' }],
      take: BATCH,
    });
    if (rows.length === 0) return 0;

    for (const row of rows) this.gateway.publish(this.outbox.toEnvelope(row));
    await this.prisma.eventOutbox.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { publishedAt: new Date() },
    });
    return rows.length;
  }

  async prune(now = Date.now()) {
    if (now - this.lastPrune < PRUNE_EVERY_MS) return;
    this.lastPrune = now;
    await this.prisma.eventOutbox.deleteMany({
      where: { publishedAt: { lt: new Date(now - OUTBOX_RETENTION_MS) } },
    });
  }
}
