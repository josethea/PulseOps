import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  alertListQuerySchema,
  createAlertRuleSchema,
  updateAlertRuleSchema,
} from '@pulseops/contracts';
import type {
  AlertListQuery,
  CreateAlertRuleRequest,
  UpdateAlertRuleRequest,
} from '@pulseops/contracts';
import type { Request } from 'express';

import { RequirePermission } from '../auth/decorators.js';
import { REQUEST_ID_HEADER } from '../common/request-id.middleware.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AlertsService } from './alerts.service.js';
import type { RuleActor } from './alerts.service.js';

const actorOf = (req: Request): RuleActor => ({
  userId: req.auth!.user.id,
  requestId: req.header(REQUEST_ID_HEADER),
});

@ApiTags('alerts')
@Controller('organizations/:orgId')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get('alert-rules')
  @RequirePermission('alert:read')
  listRules(@Param('orgId') orgId: string) {
    return this.alerts.listRules(orgId);
  }

  @Post('alert-rules')
  @RequirePermission('alert-rule:manage')
  createRule(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(createAlertRuleSchema)) body: CreateAlertRuleRequest,
    @Req() req: Request,
  ) {
    return this.alerts.createRule(orgId, actorOf(req), body);
  }

  @Patch('alert-rules/:ruleId')
  @RequirePermission('alert-rule:manage')
  updateRule(
    @Param('orgId') orgId: string,
    @Param('ruleId') ruleId: string,
    @Body(new ZodValidationPipe(updateAlertRuleSchema)) body: UpdateAlertRuleRequest,
    @Req() req: Request,
  ) {
    return this.alerts.updateRule(orgId, ruleId, actorOf(req), body);
  }

  @Get('alerts')
  @RequirePermission('alert:read')
  listAlerts(
    @Param('orgId') orgId: string,
    @Query(new ZodValidationPipe(alertListQuerySchema)) query: AlertListQuery,
  ) {
    return this.alerts.listAlerts(orgId, query);
  }
}
