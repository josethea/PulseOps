import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { startScenarioSchema } from '@pulseops/contracts';
import type { StartScenarioRequest } from '@pulseops/contracts';
import type { Request } from 'express';

import { RequirePermission } from '../auth/decorators.js';
import { REQUEST_ID_HEADER } from '../common/request-id.middleware.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DemoService } from './demo.service.js';
import type { DemoActor } from './demo.service.js';

/** Stricter than the global limit: these actions are heavy and meant for a person, not a script (SEC-005). */
const SIMULATOR_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

function actorOf(req: Request): DemoActor {
  return { userId: req.auth!.user.id, requestId: req.header(REQUEST_ID_HEADER) };
}

@ApiTags('demo')
@Controller('organizations/:orgId/demo')
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Get('status')
  @RequirePermission('demo:simulate')
  status(@Param('orgId') orgId: string) {
    return this.demo.status(orgId);
  }

  @Post('scenarios')
  @Throttle(SIMULATOR_THROTTLE)
  @RequirePermission('demo:simulate')
  start(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(startScenarioSchema)) body: StartScenarioRequest,
    @Req() req: Request,
  ) {
    return this.demo.start(orgId, actorOf(req), body);
  }

  @Post('scenarios/:scenarioId/cancel')
  @HttpCode(200)
  @Throttle(SIMULATOR_THROTTLE)
  @RequirePermission('demo:simulate')
  cancel(
    @Param('orgId') orgId: string,
    @Param('scenarioId') scenarioId: string,
    @Req() req: Request,
  ) {
    return this.demo.cancel(orgId, scenarioId, actorOf(req));
  }

  @Post('reset')
  @HttpCode(200)
  @Throttle(SIMULATOR_THROTTLE)
  @RequirePermission('demo:reset')
  reset(@Param('orgId') orgId: string, @Req() req: Request) {
    return this.demo.reset(orgId, actorOf(req));
  }
}
