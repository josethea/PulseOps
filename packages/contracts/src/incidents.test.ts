import { describe, expect, it } from 'vitest';

import {
  INCIDENT_STATUSES,
  availableTransitions,
  createIncidentSchema,
  incidentListQuerySchema,
  isEditable,
  reasonedTransitionSchema,
  transitionTarget,
  updateIncidentSchema,
} from './incidents.js';

describe('incident state machine', () => {
  it('follows OPEN -> ACKNOWLEDGED -> INVESTIGATING -> RESOLVED -> OPEN', () => {
    expect(transitionTarget('acknowledge', 'OPEN', 'OPERATOR')).toBe('ACKNOWLEDGED');
    expect(transitionTarget('investigate', 'ACKNOWLEDGED', 'OPERATOR')).toBe('INVESTIGATING');
    expect(transitionTarget('resolve', 'INVESTIGATING', 'OPERATOR')).toBe('RESOLVED');
    expect(transitionTarget('reopen', 'RESOLVED', 'OPERATOR')).toBe('OPEN');
  });

  it('rejects every transition that is not in the table', () => {
    expect(transitionTarget('acknowledge', 'INVESTIGATING', 'OPERATOR')).toBeNull();
    expect(transitionTarget('investigate', 'OPEN', 'OPERATOR')).toBeNull();
    expect(transitionTarget('resolve', 'OPEN', 'OPERATOR')).toBeNull();
    expect(transitionTarget('resolve', 'RESOLVED', 'ORG_ADMIN')).toBeNull();
    expect(transitionTarget('reopen', 'OPEN', 'ORG_ADMIN')).toBeNull();
  });

  it('lets only an Org Admin resolve straight from ACKNOWLEDGED (BR-004)', () => {
    expect(transitionTarget('resolve', 'ACKNOWLEDGED', 'ORG_ADMIN')).toBe('RESOLVED');
    expect(transitionTarget('resolve', 'ACKNOWLEDGED', 'OPERATOR')).toBeNull();
  });

  it.each(['ANALYST', 'VIEWER'] as const)('gives %s no transitions at all', (role) => {
    for (const status of INCIDENT_STATUSES) {
      expect(availableTransitions(status, role)).toEqual([]);
    }
  });

  it('lists the actions available per state', () => {
    expect(availableTransitions('OPEN', 'OPERATOR')).toEqual(['acknowledge']);
    expect(availableTransitions('ACKNOWLEDGED', 'ORG_ADMIN')).toEqual(['investigate', 'resolve']);
    expect(availableTransitions('RESOLVED', 'OPERATOR')).toEqual(['reopen']);
  });

  it('freezes editing once resolved', () => {
    expect(isEditable('INVESTIGATING')).toBe(true);
    expect(isEditable('RESOLVED')).toBe(false);
  });
});

describe('incident request schemas', () => {
  it('requires a meaningful reason to resolve or reopen (FR-INC-008)', () => {
    expect(reasonedTransitionSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(reasonedTransitionSchema.safeParse({ reason: '  ', expectedVersion: 1 }).success).toBe(
      false,
    );
    expect(
      reasonedTransitionSchema.safeParse({ reason: 'Rolled back', expectedVersion: 1 }).success,
    ).toBe(true);
  });

  it('requires an expected version on updates and at least one field', () => {
    expect(updateIncidentSchema.safeParse({ title: 'New title' }).success).toBe(false);
    expect(updateIncidentSchema.safeParse({ expectedVersion: 2 }).success).toBe(false);
    expect(updateIncidentSchema.safeParse({ title: 'New title', expectedVersion: 2 }).success).toBe(
      true,
    );
  });

  it('validates the create form (TEST-C-004 shares this schema)', () => {
    const base = {
      title: 'Checkout failures',
      serviceId: 'svc_1',
      region: 'LIM',
      severity: 'SEV1',
    };
    expect(createIncidentSchema.safeParse(base).success).toBe(true);
    expect(createIncidentSchema.safeParse({ ...base, title: 'ab' }).success).toBe(false);
    expect(createIncidentSchema.safeParse({ ...base, region: 'XXX' }).success).toBe(false);
    expect(createIncidentSchema.safeParse({ ...base, severity: 'SEV9' }).success).toBe(false);
  });

  it('applies list defaults and caps the page size', () => {
    expect(incidentListQuerySchema.parse({})).toMatchObject({ sort: '-createdAt', limit: 50 });
    expect(incidentListQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
    expect(incidentListQuerySchema.safeParse({ sort: 'title' }).success).toBe(false);
  });
});
