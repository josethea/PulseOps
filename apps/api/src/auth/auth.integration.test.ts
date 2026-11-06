import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service.js';
import { DEMO_ORG, OTHER_ORG, SEED_PASSWORD, createTestApp, demoCookie } from '../test/harness.js';

// Requires the seeded database: `pnpm db:seed`.
describe('authentication and authorization', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());
    for (const role of ['ORG_ADMIN', 'OPERATOR', 'ANALYST', 'VIEWER'] as const) {
      cookies[role] = await demoCookie(app, role);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('sessions', () => {
    it('rejects requests without a session', async () => {
      const res = await http.get('/api/v1/me');
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: expect.any(String), requestId: expect.any(String) });
    });

    it('rejects a forged session token', async () => {
      const res = await http.get('/api/v1/me').set('Cookie', 'pulseops_session=not-a-real-token');
      expect(res.status).toBe(401);
    });

    it('returns the signed-in user and never exposes the password hash', async () => {
      const res = await http.get('/api/v1/me').set('Cookie', cookies.VIEWER!);
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|scrypt/i);
    });

    it('issues an HttpOnly, SameSite=Lax session cookie', async () => {
      const res = await http.post('/api/v1/auth/demo').send({ role: 'VIEWER' });
      const header = (res.headers['set-cookie'] as unknown as string[]).join(';');
      expect(header).toMatch(/HttpOnly/i);
      expect(header).toMatch(/SameSite=Lax/i);
    });

    it('invalidates the session on logout', async () => {
      const cookie = await demoCookie(app, 'ANALYST');
      expect((await http.get('/api/v1/me').set('Cookie', cookie)).status).toBe(200);
      expect((await http.post('/api/v1/auth/logout').set('Cookie', cookie)).status).toBe(204);
      expect((await http.get('/api/v1/me').set('Cookie', cookie)).status).toBe(401);
    });
  });

  describe('password login', () => {
    it('signs in with valid credentials', async () => {
      const res = await http
        .post('/api/v1/auth/login')
        .send({ email: 'Admin@demo.pulseops.test', password: SEED_PASSWORD });
      expect(res.status).toBe(200);
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('returns the same error for a wrong password and an unknown email', async () => {
      const wrong = await http
        .post('/api/v1/auth/login')
        .send({ email: 'admin@demo.pulseops.test', password: 'definitely-wrong' });
      const unknown = await http
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@demo.pulseops.test', password: 'definitely-wrong' });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(unknown.body.message).toBe(wrong.body.message);
    });

    it('rejects malformed input with a 422', async () => {
      const res = await http.post('/api/v1/auth/login').send({ email: 'not-an-email' });
      expect(res.status).toBe(422);
    });
  });

  describe('CSRF origin check', () => {
    it('rejects unsafe requests from a foreign origin', async () => {
      const res = await http
        .post('/api/v1/auth/demo')
        .set('Origin', 'https://evil.example')
        .send({ role: 'VIEWER' });
      expect(res.status).toBe(403);
    });
  });

  describe('tenant isolation', () => {
    it('lets a member read their organization', async () => {
      const res = await http
        .get(`/api/v1/organizations/${DEMO_ORG}/services`)
        .set('Cookie', cookies.VIEWER!);
      expect(res.status).toBe(200);
    });

    it('answers 404 (not 403) for an organization the user does not belong to', async () => {
      const res = await http
        .get(`/api/v1/organizations/${OTHER_ORG}/services`)
        .set('Cookie', cookies.ANALYST!);
      expect(res.status).toBe(404);
    });

    it('answers 404 for an organization that does not exist, indistinguishable from the above', async () => {
      const res = await http
        .get('/api/v1/organizations/org_does_not_exist/services')
        .set('Cookie', cookies.ANALYST!);
      expect(res.status).toBe(404);
    });

    it("rejects another tenant's service ID used as a filter", async () => {
      const foreign = await app
        .get(PrismaService)
        .service.findFirstOrThrow({ where: { organizationId: OTHER_ORG } });

      // The Acme service exists, but must not be reachable through the demo organization.
      const res = await http
        .get(`/api/v1/organizations/${DEMO_ORG}/dashboard/snapshot`)
        .query({ service: foreign.id })
        .set('Cookie', cookies.ORG_ADMIN!);
      expect(res.status).toBe(404);
    });
  });

  describe('permissions', () => {
    it('allows a role that holds the permission', async () => {
      const res = await http
        .get(`/api/v1/organizations/${DEMO_ORG}/_probe/manage`)
        .set('Cookie', cookies.ORG_ADMIN!);
      expect(res.status).toBe(200);
    });

    it.each(['OPERATOR', 'ANALYST', 'VIEWER'])('denies %s a permission it lacks', async (role) => {
      const res = await http
        .get(`/api/v1/organizations/${DEMO_ORG}/_probe/manage`)
        .set('Cookie', cookies[role]!);
      expect(res.status).toBe(403);
    });

    it('fails closed on org-scoped routes that declare no permission', async () => {
      const res = await http
        .get(`/api/v1/organizations/${DEMO_ORG}/_probe/undeclared`)
        .set('Cookie', cookies.ORG_ADMIN!);
      expect(res.status).toBe(403);
    });
  });
});
