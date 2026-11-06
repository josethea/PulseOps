import { describe, expect, it } from 'vitest';

import { hasPermission, PERMISSIONS, ROLES } from './permissions.js';

describe('RBAC matrix (spec section 12)', () => {
  it('lets every role read the dashboard, incidents and alerts', () => {
    for (const role of ROLES) {
      expect(hasPermission(role, 'dashboard:read')).toBe(true);
      expect(hasPermission(role, 'incident:read')).toBe(true);
      expect(hasPermission(role, 'alert:read')).toBe(true);
    }
  });

  it('only lets operators and admins create or update incidents', () => {
    expect(hasPermission('VIEWER', 'incident:create')).toBe(false);
    expect(hasPermission('ANALYST', 'incident:update')).toBe(false);
    expect(hasPermission('OPERATOR', 'incident:create')).toBe(true);
    expect(hasPermission('OPERATOR', 'incident:update')).toBe(true);
    expect(hasPermission('ORG_ADMIN', 'incident:update')).toBe(true);
  });

  it('keeps alert rules, audit and members admin-only', () => {
    for (const permission of ['alert-rule:manage', 'audit:read', 'member:manage'] as const) {
      expect(hasPermission('OPERATOR', permission)).toBe(false);
      expect(hasPermission('ANALYST', permission)).toBe(false);
      expect(hasPermission('VIEWER', permission)).toBe(false);
      expect(hasPermission('ORG_ADMIN', permission)).toBe(true);
    }
  });

  it('lets analysts, operators and admins export reports but not viewers', () => {
    expect(hasPermission('VIEWER', 'report:export')).toBe(false);
    expect(hasPermission('ANALYST', 'report:export')).toBe(true);
  });

  it('lets everyone start a simulation but only operators and admins reset the demo', () => {
    for (const role of ROLES) expect(hasPermission(role, 'demo:simulate')).toBe(true);
    expect(hasPermission('VIEWER', 'demo:reset')).toBe(false);
    expect(hasPermission('ANALYST', 'demo:reset')).toBe(false);
    expect(hasPermission('OPERATOR', 'demo:reset')).toBe(true);
    expect(hasPermission('ORG_ADMIN', 'demo:reset')).toBe(true);
  });

  it('gives admins every permission', () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission('ORG_ADMIN', permission)).toBe(true);
    }
  });
});
