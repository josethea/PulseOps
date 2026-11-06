import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OPERATOR_SYMBOLS, hasPermission, isViolation, mayFire } from '@pulseops/contracts';
import type { Role } from '@pulseops/contracts';

import { ENV } from '../config/env.module.js';
import type { Env } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from '../realtime/outbox.service.js';

export type EvaluationOutcome = 'triggered' | 'cleared' | 'firing' | 'ok' | 'no-data' | 'skipped';

const MINUTE_MS = 60_000;
const SYSTEM_ACTOR = null;

/**
 * Server-side rule evaluation against stored telemetry (FR-ALERT-003).
 *
 * A rule looks at the last `windowSeconds` of completed one-minute buckets, combines the
 * series of the service into one value per minute, and compares the window mean with the
 * threshold. A window that is not fully covered by data is never judged either way.
 *
 * Each rule is evaluated under a row lock, so overlapping runs (or two API instances)
 * cannot both open an episode; the (organization, dedupeKey) unique constraint is the
 * backstop (BR-009).
 */
@Injectable()
export class AlertEvaluatorService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AlertEvaluatorService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    if (!this.env.BACKGROUND_WORKERS) return;
    this.timer = setInterval(() => void this.tick(), this.env.ALERT_EVAL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.evaluateAll();
    } catch (error) {
      this.log.error('Alert evaluation failed', error as Error);
    } finally {
      this.running = false;
    }
  }

  /** Evaluates every rule of every organization (enabled rules, plus disabled ones with open episodes). */
  async evaluateAll(now = new Date()): Promise<Record<EvaluationOutcome, number>> {
    const rules = await this.prisma.alertRule.findMany({
      where: { OR: [{ isEnabled: true }, { occurrences: { some: { state: 'FIRING' } } }] },
      select: { id: true, organizationId: true },
    });
    const totals: Record<EvaluationOutcome, number> = {
      triggered: 0,
      cleared: 0,
      firing: 0,
      ok: 0,
      'no-data': 0,
      skipped: 0,
    };
    for (const rule of rules) {
      try {
        totals[await this.evaluateRule(rule.organizationId, rule.id, now)] += 1;
      } catch (error) {
        this.log.error(`Rule ${rule.id} failed`, error as Error);
      }
    }
    return totals;
  }

  async evaluateRule(orgId: string, ruleId: string, now = new Date()): Promise<EvaluationOutcome> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize evaluations of this rule until commit.
      const locked = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT "id" FROM "AlertRule" WHERE "id" = ${ruleId} AND "organizationId" = ${orgId} FOR UPDATE`,
      );
      if (locked.length === 0) return 'skipped';

      const rule = await tx.alertRule.findUniqueOrThrow({
        where: { id: ruleId },
        include: { service: { select: { name: true } }, metric: { select: { unit: true } } },
      });
      const firing = await tx.alertOccurrence.findFirst({
        where: { ruleId, state: 'FIRING' },
        orderBy: { triggeredAt: 'desc' },
      });

      // A disabled rule never fires, and stops any episode it still has open.
      if (!rule.isEnabled) {
        if (!firing) return 'skipped';
        await this.clear(tx, orgId, rule, firing.id, firing.observedValue, now, 'disabled');
        return 'cleared';
      }

      const windowEnd = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS;
      const minutes = rule.windowSeconds / 60;
      const sample = await this.windowValue(
        tx,
        orgId,
        rule.serviceId,
        rule.metricKey,
        new Date(windowEnd - rule.windowSeconds * 1000),
        new Date(windowEnd),
      );
      if (sample.minutes < minutes || sample.value === null) return 'no-data';

      const violating = isViolation(rule.operator, sample.value, rule.threshold);

      if (firing) {
        if (violating) return 'firing';
        await this.clear(tx, orgId, rule, firing.id, sample.value, now, 'recovered');
        return 'cleared';
      }
      if (!violating) return 'ok';

      const last = await tx.alertOccurrence.findFirst({
        where: { ruleId },
        orderBy: { triggeredAt: 'desc' },
        select: { triggeredAt: true },
      });
      if (!mayFire(last?.triggeredAt ?? null, false, rule.cooldownSeconds, now)) return 'ok';

      await this.trigger(tx, orgId, rule, sample.value, now, windowEnd);
      return 'triggered';
    });
  }

  /**
   * Mean over the window of the per-minute value. A minute's value combines the service's
   * regional series: additive metrics (orders) sum, the rest are count-weighted means.
   */
  private async windowValue(
    tx: Prisma.TransactionClient,
    orgId: string,
    serviceId: string,
    metricKey: string,
    from: Date,
    to: Date,
  ) {
    const definition = await tx.metricDefinition.findUniqueOrThrow({ where: { key: metricKey } });
    const perMinute =
      definition.aggregationType === 'SUM'
        ? Prisma.sql`SUM("avg")`
        : Prisma.sql`SUM("avg" * "count") / NULLIF(SUM("count"), 0)`;
    const rows = await tx.$queryRaw<{ value: number | null; minutes: number }[]>(Prisma.sql`
      SELECT AVG(v)::float8 AS value, COUNT(*)::int AS minutes
      FROM (
        SELECT ${perMinute} AS v
        FROM "MetricAggregate"
        WHERE "organizationId" = ${orgId}
          AND "serviceId" = ${serviceId}
          AND "metricKey" = ${metricKey}
          AND "bucketSize" = 'MINUTE'::"BucketSize"
          AND "bucketStart" >= ${from.toISOString()}::timestamptz
          AND "bucketStart" < ${to.toISOString()}::timestamptz
        GROUP BY "bucketStart"
      ) per_minute
      WHERE v IS NOT NULL
    `);
    return rows[0] ?? { value: null, minutes: 0 };
  }

  private async trigger(
    tx: Prisma.TransactionClient,
    orgId: string,
    rule: RuleWithContext,
    value: number,
    now: Date,
    windowEnd: number,
  ) {
    const occurrence = await tx.alertOccurrence.create({
      data: {
        organizationId: orgId,
        ruleId: rule.id,
        serviceId: rule.serviceId,
        observedValue: value,
        triggeredAt: now,
        dedupeKey: `${rule.id}:${windowEnd}`,
      },
    });
    const cause = this.describe(rule, value);
    await tx.auditLog.create({
      data: {
        organizationId: orgId,
        actorId: SYSTEM_ACTOR,
        action: 'alert.triggered',
        entityType: 'alert',
        entityId: occurrence.id,
        changesJson: { ruleId: rule.id, ruleVersion: rule.version, value, cause },
      },
    });
    await this.outbox.append(tx, {
      organizationId: orgId,
      type: 'alert.triggered',
      entityId: occurrence.id,
      payload: {
        ruleId: rule.id,
        serviceId: rule.serviceId,
        severity: rule.severity,
        state: 'FIRING',
        observedValue: value,
      },
    });

    const members = await tx.membership.findMany({
      where: { organizationId: orgId, status: 'ACTIVE' },
      select: { userId: true, role: true },
    });
    const responders = members
      .filter((m) => hasPermission(m.role as Role, 'incident:update'))
      .map((m) => m.userId);
    await this.notifications.notify(tx, orgId, responders, {
      type: 'ALERT',
      title: `[${rule.severity}] ${rule.name}`,
      body: cause,
      referenceType: 'alert',
      referenceId: occurrence.id,
    });
  }

  private async clear(
    tx: Prisma.TransactionClient,
    orgId: string,
    rule: RuleWithContext,
    occurrenceId: string,
    value: number,
    now: Date,
    reason: 'recovered' | 'disabled',
  ) {
    await tx.alertOccurrence.update({
      where: { id: occurrenceId },
      data: { state: 'CLEARED', clearedAt: now },
    });
    await tx.auditLog.create({
      data: {
        organizationId: orgId,
        actorId: SYSTEM_ACTOR,
        action: 'alert.cleared',
        entityType: 'alert',
        entityId: occurrenceId,
        changesJson: { ruleId: rule.id, value, reason },
      },
    });
    await this.outbox.append(tx, {
      organizationId: orgId,
      type: 'alert.cleared',
      entityId: occurrenceId,
      payload: { ruleId: rule.id, serviceId: rule.serviceId, state: 'CLEARED', reason },
    });
  }

  private describe(rule: RuleWithContext, value: number) {
    const rounded = Math.round(value * 100) / 100;
    return (
      `${rule.metricKey} averaged ${rounded}${rule.metric.unit} ` +
      `(${OPERATOR_SYMBOLS[rule.operator]} ${rule.threshold}) over ${rule.windowSeconds / 60} min ` +
      `on ${rule.service.name}`
    );
  }
}

type RuleWithContext = Prisma.AlertRuleGetPayload<{
  include: { service: { select: { name: true } }; metric: { select: { unit: true } } };
}>;
