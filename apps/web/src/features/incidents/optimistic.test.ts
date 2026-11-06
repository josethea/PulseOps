import type { Incident } from '@pulseops/contracts';
import { describe, expect, it } from 'vitest';

import { predictIncident } from './optimistic';

const incident: Incident = {
  id: 'inc_1',
  organizationId: 'org_demo',
  serviceId: 'svc_1',
  serviceName: 'checkout-api',
  region: 'LIM',
  title: 'Checkout failures',
  description: '',
  severity: 'SEV2',
  status: 'OPEN',
  assignee: null,
  createdBy: { userId: 'u1', displayName: 'Op' },
  createdAt: '2026-11-04T15:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 3,
  updatedAt: '2026-11-04T15:00:00.000Z',
};

describe('predictIncident', () => {
  it('acknowledges: new status, timestamp and version', () => {
    const next = predictIncident(
      incident,
      { kind: 'transition', transition: 'acknowledge' },
      'OPERATOR',
    );
    expect(next).toMatchObject({ status: 'ACKNOWLEDGED', version: 4 });
    expect(next.acknowledgedAt).not.toBeNull();
  });

  it('reopening clears resolvedAt but keeps acknowledgedAt', () => {
    const resolved: Incident = {
      ...incident,
      status: 'RESOLVED',
      acknowledgedAt: '2026-11-04T15:01:00.000Z',
      resolvedAt: '2026-11-04T15:30:00.000Z',
    };
    const next = predictIncident(
      resolved,
      { kind: 'transition', transition: 'reopen', reason: 'Back' },
      'OPERATOR',
    );
    expect(next).toMatchObject({
      status: 'OPEN',
      resolvedAt: null,
      acknowledgedAt: '2026-11-04T15:01:00.000Z',
    });
  });

  it('does not predict a transition the server would refuse', () => {
    const next = predictIncident(
      incident,
      { kind: 'transition', transition: 'resolve', reason: 'x' },
      'OPERATOR',
    );
    expect(next).toBe(incident);
  });

  it('assigns and unassigns', () => {
    const assigned = predictIncident(
      incident,
      { kind: 'assign', assignee: { userId: 'u2', displayName: 'Ada' } },
      'OPERATOR',
    );
    expect(assigned.assignee).toEqual({ userId: 'u2', displayName: 'Ada' });
    expect(
      predictIncident(assigned, { kind: 'assign', assignee: null }, 'OPERATOR').assignee,
    ).toBeNull();
  });

  it('applies edits', () => {
    const next = predictIncident(
      incident,
      { kind: 'update', patch: { severity: 'SEV1' } },
      'OPERATOR',
    );
    expect(next).toMatchObject({ severity: 'SEV1', version: 4 });
  });
});
