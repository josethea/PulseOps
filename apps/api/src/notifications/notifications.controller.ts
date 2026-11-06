import { Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { notificationListQuerySchema } from '@pulseops/contracts';
import type { NotificationListQuery } from '@pulseops/contracts';
import type { Request } from 'express';

import { RequirePermission } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { NotificationsService } from './notifications.service.js';

/** Notifications are personal: every query is scoped to the caller, whatever the role. */
@ApiTags('notifications')
@Controller('organizations/:orgId/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermission('notification:read')
  list(
    @Param('orgId') orgId: string,
    @Query(new ZodValidationPipe(notificationListQuerySchema)) query: NotificationListQuery,
    @Req() req: Request,
  ) {
    return this.notifications.list(orgId, req.auth!.user.id, query);
  }

  // Declared before `:id/read` so "read-all" is never taken as an id.
  @Post('read-all')
  @HttpCode(200)
  @RequirePermission('notification:read')
  readAll(@Param('orgId') orgId: string, @Req() req: Request) {
    return this.notifications.markAllRead(orgId, req.auth!.user.id);
  }

  @Post(':id/read')
  @HttpCode(200)
  @RequirePermission('notification:read')
  read(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: Request) {
    return this.notifications.markRead(orgId, req.auth!.user.id, id);
  }
}
