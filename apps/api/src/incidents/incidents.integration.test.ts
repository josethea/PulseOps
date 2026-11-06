import type { INestApplication } from '@nestjs/common';
import { SEVERITIES } from '@pulseops/contracts';
import type { Incident, IncidentPage } from '@pulseops/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service.js';
import { DEMO_ORG, OTHER_ORG, createTestApp, demoCookie } from '../test/harness.js';

// Requires the seeded database: `pnpm db:seed`. Incidents created here are removed afterwards.
describe('incidents', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let serviceId: string;
  const cookie: Record<string, string> = {};
  const userId: Record<string, string> = {};
  const created: string[] = [];
  const base = `/api/v1/organizations/${DEMO_ORG}/incidents`;

  const as = (role: string) => ({ Cookie: cookie[role]! });

  async function newIncident(overrides: Record<string, unknown> = {}): Promise<Incident> {
    const res = await http
      .post(base)
      .set(as('OPERATOR'))
      .send({
        title: '[test] Elevated checkout failures',
        description: 'Created by the integration suite',
        serviceId,
        region: 'LIM',
        severity: 'SEV2',
        ...overrides,
      });
    expect(res.status).toBe(201);
    created.push(res.body.id);
    return res.body as Incident;
  }

  const act = (id: string, action: string, body: object, role = 'OPERATOR') =>
    http.post(`${base}/${id}/${action}`).set(as(role)).send(body);

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    for (const role of ['ORG_ADMIN', 'OPERATOR', 'ANALYST', 'VIEWER'] as const) {
      cookie[role] = await demoCookie(app, role);
      const me = await http.get('/api/v1/me').set(as(role));
      userId[role] = me.body.user.id;
    }
    serviceId = (await prisma.service.findFirstOrThrow({ where: { organizationId: DEMO_ORG } })).id;
  });

  afterAll(async () => {
    const notifications = await prisma.notification.findMany({
      where: { referenceType: 'incident', referenceId: { in: created } },
      select: { id: true },
    });
    const notificationIds = notifications.map((n) => n.id);
    await prisma.eventOutbox.deleteMany({ where: { aggregateId: { in: notificationIds } } });
    await prisma.notification.deleteMany({ where: { id: { in: notificationIds } } });
    await prisma.auditLog.deleteMany({
      where: { entityType: 'incident', entityId: { in: created } },
    });
    await prisma.eventOutbox.deleteMany({ where: { aggregateId: { in: created } } });
    await prisma.incident.deleteMany({ where: { id: { in: created } } });
    await app.close();
  });

  describe('permissions', () => {
    it.each(['ORG_ADMIN', 'OPERATOR', 'ANALYST', 'VIEWER'])(
      '%s can read incidents',
      async (role) => {
        const res = await http.get(base).query({ limit: 1 }).set(as(role));
        expect(res.status).toBe(200);
      },
    );

    it.each(['ANALYST', 'VIEWER'])('%s cannot create or change incidents', async (role) => {
      const incident = await newIncident();
      const create = await http
        .post(base)
        .set(as(role))
        .send({ title: 'Nope nope', serviceId, region: 'LIM', severity: 'SEV3' });
      expect(create.status).toBe(403);
      const ack = await act(incident.id, 'acknowledge', { expectedVersion: 1 }, role);
      expect(ack.status).toBe(403);
      const patch = await http
        .patch(`${base}/${incident.id}`)
        .set(as(role))
        .send({ title: 'Changed', expectedVersion: 1 });
      expect(patch.status).toBe(403);
    });
  });

  describe('create', () => {
    it('creates an OPEN incident at version 1 attributed to the caller', async () => {
      const incident = await newIncident();
      expect(incident).toMatchObject({
        status: 'OPEN',
        version: 1,
        organizationId: DEMO_ORG,
        assignee: null,
        createdBy: { userId: userId.OPERATOR },
        acknowledgedAt: null,
        resolvedAt: null,
      });
    });

    it('rejects invalid payloads with a 422 and field errors', async () => {
      const res = await http.post(base).set(as('OPERATOR')).send({ title: 'x' });
      expect(res.status).toBe(422);
      expect(res.body.details.fieldErrors).toHaveProperty('title');
    });

    it("rejects another tenant's service and an unassignable assignee", async () => {
      const foreign = await prisma.service.findFirstOrThrow({
        where: { organizationId: OTHER_ORG },
      });
      const badService = await http
        .post(base)
        .set(as('OPERATOR'))
        .send({ title: 'Foreign svc', serviceId: foreign.id, region: 'LIM', severity: 'SEV3' });
      expect(badService.status).toBe(422);

      const badAssignee = await http.post(base).set(as('OPERATOR')).send({
        title: 'Viewer assignee',
        serviceId,
        region: 'LIM',
        severity: 'SEV3',
        assigneeId: userId.VIEWER,
      });
      expect(badAssignee.status).toBe(422);
    });
  });

  describe('lifecycle', () => {
    it('walks OPEN -> ACKNOWLEDGED -> INVESTIGATING -> RESOLVED -> OPEN, bumping the version', async () => {
      const incident = await newIncident();

      const ack = await act(incident.id, 'acknowledge', { expectedVersion: 1 });
      expect(ack.status).toBe(200);
      expect(ack.body).toMatchObject({ status: 'ACKNOWLEDGED', version: 2 });
      expect(ack.body.acknowledgedAt).not.toBeNull();

      const inv = await act(incident.id, 'investigate', { expectedVersion: 2 });
      expect(inv.body).toMatchObject({ status: 'INVESTIGATING', version: 3 });

      const resolved = await act(incident.id, 'resolve', {
        reason: 'Recovered after rollback',
        expectedVersion: 3,
      });
      expect(resolved.body).toMatchObject({ status: 'RESOLVED', version: 4 });
      expect(resolved.body.resolvedAt).not.toBeNull();

      const reopened = await act(incident.id, 'reopen', {
        reason: 'Errors are back',
        expectedVersion: 4,
      });
      expect(reopened.body).toMatchObject({ status: 'OPEN', version: 5, resolvedAt: null });
      expect(reopened.body.acknowledgedAt).toBe(ack.body.acknowledgedAt);
    });

    it('requires a reason to resolve and to reopen', async () => {
      const incident = await newIncident();
      await act(incident.id, 'acknowledge', { expectedVersion: 1 });
      await act(incident.id, 'investigate', { expectedVersion: 2 });
      const res = await act(incident.id, 'resolve', { expectedVersion: 3 });
      expect(res.status).toBe(422);
    });

    it('rejects transitions the state machine does not allow with 409', async () => {
      const incident = await newIncident();
      const res = await act(incident.id, 'investigate', { expectedVersion: 1 });
      expect(res.status).toBe(409);
      expect(res.body.details.reason).toBe('INVALID_TRANSITION');
    });

    it('lets only an Org Admin resolve straight from ACKNOWLEDGED', async () => {
      const incident = await newIncident();
      await act(incident.id, 'acknowledge', { expectedVersion: 1 });

      const operator = await act(incident.id, 'resolve', {
        reason: 'Skipping investigation',
        expectedVersion: 2,
      });
      expect(operator.status).toBe(409);

      const admin = await act(
        incident.id,
        'resolve',
        { reason: 'False alarm, documented exception', expectedVersion: 2 },
        'ORG_ADMIN',
      );
      expect(admin.status).toBe(200);
      expect(admin.body.status).toBe('RESOLVED');
    });

    it('freezes edits and assignment while resolved', async () => {
      const incident = await newIncident();
      await act(incident.id, 'acknowledge', { expectedVersion: 1 });
      await act(
        incident.id,
        'resolve',
        { reason: 'Admin exception', expectedVersion: 2 },
        'ORG_ADMIN',
      );
      const res = await http
        .patch(`${base}/${incident.id}`)
        .set(as('OPERATOR'))
        .send({ title: 'Too late to edit', expectedVersion: 3 });
      expect(res.status).toBe(409);
    });
  });

  describe('concurrency (FR-INC-009, BR-010)', () => {
    it('answers 409 with the latest incident when the version is stale', async () => {
      const incident = await newIncident();
      await act(incident.id, 'acknowledge', { expectedVersion: 1 });

      const stale = await http
        .patch(`${base}/${incident.id}`)
        .set(as('ORG_ADMIN'))
        .send({ title: '[test] Edited from a stale view', expectedVersion: 1 });
      expect(stale.status).toBe(409);
      expect(stale.body.details.reason).toBe('VERSION_CONFLICT');
      expect(stale.body.details.current).toMatchObject({ id: incident.id, version: 2 });
    });

    it('lets exactly one of two simultaneous writers win', async () => {
      const incident = await newIncident();
      const results = await Promise.all([
        act(incident.id, 'acknowledge', { expectedVersion: 1 }),
        act(incident.id, 'acknowledge', { expectedVersion: 1 }, 'ORG_ADMIN'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const final = await http.get(`${base}/${incident.id}`).set(as('VIEWER'));
      expect(final.body.version).toBe(2);
    });
  });

  describe('assignment', () => {
    it('assigns, reassigns and unassigns, rejecting members who cannot handle incidents', async () => {
      const incident = await newIncident();

      const toAdmin = await act(incident.id, 'assign', {
        assigneeId: userId.ORG_ADMIN,
        expectedVersion: 1,
      });
      expect(toAdmin.status).toBe(200);
      expect(toAdmin.body.assignee).toMatchObject({ userId: userId.ORG_ADMIN });
      expect(toAdmin.body.version).toBe(2);

      const toViewer = await act(incident.id, 'assign', {
        assigneeId: userId.VIEWER,
        expectedVersion: 2,
      });
      expect(toViewer.status).toBe(422);

      const same = await act(incident.id, 'assign', {
        assigneeId: userId.ORG_ADMIN,
        expectedVersion: 2,
      });
      expect(same.body.version).toBe(2); // no-op: no version bump

      const cleared = await act(incident.id, 'assign', { assigneeId: null, expectedVersion: 2 });
      expect(cleared.body).toMatchObject({ assignee: null, version: 3 });
    });
  });

  describe('history (FR-INC-011)', () => {
    it('records every change on the timeline, the audit log and the outbox', async () => {
      const incident = await newIncident();
      await act(incident.id, 'acknowledge', { expectedVersion: 1 });
      await act(incident.id, 'assign', { assigneeId: userId.OPERATOR, expectedVersion: 2 });

      const res = await http.get(`${base}/${incident.id}/events`).set(as('VIEWER'));
      expect(res.status).toBe(200);
      expect(res.body.map((e: { action: string }) => e.action)).toEqual([
        'created',
        'status.acknowledge',
        'assigned',
      ]);
      expect(res.body[1]).toMatchObject({
        actor: { userId: userId.OPERATOR },
        before: { status: 'OPEN' },
        after: { status: 'ACKNOWLEDGED' },
      });

      const audit = await prisma.auditLog.findMany({
        where: { entityId: incident.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit.map((a) => a.action)).toEqual([
        'incident.created',
        'incident.status.acknowledge',
        'incident.assigned',
      ]);
      expect(audit.every((a) => a.requestId)).toBe(true);

      const outbox = await prisma.eventOutbox.findMany({
        where: { aggregateId: incident.id },
        orderBy: { sequence: 'asc' },
      });
      expect(outbox.map((o) => o.eventType)).toEqual([
        'incident.created',
        'incident.status.changed',
        'incident.assigned',
      ]);
      const sequences = outbox.map((o) => Number(o.sequence));
      expect(sequences[1]).toBeGreaterThan(sequences[0]!);
      expect(sequences[2]).toBeGreaterThan(sequences[1]!);
    });

    it('stores the resolution reason', async () => {
      const incident = await newIncident();
      await act(incident.id, 'acknowledge', { expectedVersion: 1 });
      await act(
        incident.id,
        'resolve',
        { reason: 'Config reverted', expectedVersion: 2 },
        'ORG_ADMIN',
      );
      const events = await http.get(`${base}/${incident.id}/events`).set(as('VIEWER'));
      expect(events.body.at(-1).after).toMatchObject({
        status: 'RESOLVED',
        reason: 'Config reverted',
      });
    });
  });

  describe('assignees', () => {
    it('offers only active members who can handle incidents', async () => {
      const res = await http.get(`${base}/assignees`).set(as('VIEWER'));
      expect(res.status).toBe(200);
      const roles = new Set((res.body as { role: string }[]).map((m) => m.role));
      expect(roles).toEqual(new Set(['ORG_ADMIN', 'OPERATOR']));
      const ids = (res.body as { userId: string }[]).map((m) => m.userId);
      expect(ids).toContain(userId.OPERATOR);
      expect(ids).not.toContain(userId.VIEWER);
    });
  });

  describe('tenant isolation (TEST-E-005)', () => {
    it("hides another organization's incidents behind 404", async () => {
      const foreign = await prisma.incident.findFirstOrThrow({
        where: { organizationId: OTHER_ORG },
      });

      // Not a member of Acme at all.
      const outsider = await http
        .get(`/api/v1/organizations/${OTHER_ORG}/incidents/${foreign.id}`)
        .set(as('ANALYST'));
      expect(outsider.status).toBe(404);

      // A member of Demo guessing an Acme incident id through the Demo path.
      expect((await http.get(`${base}/${foreign.id}`).set(as('ORG_ADMIN'))).status).toBe(404);
      expect(
        (await act(foreign.id, 'acknowledge', { expectedVersion: 1 }, 'ORG_ADMIN')).status,
      ).toBe(404);
      expect((await http.get(`${base}/${foreign.id}/events`).set(as('ORG_ADMIN'))).status).toBe(
        404,
      );
    });

    it('never lists incidents from other organizations', async () => {
      const res = await http.get(base).query({ limit: 100 }).set(as('VIEWER'));
      const page = res.body as IncidentPage;
      expect(page.items.every((i) => i.organizationId === DEMO_ORG)).toBe(true);
    });
  });

  describe('listing (FR-INC-001/002)', () => {
    it('pages through thousands of incidents without gaps or duplicates', async () => {
      const seen = new Set<string>();
      let cursor: string | undefined;
      let total = 0;
      for (let i = 0; i < 4; i++) {
        const res = await http.get(base).query({ limit: 100, cursor }).set(as('VIEWER'));
        expect(res.status).toBe(200);
        const page = res.body as IncidentPage;
        total = page.total;
        for (const item of page.items) {
          expect(seen.has(item.id)).toBe(false);
          seen.add(item.id);
        }
        cursor = page.nextCursor ?? undefined;
        if (!cursor) break;
      }
      expect(seen.size).toBe(400);
      expect(total).toBeGreaterThanOrEqual(10_000);
    });

    it.each(['createdAt', '-createdAt', 'updatedAt', '-updatedAt', 'severity', '-severity'])(
      'keeps a stable order across pages when sorting by %s',
      async (sort) => {
        const items: Incident[] = [];
        let cursor: string | undefined;
        for (let i = 0; i < 3; i++) {
          const res = await http.get(base).query({ limit: 60, sort, cursor }).set(as('VIEWER'));
          expect(res.status).toBe(200);
          items.push(...(res.body as IncidentPage).items);
          cursor = (res.body as IncidentPage).nextCursor ?? undefined;
        }
        expect(new Set(items.map((i) => i.id)).size).toBe(items.length);

        const key = (i: Incident) =>
          sort.endsWith('everity')
            ? SEVERITIES.indexOf(i.severity)
            : Date.parse(sort.replace('-', '') === 'createdAt' ? i.createdAt : i.updatedAt);
        for (let i = 1; i < items.length; i++) {
          const prev = key(items[i - 1]!);
          const next = key(items[i]!);
          expect(sort.startsWith('-') ? prev >= next : prev <= next).toBe(true);
        }
      },
    );

    it('filters by status and severity and searches titles', async () => {
      const unique = await newIncident({
        title: '[test] Zebra stampede in dispatch',
        severity: 'SEV1',
      });

      const byFilter = await http
        .get(base)
        .query({ status: 'OPEN', severity: 'SEV1', limit: 100 })
        .set(as('VIEWER'));
      const items = (byFilter.body as IncidentPage).items;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => i.status === 'OPEN' && i.severity === 'SEV1')).toBe(true);

      const search = await http.get(base).query({ q: 'zebra stampede' }).set(as('VIEWER'));
      expect((search.body as IncidentPage).items.map((i) => i.id)).toContain(unique.id);
    });

    it('rejects malformed cursors and oversized pages', async () => {
      expect((await http.get(base).query({ cursor: 'garbage' }).set(as('VIEWER'))).status).toBe(
        422,
      );
      expect((await http.get(base).query({ limit: 1000 }).set(as('VIEWER'))).status).toBe(422);
    });
  });
});
