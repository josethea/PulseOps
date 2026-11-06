import { Controller, Get, NotFoundException, Param, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { permissionsFor } from '@pulseops/contracts';
import type { Request } from 'express';

import { RequirePermission } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Organizations the caller is an active member of. */
  @Get()
  async list(@Req() req: Request) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId: req.auth!.user.id, status: 'ACTIVE' },
      include: { organization: true },
      // Oldest membership first: the default organization until a switcher exists.
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      timezone: m.organization.timezone,
      role: m.role,
    }));
  }

  @Get(':orgId')
  @RequirePermission('dashboard:read')
  async get(@Param('orgId') orgId: string, @Req() req: Request) {
    const organization = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!organization) throw new NotFoundException('Organization not found');
    const role = req.membership!.role;
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      timezone: organization.timezone,
      role,
      permissions: permissionsFor(role),
    };
  }
}
