import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AlertEvaluatorService } from './alerts/alert-evaluator.service.js';
import { AlertsController } from './alerts/alerts.controller.js';
import { AlertsService } from './alerts/alerts.service.js';
import { AuthController } from './auth/auth.controller.js';
import { OrgAccessGuard } from './auth/org-access.guard.js';
import { PermissionsGuard } from './auth/permissions.guard.js';
import { SessionGuard } from './auth/session.guard.js';
import { SessionService } from './auth/session.service.js';
import { EnvModule } from './config/env.module.js';
import { HealthController } from './health/health.controller.js';
import { IncidentsController } from './incidents/incidents.controller.js';
import { IncidentsService } from './incidents/incidents.service.js';
import { MeController } from './me/me.controller.js';
import { NotificationsController } from './notifications/notifications.controller.js';
import { NotificationsService } from './notifications/notifications.service.js';
import { OrganizationsController } from './organizations/organizations.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { OutboxPublisherService } from './realtime/outbox-publisher.service.js';
import { OutboxService } from './realtime/outbox.service.js';
import { RealtimeController } from './realtime/realtime.controller.js';
import { RealtimeGateway } from './realtime/realtime.gateway.js';
import { DemoController } from './simulator/demo.controller.js';
import { DemoService } from './simulator/demo.service.js';
import { SimulatorService } from './simulator/simulator.service.js';
import { TelemetryController } from './telemetry/telemetry.controller.js';
import { TelemetryService } from './telemetry/telemetry.service.js';

@Module({
  imports: [EnvModule, PrismaModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }])],
  controllers: [
    HealthController,
    AuthController,
    MeController,
    OrganizationsController,
    TelemetryController,
    IncidentsController,
    AlertsController,
    NotificationsController,
    RealtimeController,
    DemoController,
  ],
  providers: [
    SessionService,
    TelemetryService,
    IncidentsService,
    AlertsService,
    AlertEvaluatorService,
    NotificationsService,
    SimulatorService,
    DemoService,
    OutboxService,
    OutboxPublisherService,
    RealtimeGateway,
    // Guards run in registration order: throttle -> authenticate -> tenant -> permission.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: OrgAccessGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
