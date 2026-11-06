import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SEVERITIES, hasPermission, isEditable, transitionTarget } from '@pulseops/contracts';
import type {
  AssigneeOption,
  AssignIncidentRequest,
  CreateIncidentRequest,
  Incident,
  IncidentEvent,
  IncidentListQuery,
  IncidentPage,
  IncidentTransition,
  Role,
  UpdateIncidentRequest,
} from '@pulseops/contracts';

import { Prisma } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from '../realtime/outbox.service.js';

/** Who is acting and where from: recorded on every audit entry (FR-INC-011). */
export interface Actor {
  userId: string;
  role: Role;
  requestId?: string;
}

const INCLUDE = {
  service: { select: { name: true } },
  assignee: { include: { user: { select: { displayName: true } } } },
  creator: { include: { user: { select: { displayName: true } } } },
} satisfies Prisma.IncidentInclude;

interface MemberName {
  userId: string;
  user: { displayName: string };
}

/** An incident with the names the API exposes; the list query includes them, `find` loads them. */
type IncidentRow = Prisma.IncidentGetPayload<object> & {
  service: { name: string };
  assignee: MemberName | null;
  creator: MemberName;
};

function toDto(row: IncidentRow): Incident {
  return {
    id: row.id,
    organizationId: row.organizationId,
    serviceId: row.serviceId,
    serviceName: row.service.name,
    region: row.region,
    title: row.title,
    description: row.description,
    severity: row.severity,
    status: row.status,
    assignee: row.assignee
      ? { userId: row.assignee.userId, displayName: row.assignee.user.displayName }
      : null,
    createdBy: { userId: row.creator.userId, displayName: row.creator.user.displayName },
    createdAt: row.createdAt.toISOString(),
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

type Tx = Prisma.TransactionClient;

/** What one mutation changes, described once and written to the timeline, audit log and outbox. */
interface Change {
  /** Timeline / audit action, e.g. `status.acknowledged`. */
  action: string;
  /** Real-time event type (spec 11.3). */
  eventType: 'incident.updated' | 'incident.assigned' | 'incident.status.changed';
  data: Prisma.IncidentUncheckedUpdateManyInput;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

interface Cursor {
  v: string;
  id: string;
}

function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function invalidCursor(): never {
  throw new UnprocessableEntityException({
    message: 'Validation failed',
    details: { formErrors: [], fieldErrors: { cursor: ['Invalid cursor'] } },
  });
}

function decodeCursor(raw: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (typeof parsed.v === 'string' && typeof parsed.id === 'string') {
      return { v: parsed.v, id: parsed.id };
    }
  } catch {
    // fall through
  }
  return invalidCursor();
}

@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------ reads

  async list(orgId: string, query: IncidentListQuery): Promise<IncidentPage> {
    const field = query.sort.replace('-', '') as 'createdAt' | 'updatedAt' | 'severity';
    const dir: 'asc' | 'desc' = query.sort.startsWith('-') ? 'desc' : 'asc';

    const filters: Prisma.IncidentWhereInput = {
      organizationId: orgId,
      ...(query.status && { status: query.status }),
      ...(query.severity && { severity: query.severity }),
      ...(query.service && { serviceId: query.service }),
      ...(query.assignee && { assigneeId: query.assignee }),
      ...(query.q && { title: { contains: query.q, mode: 'insensitive' } }),
    };
    const where = query.cursor
      ? { AND: [filters, this.after(field, dir, decodeCursor(query.cursor))] }
      : filters;

    const [rows, total] = await Promise.all([
      this.prisma.incident.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ [field]: dir }, { id: dir }],
        take: query.limit + 1,
      }),
      this.prisma.incident.count({ where: filters }),
    ]);

    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const hasMore = rows.length > query.limit;
    return {
      items: page.map(toDto),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              v: field === 'severity' ? last.severity : last[field].toISOString(),
              id: last.id,
            })
          : null,
      total,
    };
  }

  /** Keyset condition: rows strictly after `cursor` in the requested order. */
  private after(
    field: 'createdAt' | 'updatedAt' | 'severity',
    dir: 'asc' | 'desc',
    cursor: Cursor,
  ): Prisma.IncidentWhereInput {
    if (field === 'severity') {
      // Postgres orders enums by declaration order, which matches SEVERITIES.
      const index = SEVERITIES.indexOf(cursor.v as (typeof SEVERITIES)[number]);
      if (index < 0) invalidCursor();
      const beyond = dir === 'asc' ? SEVERITIES.slice(index + 1) : SEVERITIES.slice(0, index);
      return {
        OR: [
          { severity: { in: [...beyond] } },
          {
            severity: SEVERITIES[index]!,
            id: dir === 'asc' ? { gt: cursor.id } : { lt: cursor.id },
          },
        ],
      };
    }
    const at = new Date(cursor.v);
    if (Number.isNaN(at.getTime())) invalidCursor();
    const cmp = dir === 'asc' ? 'gt' : 'lt';
    return {
      OR: [{ [field]: { [cmp]: at } }, { [field]: at, id: { [cmp]: cursor.id } }],
    };
  }

  /** Members the assignee picker may offer: active and able to work incidents. */
  async assignees(orgId: string): Promise<AssigneeOption[]> {
    const members = await this.prisma.membership.findMany({
      where: { organizationId: orgId, status: 'ACTIVE' },
      include: { user: { select: { displayName: true } } },
      orderBy: { user: { displayName: 'asc' } },
    });
    return members
      .filter((m) => hasPermission(m.role, 'incident:update'))
      .map((m) => ({ userId: m.userId, displayName: m.user.displayName, role: m.role }));
  }

  async get(orgId: string, incidentId: string): Promise<Incident> {
    return toDto(await this.find(this.prisma, orgId, incidentId));
  }

  async events(orgId: string, incidentId: string): Promise<IncidentEvent[]> {
    await this.find(this.prisma, orgId, incidentId);
    const rows = await this.prisma.incidentEvent.findMany({
      where: { organizationId: orgId, incidentId },
      include: { actor: { select: { id: true, displayName: true } } },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      take: 500,
    });
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      actor: { userId: row.actor.id, displayName: row.actor.displayName },
      before: (row.beforeJson as Record<string, unknown> | null) ?? null,
      after: (row.afterJson as Record<string, unknown> | null) ?? null,
      occurredAt: row.occurredAt.toISOString(),
    }));
  }

  // ------------------------------------------------------------ writes

  async create(orgId: string, actor: Actor, input: CreateIncidentRequest): Promise<Incident> {
    const service = await this.prisma.service.findFirst({
      where: { id: input.serviceId, organizationId: orgId },
      select: { id: true },
    });
    if (!service) this.invalid('serviceId', 'Service not found');
    if (input.assigneeId) await this.assertAssignable(this.prisma, orgId, input.assigneeId);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.incident.create({
        data: {
          organizationId: orgId,
          serviceId: input.serviceId,
          region: input.region,
          title: input.title,
          description: input.description,
          severity: input.severity,
          assigneeId: input.assigneeId ?? null,
          createdBy: actor.userId,
        },
      });
      const row = await this.find(tx, orgId, created.id);
      const after = {
        title: row.title,
        severity: row.severity,
        status: row.status,
        assigneeId: row.assigneeId,
      };
      await this.record(tx, orgId, actor, row, 'created', 'incident.created', null, after);
      return toDto(row);
    });
  }

  update(orgId: string, incidentId: string, actor: Actor, input: UpdateIncidentRequest) {
    return this.mutate(orgId, incidentId, actor, input.expectedVersion, (current) => {
      this.assertEditable(current);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const data: Prisma.IncidentUncheckedUpdateManyInput = {};
      for (const key of ['title', 'description', 'severity'] as const) {
        const next = input[key];
        if (next !== undefined && next !== current[key]) {
          before[key] = current[key];
          after[key] = next;
          (data as Record<string, unknown>)[key] = next;
        }
      }
      if (Object.keys(data).length === 0) return null;
      return { action: 'updated', eventType: 'incident.updated', data, before, after };
    });
  }

  assign(orgId: string, incidentId: string, actor: Actor, input: AssignIncidentRequest) {
    return this.mutate(orgId, incidentId, actor, input.expectedVersion, async (current, tx) => {
      this.assertEditable(current);
      if (input.assigneeId === current.assigneeId) return null;
      if (input.assigneeId) await this.assertAssignable(tx, orgId, input.assigneeId);
      return {
        action: input.assigneeId ? 'assigned' : 'unassigned',
        eventType: 'incident.assigned',
        data: { assigneeId: input.assigneeId },
        before: { assigneeId: current.assigneeId },
        after: { assigneeId: input.assigneeId },
      };
    });
  }

  transition(
    orgId: string,
    incidentId: string,
    actor: Actor,
    transition: IncidentTransition,
    expectedVersion: number,
    reason?: string,
  ) {
    return this.mutate(orgId, incidentId, actor, expectedVersion, (current) => {
      const target = transitionTarget(transition, current.status, actor.role);
      if (!target) {
        throw new ConflictException({
          message: `Cannot ${transition} an incident that is ${current.status}`,
          details: { reason: 'INVALID_TRANSITION', status: current.status },
        });
      }
      const now = new Date();
      const data: Prisma.IncidentUncheckedUpdateManyInput = { status: target };
      if (transition === 'acknowledge') data.acknowledgedAt = now;
      if (transition === 'resolve') data.resolvedAt = now;
      // Reopening keeps acknowledgedAt (MTTA stays the original response) and clears
      // resolvedAt, so MTTR is measured to the final resolution.
      if (transition === 'reopen') data.resolvedAt = null;
      return {
        action: `status.${transition}`,
        eventType: 'incident.status.changed',
        data,
        before: { status: current.status },
        after: { status: target, ...(reason && { reason }) },
      };
    });
  }

  // ------------------------------------------------------------ internals

  /**
   * One optimistic-concurrency write (FR-INC-009, BR-010). The `version` guard in the
   * UPDATE makes the check atomic; the change, timeline entry, audit log and outbox event
   * commit together or not at all.
   */
  private mutate(
    orgId: string,
    incidentId: string,
    actor: Actor,
    expectedVersion: number,
    plan: (current: IncidentRow, tx: Tx) => Change | null | Promise<Change | null>,
  ): Promise<Incident> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.find(tx, orgId, incidentId);
      if (current.version !== expectedVersion) this.versionConflict(current);

      const change = await plan(current, tx);
      if (!change) return toDto(current); // nothing to change: no version bump, no noise

      const { count } = await tx.incident.updateMany({
        where: { id: incidentId, organizationId: orgId, version: expectedVersion },
        data: { ...change.data, version: { increment: 1 } },
      });
      if (count === 0) {
        // Another writer won between our read and the guarded update.
        this.versionConflict(await this.find(tx, orgId, incidentId));
      }

      const updated = await this.find(tx, orgId, incidentId);
      await this.record(
        tx,
        orgId,
        actor,
        updated,
        change.action,
        change.eventType,
        change.before,
        change.after,
      );
      return toDto(updated);
    });
  }

  private async record(
    tx: Tx,
    orgId: string,
    actor: Actor,
    incident: IncidentRow,
    action: string,
    eventType: Change['eventType'] | 'incident.created',
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ) {
    const json = (value: Record<string, unknown> | null) =>
      value === null ? Prisma.DbNull : (value as Prisma.InputJsonObject);

    await tx.incidentEvent.create({
      data: {
        organizationId: orgId,
        incidentId: incident.id,
        actorId: actor.userId,
        action,
        beforeJson: json(before),
        afterJson: json(after),
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: orgId,
        actorId: actor.userId,
        action: `incident.${action}`,
        entityType: 'incident',
        entityId: incident.id,
        changesJson: { before, after } as Prisma.InputJsonObject,
        requestId: actor.requestId ?? null,
      },
    });

    await this.outbox.append(tx, {
      organizationId: orgId,
      type: eventType,
      entityId: incident.id,
      version: incident.version,
      payload: {
        status: incident.status,
        severity: incident.severity,
        assigneeId: incident.assigneeId,
      },
    });

    // Tell a new assignee, unless they assigned themselves (FR-NOTIF-002).
    const assigned = eventType === 'incident.assigned' || eventType === 'incident.created';
    if (assigned && incident.assigneeId && incident.assigneeId !== actor.userId) {
      await this.notifications.notify(tx, orgId, [incident.assigneeId], {
        type: 'INCIDENT',
        title: `Incident assigned to you: ${incident.title}`,
        body: `${incident.severity} on ${incident.service.name}`,
        referenceType: 'incident',
        referenceId: incident.id,
      });
    }
  }

  /**
   * Tenant-scoped lookup: another organization's incident is simply "not found".
   * Names are loaded with sequential queries rather than `include`, because Prisma runs
   * an include's sub-queries in parallel, which a transaction's single connection rejects.
   */
  private async find(
    db: Tx | PrismaService,
    orgId: string,
    incidentId: string,
  ): Promise<IncidentRow> {
    const row = await db.incident.findFirst({ where: { id: incidentId, organizationId: orgId } });
    if (!row) throw new NotFoundException('Incident not found');

    const service = await db.service.findFirstOrThrow({
      where: { id: row.serviceId, organizationId: orgId },
      select: { name: true },
    });
    const ids = [row.createdBy, ...(row.assigneeId ? [row.assigneeId] : [])];
    const users = await db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, displayName: true },
    });
    const named = (userId: string): MemberName => ({
      userId,
      user: { displayName: users.find((u) => u.id === userId)?.displayName ?? 'Unknown user' },
    });
    return {
      ...row,
      service,
      assignee: row.assigneeId ? named(row.assigneeId) : null,
      creator: named(row.createdBy),
    };
  }

  /** Assignees must be active members who can actually work incidents (FR-INC-005). */
  private async assertAssignable(db: Tx | PrismaService, orgId: string, userId: string) {
    const membership = await db.membership.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (
      !membership ||
      membership.status !== 'ACTIVE' ||
      !hasPermission(membership.role, 'incident:update')
    ) {
      this.invalid('assigneeId', 'Assignee must be an active member who can handle incidents');
    }
  }

  private assertEditable(current: IncidentRow) {
    if (!isEditable(current.status)) {
      throw new ConflictException({
        message: 'A resolved incident cannot be edited; reopen it first',
        details: { reason: 'INVALID_TRANSITION', status: current.status },
      });
    }
  }

  /** 409 carrying the latest state so the client can show it and decide whether to retry. */
  private versionConflict(current: IncidentRow): never {
    throw new ConflictException({
      message: 'The incident was changed by someone else',
      details: { reason: 'VERSION_CONFLICT', current: toDto(current) },
    });
  }

  private invalid(field: string, message: string): never {
    throw new UnprocessableEntityException({
      message: 'Validation failed',
      details: { formErrors: [], fieldErrors: { [field]: [message] } },
    });
  }
}
