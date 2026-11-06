import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { originCheck } from './common/origin-check.middleware.js';
import { EnvIoAdapter } from './realtime/io.adapter.js';
import { requestIdMiddleware } from './common/request-id.middleware.js';
import type { Env } from './config/env.js';

/**
 * Middleware, filters and routing shared by the real server and the integration tests,
 * so tests exercise the same request pipeline as production.
 */
export function configureApp(app: INestApplication, env: Env) {
  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(cookieParser());
  app.use(originCheck(env.WEB_ORIGIN));
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.useWebSocketAdapter(new EnvIoAdapter(app, env));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
}
