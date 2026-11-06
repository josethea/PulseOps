import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  assignIncidentSchema,
  createIncidentSchema,
  incidentListQuerySchema,
  reasonedTransitionSchema,
  transitionIncidentSchema,
  updateIncidentSchema,
} from '@pulseops/contracts';
import type {
  AssignIncidentRequest,
  CreateIncidentRequest,
  IncidentListQuery,
  ReasonedTransitionRequest,
  TransitionIncidentRequest,
  UpdateIncidentRequest,
} from '@pulseops/contracts';
import type { Request } from 'express';

import { RequirePermission } from '../auth/decorators.js';
import { REQUEST_ID_HEADER } from '../common/request-id.middleware.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { IncidentsService } from './incidents.service.js';
import type { Actor } from './incidents.service.js';

/** Built from the guard-verified session and membership, never from the request body. */
function actorOf(req: Request): Actor {
  return {
    userId: req.auth!.user.id,
    role: req.membership!.role,
    requestId: req.header(REQUEST_ID_HEADER),
  };
}

@ApiTags('incidents')
@Controller('organizations/:orgId/incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  @RequirePermission('incident:read')
  list(
    @Param('orgId') orgId: string,
    @Query(new ZodValidationPipe(incidentListQuerySchema)) query: IncidentListQuery,
  ) {
    return this.incidents.list(orgId, query);
  }

  @Post()
  @RequirePermission('incident:create')
  create(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(createIncidentSchema)) body: CreateIncidentRequest,
    @Req() req: Request,
  ) {
    return this.incidents.create(orgId, actorOf(req), body);
  }

  // Declared before `:incidentId` so "assignees" is not read as an incident id.
  @Get('assignees')
  @RequirePermission('incident:read')
  assignees(@Param('orgId') orgId: string) {
    return this.incidents.assignees(orgId);
  }

  @Get(':incidentId')
  @RequirePermission('incident:read')
  get(@Param('orgId') orgId: string, @Param('incidentId') incidentId: string) {
    return this.incidents.get(orgId, incidentId);
  }

  @Get(':incidentId/events')
  @RequirePermission('incident:read')
  events(@Param('orgId') orgId: string, @Param('incidentId') incidentId: string) {
    return this.incidents.events(orgId, incidentId);
  }

  @Patch(':incidentId')
  @RequirePermission('incident:update')
  update(
    @Param('orgId') orgId: string,
    @Param('incidentId') incidentId: string,
    @Body(new ZodValidationPipe(updateIncidentSchema)) body: UpdateIncidentRequest,
    @Req() req: Request,
  ) {
    return this.incidents.update(orgId, incidentId, actorOf(req), body);
  }

  @Post(':incidentId/assign')
  @HttpCode(200)
  @RequirePermission('incident:update')
  assign(
    @Param('orgId') orgId: string,
    @Param('incidentId') incidentId: string,
    @Body(new ZodValidationPipe(assignIncidentSchema)) body: AssignIncidentRequest,
    @Req() req: Request,
  ) {
    return this.incidents.assign(orgId, incidentId, actorOf(req), body);
  }

  @Post(':incidentId/acknowledge')
  @HttpCode(200)
  @RequirePermission('incident:update')
  acknowledge(
    @Param('orgId') orgId: string,
    @Param('incidentId') incidentId: string,
    @Body(new ZodValidationPipe(transitionIncidentSchema)) body: TransitionIncidentRequest,
    @Req() req: Request,
  ) {
    return this.incidents.transition(
      orgId,
      incidentId,
      actorOf(req),
      'acknowledge',
      body.expectedVersion,
    );
  }

  @Post(':incidentId/investigate')
  @HttpCode(200)
  @RequirePermission('incident:update')
  investigate(
    @Param('orgId') orgId: string,
    @Param('incidentId') incidentId: string,
    @Body(new ZodValidationPipe(transitionIncidentSchema)) body: TransitionIncidentRequest,
    @Req() req: Request,
  ) {
    return this.incidents.transition(
      orgId,
      incidentId,
      actorOf(req),
      'investigate',
      body.expectedVersion,
    );
  }

  @Post(':incidentId/resolve')
  @HttpCode(200)
  @RequirePermission('incident:update')
  resolve(
    @Param('orgId') orgId: string,
    @Param('incidentId') incidentId: string,
    @Body(new ZodValidationPipe(reasonedTransitionSchema)) body: ReasonedTransitionRequest,
    @Req() req: Request,
  ) {
    return this.incidents.transition(
      orgId,
      incidentId,
      actorOf(req),
      'resolve',
      body.expectedVersion,
      body.reason,
    );
  }

  @Post(':incidentId/reopen')
  @HttpCode(200)
  @RequirePermission('incident:update')
  reopen(
    @Param('orgId') orgId: string,
    @Param('incidentId') incidentId: string,
    @Body(new ZodValidationPipe(reasonedTransitionSchema)) body: ReasonedTransitionRequest,
    @Req() req: Request,
  ) {
    return this.incidents.transition(
      orgId,
      incidentId,
      actorOf(req),
      'reopen',
      body.expectedVersion,
      body.reason,
    );
  }
}
