import type { INestApplication } from '@nestjs/common';
import type { Alert, AlertPage, AlertRule, NotificationPage } from '@pulseops/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service.js';
import { DEMO_ORG, OTHER_ORG, createTestApp, demoCookie } from '../test/harness.js';
import { AlertEvaluatorService } from './alert-evaluator.service.js';

const MINUTE = 60_000;

// Requires the seeded database: `pnpm db:seed`. Everything created here is removed afterwards.
describe('alert rules, evaluation and notifications', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let evaluator: AlertEvaluatorService;
  let serviceId: string;
  const cookie: Record<string, string> = {};
  const base = `/api/v1/organizations/${DEMO_ORG}`;
  const as = (role: string) => ({ Cookie: cookie[role]! });
  const ruleIds: string[] = [];

  // A fixed "now" on a minute boundary, so windows are exactly the minutes seeded below.
  const now = new Date(Math.floor(Date.now() / MINUTE) * MINUTE);
  const at = (base: Date, minutesFromNow: number) =>
    new Date(base.getTime() + minutesFromNow * MINUTE);

  /** One value per minute for the minutes ending at `end`, oldest first. */
  async function feed(service: string, end: Date, values: number[]) {
    await prisma.metricAggregate.createMany({
      data: values.map((value, i) => ({
        organizationId: DEMO_ORG,
        serviceId: service,
        region: 'LIM',
        metricKey: 'error_rate',
        bucketStart: at(end, i - values.length),
        bucketSize: 'MINUTE' as const,
        min: value,
        max: value,
        avg: value,
        count: 10,
        p95: value,
      })),
      skipDuplicates: true,
    });
  }

  async function newRule(overrides: Record<string, unknown> = {}): Promise<AlertRule> {
    const res = await http
      .post(`${base}/alert-rules`)
      .set(as('ORG_ADMIN'))
      .send({
        name: '[test] Error rate high',
        serviceId,
        metricKey: 'error_rate',
        operator: 'GT',
        threshold: 5,
        windowSeconds: 120,
        cooldownSeconds: 300,
        severity: 'SEV2',
        ...overrides,
      });
    expect(res.status).toBe(201);
    ruleIds.push(res.body.id);
    return res.body as AlertRule;
  }

  const occurrences = (ruleId: string) => prisma.alertOccurrence.findMany({ where: { ruleId } });

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    evaluator = app.get(AlertEvaluatorService);
    for (const role of ['ORG_ADMIN', 'OPERATOR', 'ANALYST', 'VIEWER'] as const) {
      cookie[role] = await demoCookie(app, role);
    }
    // A service of its own, so the seeded telemetry never interferes with these windows.
    const service = await prisma.service.create({
      data: {
        organizationId: DEMO_ORG,
        name: '[test] Alerts service',
        slug: `test-alerts-${Date.now()}`,
        region: 'LIM',
      },
    });
    serviceId = service.id;
  });

  afterAll(async () => {
    const occurrenceIds = (
      await prisma.alertOccurrence.findMany({ where: { serviceId }, select: { id: true } })
    ).map((o) => o.id);
    const notificationIds = (
      await prisma.notification.findMany({
        where: { referenceType: 'alert', referenceId: { in: occurrenceIds } },
        select: { id: true },
      })
    ).map((n) => n.id);
    const entityIds = [...occurrenceIds, ...notificationIds, ...ruleIds];
    await prisma.eventOutbox.deleteMany({ where: { aggregateId: { in: entityIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.notification.deleteMany({ where: { id: { in: notificationIds } } });
    await prisma.alertOccurrence.deleteMany({ where: { id: { in: occurrenceIds } } });
    await prisma.alertRule.deleteMany({ where: { id: { in: ruleIds } } });
    await prisma.metricAggregate.deleteMany({ where: { serviceId } });
    await prisma.service.delete({ where: { id: serviceId } });
    await app.close();
  });

  describe('rule management', () => {
    it('lets only admins create or change rules, and everyone read them', async () => {
      const body = {
        name: 'Nope',
        serviceId,
        metricKey: 'error_rate',
        operator: 'GT',
        threshold: 5,
        windowSeconds: 120,
        severity: 'SEV3',
      };
      for (const role of ['OPERATOR', 'ANALYST', 'VIEWER']) {
        expect((await http.post(`${base}/alert-rules`).set(as(role)).send(body)).status).toBe(403);
      }
      const rule = await newRule();
      expect(rule.version).toBe(1);
      expect(rule.serviceName).toBe('[test] Alerts service');
      for (const role of ['OPERATOR', 'VIEWER']) {
        const list = await http.get(`${base}/alert-rules`).set(as(role));
        expect(list.status).toBe(200);
        expect((list.body as AlertRule[]).some((r) => r.id === rule.id)).toBe(true);
      }
    });

    it('rejects contradictory configuration with field errors', async () => {
      const res = await http.post(`${base}/alert-rules`).set(as('ORG_ADMIN')).send({
        name: 'Bad',
        serviceId,
        metricKey: 'error_rate',
        operator: 'GT',
        threshold: 150,
        windowSeconds: 30,
        severity: 'SEV2',
      });
      expect(res.status).toBe(422);
      expect(Object.keys(res.body.details.fieldErrors)).toEqual(
        expect.arrayContaining(['windowSeconds']),
      );
    });

    it('rejects a service from another organization', async () => {
      const foreign = await prisma.service.findFirstOrThrow({
        where: { organizationId: OTHER_ORG },
      });
      const res = await http.post(`${base}/alert-rules`).set(as('ORG_ADMIN')).send({
        name: 'Cross tenant',
        serviceId: foreign.id,
        metricKey: 'error_rate',
        operator: 'GT',
        threshold: 5,
        windowSeconds: 120,
        severity: 'SEV2',
      });
      expect(res.status).toBe(422);
      expect(res.body.details.fieldErrors.serviceId).toBeDefined();
    });

    it('updates with optimistic concurrency and returns the current rule on conflict', async () => {
      const rule = await newRule();
      const ok = await http
        .patch(`${base}/alert-rules/${rule.id}`)
        .set(as('ORG_ADMIN'))
        .send({ threshold: 8, expectedVersion: 1 });
      expect(ok.status).toBe(200);
      expect(ok.body.version).toBe(2);
      expect(ok.body.threshold).toBe(8);

      const stale = await http
        .patch(`${base}/alert-rules/${rule.id}`)
        .set(as('ORG_ADMIN'))
        .send({ isEnabled: false, expectedVersion: 1 });
      expect(stale.status).toBe(409);
      expect(stale.body.details.reason).toBe('VERSION_CONFLICT');
      expect(stale.body.details.current.version).toBe(2);
    });

    it('audits rule changes and treats other tenants rules as not found', async () => {
      const rule = await newRule();
      const audit = await prisma.auditLog.findMany({
        where: { entityId: rule.id, entityType: 'alert-rule' },
      });
      expect(audit.map((a) => a.action)).toContain('alert.rule.created');
      const res = await http
        .patch(`/api/v1/organizations/${OTHER_ORG}/alert-rules/${rule.id}`)
        .set(as('ORG_ADMIN'))
        .send({ threshold: 9, expectedVersion: 1 });
      expect(res.status).toBe(404);
    });
  });

  describe('evaluation (BR-008, BR-009)', () => {
    it('does not judge a window that data does not fully cover', async () => {
      const rule = await newRule();
      await feed(serviceId, now, [20]); // only 1 of the 2 required minutes
      expect(await evaluator.evaluateRule(DEMO_ORG, rule.id, now)).toBe('no-data');
      expect(await occurrences(rule.id)).toHaveLength(0);
    });

    it('stays quiet while the window mean is under the threshold', async () => {
      const rule = await newRule({ threshold: 50 });
      await feed(serviceId, now, [20, 20]);
      expect(await evaluator.evaluateRule(DEMO_ORG, rule.id, now)).toBe('ok');
    });

    it('fires once with timestamp, value and cause, and never again for the same episode', async () => {
      const t = at(now, 10);
      await feed(serviceId, t, [8, 12]); // mean 10 > 5
      const rule = await newRule({ name: '[test] fires once' });

      expect(await evaluator.evaluateRule(DEMO_ORG, rule.id, t)).toBe('triggered');
      expect(await evaluator.evaluateRule(DEMO_ORG, rule.id, t)).toBe('firing');
      expect(await evaluator.evaluateRule(DEMO_ORG, rule.id, at(t, 0.5))).toBe('firing');

      const rows = await occurrences(rule.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ state: 'FIRING', observedValue: 10 });
      expect(rows[0]!.triggeredAt.getTime()).toBe(t.getTime());

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: rows[0]!.id, action: 'alert.triggered' },
      });
      expect(JSON.stringify(audit.changesJson)).toContain('averaged 10%');

      const event = await prisma.eventOutbox.findFirstOrThrow({
        where: { aggregateId: rows[0]!.id, eventType: 'alert.triggered' },
      });
      expect(event.sequence).toBeGreaterThan(0n);
    });

    it('creates a single episode when many evaluations run at once', async () => {
      const t = at(now, 20);
      await feed(serviceId, t, [30, 30]);
      const rule = await newRule({ name: '[test] concurrent' });

      const results = await Promise.all(
        Array.from({ length: 12 }, () => evaluator.evaluateRule(DEMO_ORG, rule.id, t)),
      );
      expect(results.filter((r) => r === 'triggered')).toHaveLength(1);
      expect(await occurrences(rule.id)).toHaveLength(1);
    });

    it('clears on recovery, then respects the cooldown before firing again', async () => {
      const t0 = at(now, 40);
      await feed(serviceId, t0, [9, 9]);
      const rule = await newRule({ name: '[test] cooldown', cooldownSeconds: 600 });
      expect(await evaluator.evaluateRule(DEMO_ORG, rule.id, t0)).toBe('triggered');

      const t1 = at(t0, 2);
      await feed(serviceId, t1, [1, 1]);
      expect(await evaluator.evaluateRule(DEMO_ORG, rule.id, t1)).toBe('cleared');

      // Violating again 4 minutes after the first firing: still inside the 10 minute cooldown.
      const t2 = at(t0, 4);
      await feed(serviceId, t2, [9, 9]);
      expect(await evaluator.evaluateRule(DEMO_ORG, rule.id, t2)).toBe('ok');
      expect(await occurrences(rule.id)).toHaveLength(1);

      // After the cooldown a new episode may open.
      const t3 = at(t0, 12);
      await feed(serviceId, t3, [9, 9]);
      expect(await evaluator.evaluateRule(DEMO_ORG, rule.id, t3)).toBe('triggered');
      const rows = await occurrences(rule.id);
      expect(rows.map((r) => r.state).sort()).toEqual(['CLEARED', 'FIRING']);
      const cleared = rows.find((r) => r.state === 'CLEARED')!;
      expect(cleared.clearedAt?.getTime()).toBe(t1.getTime());
    });

    it('closes an open episode when the rule is disabled', async () => {
      const t = at(now, 60);
      await feed(serviceId, t, [9, 9]);
      const rule = await newRule({ name: '[test] disable' });
      expect(await evaluator.evaluateRule(DEMO_ORG, rule.id, t)).toBe('triggered');

      const res = await http
        .patch(`${base}/alert-rules/${rule.id}`)
        .set(as('ORG_ADMIN'))
        .send({ isEnabled: false, expectedVersion: 1 });
      expect(res.status).toBe(200);
      expect(await evaluator.evaluateRule(DEMO_ORG, rule.id, t)).toBe('cleared');
      expect((await occurrences(rule.id))[0]!.state).toBe('CLEARED');
      expect(await evaluator.evaluateRule(DEMO_ORG, rule.id, t)).toBe('skipped');
    });

    it('lists alerts with filters and keyset pagination', async () => {
      const all = await http.get(`${base}/alerts?limit=2`).set(as('VIEWER'));
      expect(all.status).toBe(200);
      const page = all.body as AlertPage;
      expect(page.items.length).toBeLessThanOrEqual(2);
      expect(page.nextCursor).not.toBeNull();
      const next = await http
        .get(`${base}/alerts?limit=2&cursor=${page.nextCursor}`)
        .set(as('VIEWER'));
      const ids = new Set(page.items.map((a) => a.id));
      expect((next.body as AlertPage).items.every((a) => !ids.has(a.id))).toBe(true);

      const firing = await http.get(`${base}/alerts?state=FIRING&limit=100`).set(as('VIEWER'));
      expect((firing.body as AlertPage).items.every((a: Alert) => a.state === 'FIRING')).toBe(true);

      const bad = await http.get(`${base}/alerts?cursor=garbage`).set(as('VIEWER'));
      expect(bad.status).toBe(422);
    });
  });

  describe('notifications', () => {
    it('notifies responders only, privately, and tracks read state', async () => {
      const t = at(now, 80);
      await feed(serviceId, t, [15, 15]);
      const rule = await newRule({ name: '[test] notify' });
      await evaluator.evaluateRule(DEMO_ORG, rule.id, t);
      const [occurrence] = await occurrences(rule.id);

      const mine = async (role: string) =>
        (await http.get(`${base}/notifications?limit=100`).set(as(role))).body as NotificationPage;
      const hasAlert = (page: NotificationPage) =>
        page.items.find((n) => n.referenceId === occurrence!.id);

      const operator = await mine('OPERATOR');
      const found = hasAlert(operator)!;
      expect(found.type).toBe('ALERT');
      expect(found.title).toBe('[SEV2] [test] notify');
      expect(found.readAt).toBeNull();
      expect(hasAlert(await mine('ORG_ADMIN'))).toBeDefined();
      expect(hasAlert(await mine('VIEWER'))).toBeUndefined();
      expect(hasAlert(await mine('ANALYST'))).toBeUndefined();

      // Someone else's notification is simply not found.
      const foreign = await http
        .post(`${base}/notifications/${found.id}/read`)
        .set(as('ORG_ADMIN'));
      expect(foreign.status).toBe(404);

      const read = await http.post(`${base}/notifications/${found.id}/read`).set(as('OPERATOR'));
      expect(read.status).toBe(200);
      expect(read.body.readAt).not.toBeNull();
      const again = await http.post(`${base}/notifications/${found.id}/read`).set(as('OPERATOR'));
      expect(again.body.readAt).toBe(read.body.readAt);

      const after = await mine('OPERATOR');
      expect(after.unreadCount).toBe(operator.unreadCount - 1);
      const unread = await http.get(`${base}/notifications?unreadOnly=true`).set(as('OPERATOR'));
      expect((unread.body as NotificationPage).items.some((n) => n.id === found.id)).toBe(false);
    });

    it('requires a session', async () => {
      expect((await http.get(`${base}/notifications`)).status).toBe(401);
    });
  });
});
