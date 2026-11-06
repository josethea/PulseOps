import { Controller, Get, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { permissionsFor } from '@pulseops/contracts';
import type { Request } from 'express';

import { PrismaService } from '../prisma/prisma.service.js';

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  /** The signed-in user and the organizations they belong to, with role-derived permissions. */
  @Get()
  async me(@Req() req: Request) {
    const user = req.auth!.user;
    const memberships = await this.prisma.membership.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      include: { organization: true },
      // Oldest membership first: the default organization until a switcher exists.
      orderBy: { createdAt: 'asc' },
    });

    return {
      user,
      memberships: memberships.map((m) => ({
        organizationId: m.organizationId,
        organizationName: m.organization.name,
        slug: m.organization.slug,
        timezone: m.organization.timezone,
        role: m.role,
        permissions: permissionsFor(m.role),
      })),
    };
  }
}
