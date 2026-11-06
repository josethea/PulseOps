import type { INestApplication } from '@nestjs/common';
import { SOCKET_MESSAGES } from '@pulseops/contracts';
import type { ReadyMessage, RealtimeEnvelope, ResyncMessage } from '@pulseops/contracts';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service.js';
import { DEMO_ORG, OTHER_ORG, createTestApp, demoCookie } from '../test/harness.js';
import { OutboxPublisherService } from './outbox-publisher.service.js';
import { RealtimeGateway } from './realtime.gateway.js';

// Requires the seeded database: `pnpm db:seed`. Incidents created here are removed afterwards.
describe('realtime gateway', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let publisher: OutboxPublisherService;
  let gateway: RealtimeGateway;
  let url: string;
  let serviceId: string;
  let operator: string;
  const sockets: Socket[] = [];
  const incidents: string[] = [];
  const base = `/api/v1/organizations/${DEMO_ORG}`;

  const connect = (
    opts: { cookie?: string; org?: string; lastSeen?: number; origin?: string } = {},
  ): Socket => {
    const socket = io(`${url}/operations`, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: {
        ...(opts.cookie && { cookie: opts.cookie }),
        ...(opts.origin && { origin: opts.origin }),
      },
      auth: {
        organizationId: opts.org ?? DEMO_ORG,
        ...(opts.lastSeen !== undefined && { lastSeenSequence: opts.lastSeen }),
      },
    });
    sockets.push(socket);
    return socket;
  };

  const once = <T>(socket: Socket, name: string) =>
    new Promise<T>((resolve) => socket.once(name, (value: T) => resolve(value)));

  const refused = (socket: Socket) =>
    new Promise<string>((resolve) =>
      socket.once('connect_error', (e: Error) => resolve(e.message)),
    );

  const collect = (socket: Socket) => {
    const events: RealtimeEnvelope[] = [];
    socket.on(SOCKET_MESSAGES.event, (e: RealtimeEnvelope) => events.push(e));
    return events;
  };

  async function createIncident(): Promise<string> {
    const res = await http.post(`${base}/incidents`).set({ Cookie: operator }).send({
      title: '[test] realtime incident',
      description: 'Created by the realtime suite',
      serviceId,
      region: 'LIM',
      severity: 'SEV3',
    });
    expect(res.status).toBe(201);
    incidents.push(res.body.id);
    return res.body.id;
  }

  async function cursor(): Promise<number> {
    const res = await http.get(`${base}/realtime/cursor`).set({ Cookie: operator });
    return res.body.cursor;
  }

  const drain = async () => {
    while ((await publisher.publishPending()) > 0) {
      // flush earlier suites' backlog so it cannot leak into assertions
    }
  };

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    url = await app.getUrl();
    url = url.replace('[::1]', 'localhost');
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    publisher = app.get(OutboxPublisherService);
    gateway = app.get(RealtimeGateway);
    operator = await demoCookie(app, 'OPERATOR');
    serviceId = (await prisma.service.findFirstOrThrow({ where: { organizationId: DEMO_ORG } })).id;
    await drain();
  });

  afterEach(() => {
    for (const s of sockets.splice(0)) s.disconnect();
  });

  afterAll(async () => {
    await prisma.eventOutbox.deleteMany({ where: { aggregateId: { in: incidents } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: incidents } } });
    await prisma.incident.deleteMany({ where: { id: { in: incidents } } });
    await app.close();
  });

  describe('handshake', () => {
    it('refuses a connection without a session', async () => {
      expect(await refused(connect())).toBe('unauthenticated');
    });

    it('refuses a tenant the user does not belong to', async () => {
      // The ANALYST demo user belongs to the demo organization only.
      const cookie = await demoCookie(app, 'ANALYST');
      expect(await refused(connect({ cookie, org: OTHER_ORG }))).toBe('forbidden');
    });

    it('refuses a missing or unknown organization', async () => {
      expect(await refused(connect({ cookie: operator, org: 'org_nope' }))).toBe('forbidden');
    });

    it('refuses a page served from another origin', async () => {
      const socket = connect({ cookie: operator, origin: 'https://evil.example' });
      expect(await refused(socket)).toBe('forbidden_origin');
    });

    it('accepts a member and reports the current cursor', async () => {
      const expected = await cursor();
      const socket = connect({ cookie: operator });
      const ready = await once<ReadyMessage>(socket, SOCKET_MESSAGES.ready);
      expect(ready).toEqual({ organizationId: DEMO_ORG, cursor: expected, replayed: 0 });
    });
  });

  describe('live events', () => {
    it('delivers committed changes in order with envelope metadata and no free text', async () => {
      const socket = connect({ cookie: operator });
      const events = collect(socket);
      const ready = await once<ReadyMessage>(socket, SOCKET_MESSAGES.ready);

      const id = await createIncident();
      await http
        .post(`${base}/incidents/${id}/acknowledge`)
        .set({ Cookie: operator })
        .send({ expectedVersion: 1 });
      await publisher.publishPending();
      await expect.poll(() => events.length).toBe(2);

      expect(events.map((e) => e.type)).toEqual(['incident.created', 'incident.status.changed']);
      expect(events.map((e) => e.sequence)).toEqual([ready.cursor + 1, ready.cursor + 2]);
      expect(events[1]).toMatchObject({
        organizationId: DEMO_ORG,
        entityId: id,
        version: 2,
        payload: { status: 'ACKNOWLEDGED' },
      });
      expect(events[0]!.eventId).toBeTruthy();
      expect(JSON.stringify(events)).not.toContain('realtime incident');
    });

    it('does not publish the same event twice', async () => {
      const socket = connect({ cookie: operator });
      const events = collect(socket);
      await once(socket, SOCKET_MESSAGES.ready);
      await createIncident();
      await publisher.publishPending();
      await publisher.publishPending();
      await expect.poll(() => events.length).toBe(1);
      await new Promise((r) => setTimeout(r, 150));
      expect(events).toHaveLength(1);
    });
  });

  describe('recovery (UC-12)', () => {
    it('replays what was missed, in order, before reporting ready', async () => {
      const lastSeen = await cursor();
      await createIncident();
      await createIncident();

      const socket = connect({ cookie: operator, lastSeen });
      const events = collect(socket);
      const ready = await once<ReadyMessage>(socket, SOCKET_MESSAGES.ready);

      expect(events.map((e) => e.sequence)).toEqual([lastSeen + 1, lastSeen + 2]);
      expect(ready).toMatchObject({ cursor: lastSeen + 2, replayed: 2 });
    });

    it('sends nothing to replay when the client is already current', async () => {
      const lastSeen = await cursor();
      const socket = connect({ cookie: operator, lastSeen });
      const events = collect(socket);
      const ready = await once<ReadyMessage>(socket, SOCKET_MESSAGES.ready);
      expect(events).toHaveLength(0);
      expect(ready).toMatchObject({ cursor: lastSeen, replayed: 0 });
    });

    it('demands a resync when the cursor is ahead of the server', async () => {
      const lastSeen = (await cursor()) + 1000;
      const socket = connect({ cookie: operator, lastSeen });
      const resync = await once<ResyncMessage>(socket, SOCKET_MESSAGES.resync);
      expect(resync.reason).toBe('cursor_ahead');
    });

    it('demands a resync when retention already dropped part of the gap', async () => {
      const lastSeen = await cursor();
      await createIncident();
      await createIncident();
      // Retention removed the oldest of the two missed events.
      await prisma.eventOutbox.deleteMany({
        where: { organizationId: DEMO_ORG, sequence: BigInt(lastSeen + 1) },
      });
      const socket = connect({ cookie: operator, lastSeen });
      const resync = await once<ResyncMessage>(socket, SOCKET_MESSAGES.resync);
      expect(resync.reason).toBe('cursor_expired');
    });
  });

  describe('revocation', () => {
    it('disconnects a socket whose session ended', async () => {
      const cookie = await demoCookie(app, 'VIEWER');
      const socket = connect({ cookie });
      await once(socket, SOCKET_MESSAGES.ready);
      const closed = new Promise<string>((resolve) => socket.once('disconnect', resolve));

      await http.post('/api/v1/auth/logout').set({ Cookie: cookie });
      await gateway.revalidate();
      expect(await closed).toBe('io server disconnect');
    });
  });
});
