import { Injectable, NotFoundException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Tenant isolation: for any route under `:orgId`, the caller must hold an active
 * membership in that organization. The tenant is never taken on trust from the client;
 * a non-member gets 404 so tenant existence is not revealed.
 */
@Injectable()
export class OrgAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const orgId = req.params.orgId;
    if (typeof orgId !== 'string' || !req.auth) return true;

    const membership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: req.auth.user.id } },
    });
    if (!membership || membership.status !== 'ACTIVE') {
      throw new NotFoundException('Organization not found');
    }

    req.membership = {
      id: membership.id,
      organizationId: membership.organizationId,
      role: membership.role,
    };
    return true;
  }
}
