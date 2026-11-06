import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { ENV } from '../config/env.module.js';
import type { Env } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from '../realtime/outbox.service.js';
import {
  buildHourRows,
  buildMinuteRows,
  insertMetricAggregates,
  wholeHours,
} from '../seed/metrics-seed.js';
import { toMinute } from '../seed/telemetry.js';
import { scenarioOverride } from './scenario-state.js';

/** Minute-level telemetry kept per tenant (spec 9.3 demo retention for fine-grained data). */
export const MINUTE_RETENTION = 24 * 60;

/**
 * Serializes everything that writes a tenant's telemetry or restores its dataset until the
 * transaction ends: the simulator tick, scenario changes and the demo reset. It must be the
 * first lock a transaction takes: taking row locks first and this one second would let two
 * transactions wait on each other.
 */
export async function lockSimulation(tx: Prisma.TransactionClient, orgId: string) {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`sim:${orgId}`}))`);
}

/**
 * The simulator worker (FR-SIM-001/002). Telemetry is a pure function of (series, minute),
 * so this keeps every tenant current by appending the minutes that completed since the last
 * tick. Demo scenarios override the generated state for the series and minutes they cover,
 * and are closed once their time is up.
 */
@Injectable()
export class SimulatorService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SimulatorService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    if (!this.env.BACKGROUND_WORKERS) return;
    this.timer = setInterval(() => void this.tick(), this.env.SIMULATOR_TICK_MS);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.advanceAll();
    } catch (error) {
      this.log.error('Simulator tick failed', error as Error);
    } finally {
      this.running = false;
    }
  }

  async advanceAll(now = new Date()) {
    const organizations = await this.prisma.organization.findMany({ select: { id: true } });
    for (const { id } of organizations) {
      try {
        await this.advance(id, now);
      } catch (error) {
        this.log.error(`Simulator failed for ${id}`, error as Error);
      }
    }
  }

  /** Brings one tenant's telemetry up to `now` and closes scenarios whose time is up. */
  async advance(orgId: string, now = new Date()) {
    return this.prisma.$transaction(
      async (tx) => {
        await lockSimulation(tx, orgId);
        const minutes = await this.appendMinutes(tx, orgId, now);
        const finished = await this.finishDue(tx, orgId, now);
        return { minutes, finished };
      },
      { timeout: 30_000 },
    );
  }

  private async appendMinutes(tx: Prisma.TransactionClient, orgId: string, now: Date) {
    const nowMinute = toMinute(now);
    const latest = await tx.metricAggregate.aggregate({
      where: { organizationId: orgId, bucketSize: 'MINUTE' },
      _max: { bucketStart: true },
    });
    if (!latest._max.bucketStart) return 0; // never seeded: nothing to continue from

    // Only completed minutes are stored. After a long outage of the worker, catch up on the
    // retained window rather than backfilling days of fine-grained data.
    const from = Math.max(toMinute(latest._max.bucketStart) + 1, nowMinute - MINUTE_RETENTION);
    if (from >= nowMinute) return 0;

    const services = await tx.service.findMany({
      where: { organizationId: orgId },
      select: { id: true, slug: true },
    });
    const scenarios = await tx.demoScenario.findMany({
      where: { organizationId: orgId, endsAt: { gt: new Date(from * 60_000) } },
      select: { serviceId: true, region: true, kind: true, startedAt: true, endsAt: true },
    });
    const override = scenarioOverride(scenarios);

    await insertMetricAggregates(
      tx,
      [
        ...buildMinuteRows(orgId, services, from, nowMinute, override),
        ...buildHourRows(orgId, services, wholeHours(from - 60, nowMinute), override),
      ],
      { ignoreConflicts: true },
    );
    await tx.metricAggregate.deleteMany({
      where: {
        organizationId: orgId,
        bucketSize: 'MINUTE',
        bucketStart: { lt: new Date((nowMinute - MINUTE_RETENTION) * 60_000) },
      },
    });
    return nowMinute - from;
  }

  /** Marks running scenarios that reached their end as finished. Caller holds the lock. */
  async finishDue(tx: Prisma.TransactionClient, orgId: string, now: Date) {
    const due = await tx.demoScenario.findMany({
      where: { organizationId: orgId, status: 'RUNNING', endsAt: { lte: now } },
      orderBy: { startedAt: 'asc' },
    });
    for (const scenario of due) {
      await tx.demoScenario.update({
        where: { id: scenario.id },
        data: { status: 'FINISHED', finishedAt: now },
      });
      await this.recordFinished(tx, orgId, scenario, 'completed');
    }
    return due.map((s) => s.id);
  }

  async recordFinished(
    tx: Prisma.TransactionClient,
    orgId: string,
    scenario: { id: string; serviceId: string; region: string; kind: string },
    reason: 'completed' | 'cancelled',
    actorId: string | null = null,
    requestId?: string,
  ) {
    await tx.auditLog.create({
      data: {
        organizationId: orgId,
        actorId,
        action: 'demo.scenario.finished',
        entityType: 'demo-scenario',
        entityId: scenario.id,
        changesJson: { kind: scenario.kind, region: scenario.region, reason },
        requestId,
      },
    });
    await this.outbox.append(tx, {
      organizationId: orgId,
      type: 'simulator.scenario.finished',
      entityId: scenario.id,
      payload: {
        serviceId: scenario.serviceId,
        region: scenario.region,
        kind: scenario.kind,
        reason,
      },
    });
  }
}
