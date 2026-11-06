import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DEFAULT_SCENARIO_SERVICE_SLUG } from '@pulseops/contracts';
import type {
  DemoResetResult,
  DemoScenario,
  DemoStatus,
  StartScenarioRequest,
} from '@pulseops/contracts';

import { ENV } from '../config/env.module.js';
import type { Env } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from '../realtime/outbox.service.js';
import { DEMO_INCIDENT_COUNT, buildAlertRules, buildIncidents } from '../seed/demo-data.js';
import {
  buildHourRows,
  buildMinuteRows,
  insertMetricAggregates,
  wholeHours,
} from '../seed/metrics-seed.js';
import { toMinute } from '../seed/telemetry.js';
import { MINUTE_RETENTION, SimulatorService, lockSimulation } from './simulator.service.js';

export interface DemoActor {
  userId: string;
  requestId?: string;
}

const HOUR_MS = 3_600_000;
const INSERT_CHUNK = 5000;
const RECENT_LIMIT = 5;

type ScenarioRow = Prisma.DemoScenarioGetPayload<{
  include: {
    service: { select: { name: true } };
    startedBy: { select: { displayName: true } };
  };
}>;

const scenarioInclude = {
  service: { select: { name: true } },
  startedBy: { select: { displayName: true } },
} satisfies Prisma.DemoScenarioInclude;

function toDto(row: ScenarioRow): DemoScenario {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    serviceId: row.serviceId,
    serviceName: row.service.name,
    region: row.region,
    startedAt: row.startedAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    startedByName: row.startedBy?.displayName ?? null,
  };
}

/**
 * Demo controls (spec 18, FR-SIM-003/005): start and stop synthetic incidents and restore
 * the tenant's dataset. Everything is scoped to one demo tenant (BR-015), limited by a
 * rolling quota, and recorded in the audit log.
 */
