import { z } from 'zod';

import { ROLES } from './permissions.js';
import type { Permission, Role } from './permissions.js';

export const loginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const demoLoginRequestSchema = z.object({
  role: z.enum(ROLES),
});
export type DemoLoginRequest = z.infer<typeof demoLoginRequestSchema>;

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
}

export interface MembershipSummary {
  organizationId: string;
  organizationName: string;
  slug: string;
  timezone: string;
  role: Role;
  permissions: Permission[];
}

/** Response of `GET /api/v1/me`. */
export interface MeResponse {
  user: SessionUser;
  memberships: MembershipSummary[];
}
