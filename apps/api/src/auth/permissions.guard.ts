import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from '@pulseops/contracts';
import type { Permission } from '@pulseops/contracts';
import type { Request } from 'express';

import { PERMISSION_KEY } from './decorators.js';

/** Enforces @RequirePermission() against the caller's role in the route's organization. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const required = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Fail closed: an organization-scoped route without a declared permission is denied.
    if (!required) {
      if (req.membership) throw new ForbiddenException('Route does not declare a permission');
      return true;
    }
    if (!req.membership || !hasPermission(req.membership.role, required)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
