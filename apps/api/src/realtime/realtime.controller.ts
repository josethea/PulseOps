import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { RealtimeCursor } from '@pulseops/contracts';

import { RequirePermission } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';

@ApiTags('realtime')
@Controller('organizations/:orgId/realtime')
export class RealtimeController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The cursor to pair with a snapshot: read it before fetching snapshots, then connect
   * with it so anything that changes in between is replayed rather than lost (spec 11.4).
   */
  @Get('cursor')
  @RequirePermission('dashboard:read')
  async cursor(@Param('orgId') orgId: string): Promise<RealtimeCursor> {
    const counter = await this.prisma.eventSequence.findUnique({
      where: { organizationId: orgId },
    });
    return { cursor: Number(counter?.lastSequence ?? 0n) };
  }
}
