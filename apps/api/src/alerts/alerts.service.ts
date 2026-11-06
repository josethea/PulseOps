import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { thresholdProblem } from '@pulseops/contracts';
import type {
  Alert,
  AlertListQuery,
  AlertPage,
  AlertRule,
  CreateAlertRuleRequest,
  MetricKey,
  UpdateAlertRuleRequest,
} from '@pulseops/contracts';

import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from '../realtime/outbox.service.js';

export interface RuleActor {
  userId: string;
  requestId?: string;
}

type RuleRow = Prisma.AlertRuleGetPayload<{ include: { service: { select: { name: true } } } }>;
type OccurrenceRow = Prisma.AlertOccurrenceGetPayload<{
  include: { rule: true; service: { select: { name: true } } };
}>;

const RULE_INCLUDE = { service: { select: { name: true } } } satisfies Prisma.AlertRuleInclude;
const OCCURRENCE_INCLUDE = {
  rule: true,
  service: { select: { name: true } },
} satisfies Prisma.AlertOccurrenceInclude;

export function ruleToDto(row: RuleRow): AlertRule {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    serviceId: row.serviceId,
    serviceName: row.service.name,
    metricKey: row.metricKey as MetricKey,
    operator: row.operator,
    threshold: row.threshold,
    windowSeconds: row.windowSeconds,
    cooldownSeconds: row.cooldownSeconds,
    severity: row.severity,
    isEnabled: row.isEnabled,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function occurrenceToDto(row: OccurrenceRow): Alert {
  return {
    id: row.id,
    organizationId: row.organizationId,
    ruleId: row.ruleId,
    ruleName: row.rule.name,
    serviceId: row.serviceId,
    serviceName: row.service.name,
    metricKey: row.rule.metricKey as MetricKey,
    operator: row.rule.operator,
    threshold: row.rule.threshold,
    severity: row.rule.severity,
    state: row.state,
    observedValue: row.observedValue,
    triggeredAt: row.triggeredAt.toISOString(),
    clearedAt: row.clearedAt?.toISOString() ?? null,
    relatedIncidentId: row.relatedIncidentId,
  };
}

function invalid(field: string, message: string): never {
  throw new UnprocessableEntityException({
    message: 'Validation failed',
    details: { formErrors: [], fieldErrors: { [field]: [message] } },
  });
}

function decodeCursor(raw: string): { at: Date; id: string } {
  try {
    const [at, id] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as [string, string];
    const date = new Date(at);
    if (typeof id === 'string' && !Number.isNaN(date.getTime())) return { at: date, id };
  } catch {
    // fall through
  }
  return invalid('cursor', 'Invalid cursor');
}

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  // ------------------------------------------------------------ rules

  async listRules(orgId: string): Promise<AlertRule[]> {
    const rows = await this.prisma.alertRule.findMany({
      where: { organizationId: orgId },
      include: RULE_INCLUDE,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(ruleToDto);
  }

  async createRule(
    orgId: string,
    actor: RuleActor,
    input: CreateAlertRuleRequest,
  ): Promise<AlertRule> {
    const service = await this.prisma.service.findFirst({
      where: { id: input.serviceId, organizationId: orgId },
      select: { id: true },
    });
    if (!service) invalid('serviceId', 'Service not found');
    const metric = await this.prisma.metricDefinition.findUnique({
      where: { key: input.metricKey },
      select: { key: true },
    });
    if (!metric) invalid('metricKey', 'Metric not found');

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.alertRule.create({
        data: { ...input, organizationId: orgId, createdBy: actor.userId },
        include: RULE_INCLUDE,
      });
      await this.record(tx, orgId, actor, created, 'rule.created', null, ruleToDto(created));
      return ruleToDto(created);
    });
  }

  /**
   * Optimistic concurrency like incidents: the guarded UPDATE only matches the version the
   * editor saw, so a stale save gets 409 with the current rule. Bumping the version also
   * means the next evaluation applies the new configuration (UC-09).
   */
  async updateRule(
    orgId: string,
    ruleId: string,
    actor: RuleActor,
    input: UpdateAlertRuleRequest,
  ): Promise<AlertRule> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.findRule(tx, orgId, ruleId);
      if (current.version !== input.expectedVersion) this.conflict(current);

      const { expectedVersion, ...changes } = input;
      const data = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
      const problem = thresholdProblem(
        current.metricKey as MetricKey,
        (data.threshold as number | undefined) ?? current.threshold,
      );
      if (problem) invalid('threshold', problem);

      const { count } = await tx.alertRule.updateMany({
        where: { id: ruleId, organizationId: orgId, version: expectedVersion },
        data: { ...data, version: { increment: 1 } },
      });
      if (count === 0) this.conflict(await this.findRule(tx, orgId, ruleId));

      const updated = await this.findRule(tx, orgId, ruleId);
      await this.record(
        tx,
        orgId,
        actor,
        updated,
        'rule.updated',
        ruleToDto(current),
        ruleToDto(updated),
      );
      return ruleToDto(updated);
    });
  }

  // ------------------------------------------------------------ alerts

  async listAlerts(orgId: string, query: AlertListQuery): Promise<AlertPage> {
    const filters: Prisma.AlertOccurrenceWhereInput = {
      organizationId: orgId,
      ...(query.state && { state: query.state }),
      ...(query.severity && { rule: { severity: query.severity } }),
    };
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const where: Prisma.AlertOccurrenceWhereInput = cursor
      ? {
          AND: [
            filters,
            {
              OR: [
                { triggeredAt: { lt: cursor.at } },
                { triggeredAt: cursor.at, id: { lt: cursor.id } },
              ],
            },
          ],
        }
      : filters;

    const rows = await this.prisma.alertOccurrence.findMany({
      where,
      include: OCCURRENCE_INCLUDE,
      orderBy: [{ triggeredAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items.at(-1);
    return {
      items: items.map(occurrenceToDto),
      nextCursor:
        hasMore && last
          ? Buffer.from(JSON.stringify([last.triggeredAt.toISOString(), last.id])).toString(
              'base64url',
            )
          : null,
    };
  }

  // ------------------------------------------------------------ internals

  private async findRule(tx: Prisma.TransactionClient, orgId: string, ruleId: string) {
    const row = await tx.alertRule.findFirst({
      where: { id: ruleId, organizationId: orgId },
      include: RULE_INCLUDE,
    });
    if (!row) throw new NotFoundException('Alert rule not found');
    return row;
  }

  private conflict(current: RuleRow): never {
    throw new ConflictException({
      message: 'The alert rule was changed by someone else',
      details: { reason: 'VERSION_CONFLICT', current: ruleToDto(current) },
    });
  }

  private async record(
    tx: Prisma.TransactionClient,
    orgId: string,
    actor: RuleActor,
    row: RuleRow,
    action: string,
    before: AlertRule | null,
    after: AlertRule,
  ) {
    await tx.auditLog.create({
      data: {
        organizationId: orgId,
        actorId: actor.userId,
        action: `alert.${action}`,
        entityType: 'alert-rule',
        entityId: row.id,
        changesJson: { before, after } as unknown as Prisma.InputJsonObject,
        requestId: actor.requestId ?? null,
      },
    });
    await this.outbox.append(tx, {
      organizationId: orgId,
      type: 'alert-rule.updated',
      entityId: row.id,
      version: row.version,
      payload: { isEnabled: row.isEnabled },
    });
  }
}
