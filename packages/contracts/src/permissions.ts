/**
 * Central RBAC definition (spec section 12). The API enforces it on every endpoint;
 * the web app only uses it to hide controls the user could not use anyway.
 */
export const ROLES = ['ORG_ADMIN', 'OPERATOR', 'ANALYST', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'dashboard:read',
  'incident:read',
  'incident:create',
  'incident:update',
  'alert:read',
  'alert-rule:manage',
  'notification:read',
  'audit:read',
  'member:manage',
  'report:export',
  'demo:simulate',
  'demo:reset',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: readonly Permission[] = [
  'dashboard:read',
  'incident:read',
  'alert:read',
  'notification:read',
  'demo:simulate',
];
const ANALYST: readonly Permission[] = [...VIEWER, 'report:export'];
const OPERATOR: readonly Permission[] = [
  ...ANALYST,
  'incident:create',
  'incident:update',
  'demo:reset',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  VIEWER,
  ANALYST,
  OPERATOR,
  ORG_ADMIN: PERMISSIONS,
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}