@Injectable()
export class DemoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly simulator: SimulatorService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async status(orgId: string, now = new Date()): Promise<DemoStatus> {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { isDemo: true, lastDemoResetAt: true },
    });
    const reason = !this.env.DEMO_ENABLED
      ? 'demo_disabled'
      : !org.isDemo
        ? 'not_demo_tenant'
        : null;

    const [running, recent, counted] = await Promise.all([
      this.prisma.demoScenario.findFirst({
        where: { organizationId: orgId, status: 'RUNNING', endsAt: { gt: now } },
        include: scenarioInclude,
      }),
      this.prisma.demoScenario.findMany({
        where: { organizationId: orgId },
        orderBy: { startedAt: 'desc' },
        take: RECENT_LIMIT,
        include: scenarioInclude,
      }),
      this.prisma.demoScenario.findMany({
        where: { organizationId: orgId, startedAt: { gt: new Date(now.getTime() - HOUR_MS) } },
        orderBy: { startedAt: 'asc' },
        select: { startedAt: true },
      }),
    ]);

    const limit = this.env.DEMO_SCENARIOS_PER_HOUR;
    const exhausted = counted.length >= limit;
    const resetAvailableAt = org.lastDemoResetAt
      ? new Date(org.lastDemoResetAt.getTime() + this.env.DEMO_RESET_COOLDOWN_SECONDS * 1000)
      : null;

    return {
      enabled: reason === null,
      reason,
      active: running ? toDto(running) : null,
      recent: recent.map((row) =>
        row.status === 'RUNNING' && row.endsAt <= now
          ? toDto({ ...row, status: 'FINISHED' })
          : toDto(row),
      ),
      quota: {
        limit,
        used: counted.length,
        // The slot that frees up first is the oldest scenario in the window.
        nextSlotAt:
          exhausted && counted[0]
            ? new Date(counted[0].startedAt.getTime() + HOUR_MS).toISOString()
            : null,
      },
      reset: {
        lastResetAt: org.lastDemoResetAt?.toISOString() ?? null,
        availableAt:
          resetAvailableAt && resetAvailableAt > now ? resetAvailableAt.toISOString() : null,
      },
    };
  }

  async start(
    orgId: string,
    actor: DemoActor,
    request: StartScenarioRequest,
    now = new Date(),
  ): Promise<DemoScenario> {
    return this.prisma.$transaction(async (tx) => {
      await lockSimulation(tx, orgId);
      await this.requireDemoTenant(tx, orgId);

      const service = request.serviceId
        ? await tx.service.findFirst({ where: { id: request.serviceId, organizationId: orgId } })
        : ((await tx.service.findFirst({
            where: { organizationId: orgId, slug: DEFAULT_SCENARIO_SERVICE_SLUG },
          })) ?? (await tx.service.findFirst({ where: { organizationId: orgId } })));
      if (!service) throw new NotFoundException('Service not found');

      // A scenario that ran out of time but was not closed yet must not block a new one.
      await this.simulator.finishDue(tx, orgId, now);
      const active = await tx.demoScenario.findFirst({
        where: { organizationId: orgId, status: 'RUNNING' },
        include: scenarioInclude,
      });
      if (active) {
        throw new ConflictException({
          message: 'A simulation is already running',
          details: { reason: 'SCENARIO_ACTIVE', active: toDto(active) },
        });
      }

      const since = new Date(now.getTime() - HOUR_MS);
      const counted = await tx.demoScenario.findMany({
        where: { organizationId: orgId, startedAt: { gt: since } },
        orderBy: { startedAt: 'asc' },
        select: { startedAt: true },
      });
      if (counted.length >= this.env.DEMO_SCENARIOS_PER_HOUR) {
        throw new HttpException(
          {
            message: 'Simulation quota reached for this hour',
            details: {
              reason: 'QUOTA_EXCEEDED',
              limit: this.env.DEMO_SCENARIOS_PER_HOUR,
              nextSlotAt: new Date(counted[0]!.startedAt.getTime() + HOUR_MS).toISOString(),
            },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const scenario = await tx.demoScenario.create({
        data: {
          organizationId: orgId,
          serviceId: service.id,
          region: request.region,
          kind: request.kind,
          startedById: actor.userId,
          startedAt: now,
          endsAt: new Date(now.getTime() + request.durationMinutes * 60_000),
        },
        include: scenarioInclude,
      });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorId: actor.userId,
          action: 'demo.scenario.started',
          entityType: 'demo-scenario',
          entityId: scenario.id,
          changesJson: {
            kind: scenario.kind,
            serviceId: service.id,
            region: scenario.region,
            durationMinutes: request.durationMinutes,
          },
          requestId: actor.requestId,
        },
      });
      await this.outbox.append(tx, {
        organizationId: orgId,
        type: 'simulator.scenario.started',
        entityId: scenario.id,
        payload: { serviceId: service.id, region: scenario.region, kind: scenario.kind },
      });
      return toDto(scenario);
    });
  }

  /** Ends a running simulation early. Cancelling one that already ended is a no-op. */
  async cancel(
    orgId: string,
    scenarioId: string,
    actor: DemoActor,
    now = new Date(),
  ): Promise<DemoScenario> {
    return this.prisma.$transaction(async (tx) => {
      await lockSimulation(tx, orgId);

      const scenario = await tx.demoScenario.findFirst({
        where: { id: scenarioId, organizationId: orgId },
        include: scenarioInclude,
      });
      if (!scenario) throw new NotFoundException('Simulation not found');
      if (scenario.status !== 'RUNNING') return toDto(scenario);

      const endsAt = now < scenario.endsAt ? now : scenario.endsAt;
      const updated = await tx.demoScenario.update({
        where: { id: scenario.id },
        data: { status: now < scenario.endsAt ? 'CANCELLED' : 'FINISHED', endsAt, finishedAt: now },
        include: scenarioInclude,
      });
      await this.simulator.recordFinished(
        tx,
        orgId,
        scenario,
        updated.status === 'CANCELLED' ? 'cancelled' : 'completed',
        actor.userId,
        actor.requestId,
      );
      return toDto(updated);
    });
  }

  /**
   * Restores the tenant's dataset: removes everything created during the demo, regenerates
   * the incident backlog and alert rules exactly as seeded, and rewrites the telemetry that
   * simulations altered. Other tenants are never touched (BR-015, DEMO-12).
   */
  async reset(orgId: string, actor: DemoActor, now = new Date()): Promise<DemoResetResult> {
    return this.prisma.$transaction(
      async (tx) => {
        await lockSimulation(tx, orgId);
        const org = await this.requireDemoTenant(tx, orgId);

        const availableAt = org.lastDemoResetAt
          ? new Date(org.lastDemoResetAt.getTime() + this.env.DEMO_RESET_COOLDOWN_SECONDS * 1000)
          : null;
        if (availableAt && availableAt > now) {
          throw new HttpException(
            {
              message: 'The demo was reset a moment ago',
              details: { reason: 'RESET_COOLDOWN', availableAt: availableAt.toISOString() },
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        const services = await tx.service.findMany({
          where: { organizationId: orgId },
          select: { id: true, slug: true },
          orderBy: { id: 'asc' },
        });
        const members = await tx.membership.findMany({
          where: {
            organizationId: orgId,
            status: 'ACTIVE',
            role: { in: ['OPERATOR', 'ORG_ADMIN'] },
          },
          select: { userId: true, role: true },
        });
        const responders = members
          .map((m) => ({ id: m.userId }))
          .sort((a, b) => (a.id < b.id ? -1 : 1));
        const admin = members.find((m) => m.role === 'ORG_ADMIN');
        if (!admin)
          throw new ConflictException('The demo tenant has no administrator to own its rules');

        const earliest = await tx.demoScenario.aggregate({
          where: { organizationId: orgId },
          _min: { startedAt: true },
        });

        // Children first: occurrences point at incidents and rules.
        await tx.alertOccurrence.deleteMany({ where: { organizationId: orgId } });
        await tx.notification.deleteMany({ where: { organizationId: orgId } });
        await tx.incident.deleteMany({ where: { organizationId: orgId } }); // events cascade
        await tx.alertRule.deleteMany({ where: { organizationId: orgId } });
        await tx.demoScenario.deleteMany({ where: { organizationId: orgId } });
        await tx.auditLog.deleteMany({ where: { organizationId: orgId } });

        const spec = {
          id: orgId,
          slug: org.slug,
          services,
          incidentCount: DEMO_INCIDENT_COUNT,
          createdById: admin.userId,
        };
        const rules = buildAlertRules(spec);
        await tx.alertRule.createMany({ data: rules });
        const { incidents, events } = buildIncidents(spec, responders);
        for (let i = 0; i < incidents.length; i += INSERT_CHUNK) {
          await tx.incident.createMany({ data: incidents.slice(i, i + INSERT_CHUNK) });
        }
        for (let i = 0; i < events.length; i += INSERT_CHUNK) {
          await tx.incidentEvent.createMany({ data: events.slice(i, i + INSERT_CHUNK) });
        }

        // Only telemetry from the first simulation onwards can differ from the baseline.
        if (earliest._min.startedAt)
          await this.restoreTelemetry(tx, orgId, services, earliest._min.startedAt, now);

        await tx.organization.update({ where: { id: orgId }, data: { lastDemoResetAt: now } });
        await tx.auditLog.create({
          data: {
            organizationId: orgId,
            actorId: actor.userId,
            action: 'demo.reset',
            entityType: 'organization',
            entityId: orgId,
            changesJson: { incidents: incidents.length, alertRules: rules.length },
            requestId: actor.requestId,
          },
        });
        await this.outbox.append(tx, {
          organizationId: orgId,
          type: 'simulator.reset',
          entityId: orgId,
        });
        return {
          resetAt: now.toISOString(),
          incidents: incidents.length,
          alertRules: rules.length,
        };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }

  /** Rewrites baseline telemetry from the first simulated minute up to now. */
  private async restoreTelemetry(
    tx: Prisma.TransactionClient,
    orgId: string,
    services: { id: string; slug: string }[],
    since: Date,
    now: Date,
  ) {
    const nowMinute = toMinute(now);
    const from = Math.max(toMinute(since), nowMinute - MINUTE_RETENTION);
    const firstHour = Math.floor(from / 60) * 60;
    await tx.metricAggregate.deleteMany({
      where: {
        organizationId: orgId,
        OR: [
          { bucketSize: 'MINUTE', bucketStart: { gte: new Date(from * 60_000) } },
          { bucketSize: 'HOUR', bucketStart: { gte: new Date(firstHour * 60_000) } },
        ],
      },
    });
    await insertMetricAggregates(tx, [
      ...buildMinuteRows(orgId, services, from, nowMinute),
      ...buildHourRows(orgId, services, wholeHours(firstHour, nowMinute)),
    ]);
  }

  private async requireDemoTenant(tx: Prisma.TransactionClient, orgId: string) {
    const org = await tx.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { slug: true, isDemo: true, lastDemoResetAt: true },
    });
    if (!this.env.DEMO_ENABLED || !org.isDemo) {
      throw new ForbiddenException({
        message: 'The simulator is only available in the demo tenant',
        details: { reason: this.env.DEMO_ENABLED ? 'not_demo_tenant' : 'demo_disabled' },
      });
    }
    return org;
  }
}
