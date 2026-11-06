import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@pulseops/contracts';

export const IS_PUBLIC_KEY = 'isPublic';
/** Opts a route out of session authentication. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSION_KEY = 'requiredPermission';
/**
 * Declares the permission a route needs. Routes under `:orgId` must declare one: the
 * permissions guard fails closed when it is missing.
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);
