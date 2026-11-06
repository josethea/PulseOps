import type { INestApplication } from '@nestjs/common';
import { REGIONS } from '@pulseops/contracts';
import type { DemoScenario, DemoStatus } from '@pulseops/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service.js';
import { buildMinuteRows, insertMetricAggregates } from '../seed/metrics-seed.js';
import { sampleAt, seriesSpec, toMinute } from '../seed/telemetry.js';
import { DEMO_ORG, OTHER_ORG, createTestApp, demoCookie } from '../test/harness.js';
import { DemoService } from './demo.service.js';
import { SimulatorService } from './simulator.service.js';

const MINUTE = 60_000;
const stamp = Date.now();

// Requires the seeded database: `pnpm db:seed`. Every test works in its own throwaway demo
// tenant, which is deleted afterwards, so the seeded tenants are never altered.
describe('demo simulator', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let demo: DemoService;
  let simulator: SimulatorService;
  const cookie: Record<string, string> = {};
  const orgs: string[] = [];
  const as = (role: string) => ({ Cookie: cookie[role]! });

  // A fixed minute boundary: telemetry in these tests is built relative to it.
  const base = new Date(Math.floor(Date.now() / MINUTE) * MINUTE);
  const minutesFrom = (date: Date, minutes: number) => new Date(date.getTime() + minutes * MINUTE);

  /** A demo tenant with one service, the four demo users and `seededMinutes` of telemetry ending at `until`. */
  async function createOrg(label: string, until = base, seededMinutes = 60) {
    const id = `org_simtest_${label}_${stamp}`;
    const serviceId = `svc_simtest_${label}_${stamp}`;
    orgs.push(id);
    await prisma.organization.create({
      data: {
        id,
        name: `[test] Simulator ${label}`,
        slug: `simtest-${label}-${stamp}`,
        timezone: 'UTC',
        isDemo: true,
        eventSequence: { create: {} },
        services: {
          create: { id: serviceId, name: 'checkout-api', slug: 'checkout-api', region: 'GLOBAL' },
        },
      },
    });
    await prisma.membership.createMany({
      data: [
        ['usr_admin', 'ORG_ADMIN'],
        ['usr_operator', 'OPERATOR'],
        ['usr_analyst', 'ANALYST'],
        ['usr_viewer', 'VIEWER'],
      ].map(([userId, role]) => ({
        id: `mem_${id}_${userId}`,
        organizationId: id,
        userId: userId!,
        role: role as 'ORG_ADMIN',
      })),
    });
    await insertMetricAggregates(
      prisma,
      buildMinuteRows(
        id,
        [{ id: serviceId, slug: 'checkout-api' }],
        toMinute(until) - seededMinutes,
        toMinute(until),
      ),
    );
    return { id, serviceId, url: `/api/v1/organizations/${id}/demo` };
  }

  const actorOf = async (role: string) => {
    const me = await http.get('/api/v1/me').set(as(role));
    return { userId: me.body.user.id as string };
  };

  const storedErrorRate = async (orgId: string, region: string, minute: number) =>
    (
      await prisma.metricAggregate.findFirstOrThrow({
        where: {
          organizationId: orgId,
          region,
          metricKey: 'error_rate',
          bucketSize: 'MINUTE',
          bucketStart: new Date(minute * MINUTE),
        },
      })
    ).avg;

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    demo = app.get(DemoService);
    simulator = app.get(SimulatorService);
    for (const role of ['ORG_ADMIN', 'OPERATOR', 'ANALYST', 'VIEWER'] as const) {
      cookie[role] = await demoCookie(app, role);
    }
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
    await app.close();
  });

  describe('access and limits', () => {
    it('lets every role start a simulation and read the status', async () => {
      const org = await createOrg('roles');
      for (const role of ['VIEWER', 'ANALYST', 'OPERATOR', 'ORG_ADMIN']) {
        const status = await http.get(`${org.url}/status`).set(as(role));
        expect(status.status).toBe(200);
        expect((status.body as DemoStatus).enabled).toBe(true);
      }
      const started = await http.post(`${org.url}/scenarios`).set(as('VIEWER')).send({});
      expect(started.status).toBe(201);
      expect(started.body).toMatchObject({
        kind: 'OUTAGE',
        status: 'RUNNING',
        region: 'LIM',
        serviceName: 'checkout-api',
        startedByName: 'Demo Viewer',
      });
    });

    it('refuses tenants that are not demo tenants', async () => {
      const status = await http
        .get(`/api/v1/organizations/${OTHER_ORG}/demo/status`)
        .set(as('OPERATOR'));
      expect(status.status).toBe(200);
      expect(status.body).toMatchObject({ enabled: false, reason: 'not_demo_tenant' });

      const start = await http
        .post(`/api/v1/organizations/${OTHER_ORG}/demo/scenarios`)
        .set(as('OPERATOR'))
        .send({});
      expect(start.status).toBe(403);
      expect(start.body.details.reason).toBe('not_demo_tenant');
      expect(await prisma.demoScenario.count({ where: { organizationId: OTHER_ORG } })).toBe(0);
    });

    it('validates the request and the target service', async () => {
      const org = await createOrg('validation');
      for (const body of [
        { durationMinutes: 4 },
        { durationMinutes: 31 },
        { kind: 'MELTDOWN' },
        { region: 'MIA' },
      ]) {
        const res = await http.post(`${org.url}/scenarios`).set(as('OPERATOR')).send(body);
        expect(res.status).toBe(422);
      }
      const unknown = await http
        .post(`${org.url}/scenarios`)
        .set(as('OPERATOR'))
        .send({ serviceId: 'svc_does_not_exist' });
      expect(unknown.status).toBe(404);
      expect(await prisma.demoScenario.count({ where: { organizationId: org.id } })).toBe(0);
    });

    it('runs one simulation at a time, even under concurrent starts', async () => {
      const org = await createOrg('single');
      const results = await Promise.all([
        http.post(`${org.url}/scenarios`).set(as('OPERATOR')).send({}),
        http.post(`${org.url}/scenarios`).set(as('ANALYST')).send({}),
        http.post(`${org.url}/scenarios`).set(as('ORG_ADMIN')).send({}),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      const conflict = results.find((r) => r.status === 409)!;
      expect(conflict.body.details.reason).toBe('SCENARIO_ACTIVE');
      expect(await prisma.demoScenario.count({ where: { organizationId: org.id } })).toBe(1);
    });

    it('cancels a running simulation and reports it in the status', async () => {
      const org = await createOrg('cancel');
      const started = await http.post(`${org.url}/scenarios`).set(as('ANALYST')).send({});
      const id = (started.body as DemoScenario).id;

      const cancelled = await http.post(`${org.url}/scenarios/${id}/cancel`).set(as('OPERATOR'));
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe('CANCELLED');

      const again = await http.post(`${org.url}/scenarios/${id}/cancel`).set(as('OPERATOR'));
      expect(again.body.status).toBe('CANCELLED');

      const status = (await http.get(`${org.url}/status`).set(as('VIEWER'))).body as DemoStatus;
      expect(status.active).toBeNull();
      expect(status.recent[0]).toMatchObject({ id, status: 'CANCELLED' });

      const foreign = await http.post(`${org.url}/scenarios/nope/cancel`).set(as('OPERATOR'));
      expect(foreign.status).toBe(404);
    });

    it('enforces the hourly quota, which cancelled simulations still count against', async () => {
      const org = await createOrg('quota');
      const limit = ((await http.get(`${org.url}/status`).set(as('OPERATOR'))).body as DemoStatus)
        .quota.limit;

      for (let i = 0; i < limit; i++) {
        const started = await http.post(`${org.url}/scenarios`).set(as('OPERATOR')).send({});
        expect(started.status).toBe(201);
        await http.post(`${org.url}/scenarios/${started.body.id}/cancel`).set(as('OPERATOR'));
      }
      const blocked = await http.post(`${org.url}/scenarios`).set(as('OPERATOR')).send({});
      expect(blocked.status).toBe(429);
      expect(blocked.body.details).toMatchObject({ reason: 'QUOTA_EXCEEDED', limit });
      expect(Date.parse(blocked.body.details.nextSlotAt)).toBeGreaterThan(Date.now());

      const status = (await http.get(`${org.url}/status`).set(as('OPERATOR'))).body as DemoStatus;
      expect(status.quota).toMatchObject({ limit, used: limit });
      expect(status.quota.nextSlotAt).not.toBeNull();
    });

    it('audits the simulation and announces it to connected clients', async () => {
      const org = await createOrg('audit');
      const started = await http.post(`${org.url}/scenarios`).set(as('OPERATOR')).send({});
      const id = started.body.id as string;
      await http.post(`${org.url}/scenarios/${id}/cancel`).set(as('OPERATOR'));

      const audit = await prisma.auditLog.findMany({
        where: { organizationId: org.id, entityId: id },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit.map((a) => a.action)).toEqual([
        'demo.scenario.started',
        'demo.scenario.finished',
      ]);
      expect(audit[0]!.actorId).toBe('usr_operator');

      const events = await prisma.eventOutbox.findMany({
        where: { organizationId: org.id },
        orderBy: { sequence: 'asc' },
      });
      expect(events.map((e) => e.eventType)).toEqual([
        'simulator.scenario.started',
        'simulator.scenario.finished',
      ]);
      expect(events.map((e) => Number(e.sequence))).toEqual([1, 2]);
    });
  });

  describe('telemetry', () => {
    it('raises errors on the targeted series only, for the minutes the simulation covers', async () => {
      const start = minutesFrom(base, -30);
      const org = await createOrg('telemetry', start);
      const actor = await actorOf('ANALYST');

      // Started 20 seconds into the minute, for 5 minutes.
      const scenario = await demo.start(
        org.id,
        actor,
        { kind: 'OUTAGE', region: 'LIM', durationMinutes: 5 },
        new Date(start.getTime() + 20_000),
      );

      // A running dev server may have advanced this tenant first, so only the outcome is asserted.
      await simulator.advance(org.id, minutesFrom(start, 8));
      expect((await simulator.advance(org.id, minutesFrom(start, 8))).minutes).toBe(0);

      const first = toMinute(start);
      for (let m = first; m < first + 8; m++) {
        const affected = m < first + 5;
        for (const region of REGIONS) {
          const spec = seriesSpec(org.serviceId, 'checkout-api', region);
          const expected = sampleAt(spec, m, affected && region === 'LIM' ? 'outage' : undefined);
          expect(await storedErrorRate(org.id, region, m)).toBe(expected.error_rate);
        }
        if (affected) expect(await storedErrorRate(org.id, 'LIM', m)).toBeGreaterThanOrEqual(20);
      }

      const closed = await prisma.demoScenario.findUniqueOrThrow({ where: { id: scenario.id } });
      expect(closed.status).toBe('FINISHED');
      const events = await prisma.eventOutbox.findMany({
        where: { organizationId: org.id, eventType: 'simulator.scenario.finished' },
      });
      expect(events).toHaveLength(1);
    });

    it('applies degraded and outage with different severity', async () => {
      const start = minutesFrom(base, -30);
      const org = await createOrg('degraded', start);
      const actor = await actorOf('ANALYST');
      await demo.start(
        org.id,
        actor,
        { kind: 'DEGRADED', region: 'AQP', durationMinutes: 5 },
        start,
      );
      await simulator.advance(org.id, minutesFrom(start, 5));
      const rate = await storedErrorRate(org.id, 'AQP', toMinute(start) + 2);
      expect(rate).toBeGreaterThanOrEqual(3);
      expect(rate).toBeLessThanOrEqual(8);
    });

    it('stops affecting telemetry once a simulation is cancelled', async () => {
      const start = minutesFrom(base, -30);
      const org = await createOrg('early', start);
      const actor = await actorOf('ANALYST');
      const scenario = await demo.start(
        org.id,
        actor,
        { kind: 'OUTAGE', region: 'LIM', durationMinutes: 10 },
        start,
      );
      // Cancelled two and a half minutes in: only the first two whole minutes are affected.
      await demo.cancel(org.id, scenario.id, actor, new Date(start.getTime() + 150_000));
      await simulator.advance(org.id, minutesFrom(start, 6));

      const first = toMinute(start);
      for (let m = first; m < first + 6; m++) {
        const spec = seriesSpec(org.serviceId, 'checkout-api', 'LIM');
        const expected = sampleAt(spec, m, m < first + 2 ? 'outage' : undefined);
        expect(await storedErrorRate(org.id, 'LIM', m)).toBe(expected.error_rate);
      }
    });

    it('treats a simulation that ran out of time as finished in the status', async () => {
      const org = await createOrg('expired');
      const actor = await actorOf('ANALYST');
      const scenario = await demo.start(
        org.id,
        actor,
        { kind: 'OUTAGE', region: 'LIM', durationMinutes: 5 },
        minutesFrom(new Date(), -10),
      );
      const status = (await http.get(`${org.url}/status`).set(as('OPERATOR'))).body as DemoStatus;
      expect(status.active).toBeNull();
      expect(status.recent[0]).toMatchObject({ id: scenario.id, status: 'FINISHED' });

      // ...and a new one can start straight away.
      const next = await http.post(`${org.url}/scenarios`).set(as('OPERATOR')).send({});
      expect(next.status).toBe(201);
    });
  });

  describe('reset', () => {
    it('restores the tenant to its initial state without touching other tenants', async () => {
      const start = minutesFrom(base, -30);
      const org = await createOrg('reset', start);
      const actor = await actorOf('OPERATOR');

      // Dirty the tenant: an incident, a simulation with altered telemetry, a rule, a notification.
      const created = await http
        .post(`/api/v1/organizations/${org.id}/incidents`)
        .set(as('OPERATOR'))
        .send({
          title: '[test] Created during the demo',
          serviceId: org.serviceId,
          region: 'LIM',
          severity: 'SEV2',
        });
      expect(created.status).toBe(201);
      await demo.start(org.id, actor, { kind: 'OUTAGE', region: 'LIM', durationMinutes: 5 }, start);
      await simulator.advance(org.id, minutesFrom(start, 6));
      expect(await storedErrorRate(org.id, 'LIM', toMinute(start) + 1)).toBeGreaterThanOrEqual(20);

      const otherIncidents = await prisma.incident.count({ where: { organizationId: DEMO_ORG } });
      const otherRules = await prisma.alertRule.count({ where: { organizationId: DEMO_ORG } });

      // Viewers and analysts cannot reset.
      for (const role of ['VIEWER', 'ANALYST']) {
        expect((await http.post(`${org.url}/reset`).set(as(role))).status).toBe(403);
      }
      const res = await http.post(`${org.url}/reset`).set(as('OPERATOR'));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ incidents: 10_000, alertRules: 4 });

      expect(await prisma.incident.count({ where: { organizationId: org.id } })).toBe(10_000);
      expect(
        await prisma.incident.count({
          where: { organizationId: org.id, title: '[test] Created during the demo' },
        }),
      ).toBe(0);
      expect(await prisma.alertRule.count({ where: { organizationId: org.id } })).toBe(4);
      expect(await prisma.demoScenario.count({ where: { organizationId: org.id } })).toBe(0);
      expect(await prisma.notification.count({ where: { organizationId: org.id } })).toBe(0);

      // Telemetry altered by the simulation is back to the deterministic baseline.
      const first = toMinute(start);
      for (let m = first; m < first + 6; m++) {
        const spec = seriesSpec(org.serviceId, 'checkout-api', 'LIM');
        expect(await storedErrorRate(org.id, 'LIM', m)).toBe(sampleAt(spec, m).error_rate);
      }

      // The trail keeps a single entry for the reset itself, and clients are told to refetch.
      const audit = await prisma.auditLog.findMany({ where: { organizationId: org.id } });
      expect(audit.map((a) => a.action)).toEqual(['demo.reset']);
      const last = await prisma.eventOutbox.findFirstOrThrow({
        where: { organizationId: org.id },
        orderBy: { sequence: 'desc' },
      });
      expect(last.eventType).toBe('simulator.reset');

      // Other tenants are untouched.
      expect(await prisma.incident.count({ where: { organizationId: DEMO_ORG } })).toBe(
        otherIncidents,
      );
      expect(await prisma.alertRule.count({ where: { organizationId: DEMO_ORG } })).toBe(
        otherRules,
      );

      // Resetting again straight away is refused until the cooldown passes.
      const again = await http.post(`${org.url}/reset`).set(as('ORG_ADMIN'));
      expect(again.status).toBe(429);
      expect(again.body.details.reason).toBe('RESET_COOLDOWN');
    }, 60_000);

    it('reproduces the same backlog every time', async () => {
      const org = await createOrg('repeat');
      const actor = await actorOf('OPERATOR');
      const snapshot = async () =>
        (
          await prisma.incident.findMany({
            where: { organizationId: org.id },
            orderBy: { id: 'asc' },
            select: {
              id: true,
              title: true,
              severity: true,
              status: true,
              assigneeId: true,
              region: true,
            },
            take: 200,
          })
        ).map((i) => JSON.stringify(i));

      await demo.reset(org.id, actor, minutesFrom(new Date(), -5));
      const first = await snapshot();
      await demo.reset(org.id, actor, new Date());
      expect(await snapshot()).toEqual(first);
    }, 60_000);

    it('refuses to reset a tenant that is not a demo tenant, before deleting anything', async () => {
      const before = await prisma.incident.count({ where: { organizationId: OTHER_ORG } });
      await expect(demo.reset(OTHER_ORG, await actorOf('OPERATOR'))).rejects.toThrow(
        /only available in the demo tenant/,
      );
      expect(await prisma.incident.count({ where: { organizationId: OTHER_ORG } })).toBe(before);
    });
  });
});
