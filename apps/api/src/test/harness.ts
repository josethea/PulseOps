import 'reflect-metadata';

import { Controller, Get } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Role } from '@pulseops/contracts';
import request from 'supertest';

import { AppModule } from '../app.module.js';
import { configureApp } from '../app.setup.js';
import { RequirePermission } from '../auth/decorators.js';
import { loadEnv } from '../config/env.js';

export const DEMO_ORG = 'org_demo';
export const OTHER_ORG = 'org_acme';
export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'pulseops-demo-123';

/** Org-scoped probes that exist only in tests, to exercise the permission guard directly. */
@Controller('organizations/:orgId/_probe')
class ProbeController {
  @Get('manage')
  @RequirePermission('member:manage')
  manage() {
    return { ok: true };
  }

  @Get('undeclared')
  undeclared() {
    return { ok: true };
  }
}

export async function createTestApp(): Promise<INestApplication> {
  const env = loadEnv();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [ProbeController],
  }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, env);
  await app.init();
  return app;
}

/** Signs in through the demo endpoint and returns the session cookie header value. */
export async function demoCookie(app: INestApplication, role: Role): Promise<string> {
  const res = await request(app.getHttpServer()).post('/api/v1/auth/demo').send({ role });
  if (res.status !== 200) throw new Error(`Demo login failed for ${role}: ${res.status}`);
  const cookies = res.headers['set-cookie'] as unknown as string[];
  const pair = cookies.find((c) => c.startsWith('pulseops_session='));
  if (!pair) throw new Error('No session cookie issued');
  return pair.split(';')[0]!;
}
