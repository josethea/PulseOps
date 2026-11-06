import { describe, expect, it } from 'vitest';

import {
  createAlertRuleSchema,
  isViolation,
  mayFire,
  thresholdProblem,
  updateAlertRuleSchema,
} from './alerts.js';

const valid = {
  name: 'Checkout errors',
  serviceId: 'svc_1',
  metricKey: 'error_rate',
  operator: 'GT',
  threshold: 5,
  windowSeconds: 300,
  severity: 'SEV2',
} as const;

describe('isViolation', () => {
  it('applies each operator strictly', () => {
    expect(isViolation('GT', 5, 5)).toBe(false);
    expect(isViolation('GTE', 5, 5)).toBe(true);
    expect(isViolation('LT', 4.9, 5)).toBe(true);
    expect(isViolation('LTE', 5, 5)).toBe(true);
    expect(isViolation('EQ', 5, 5)).toBe(true);
    expect(isViolation('EQ', 5.1, 5)).toBe(false);
  });
});

describe('mayFire (BR-009)', () => {
  const now = new Date('2026-11-04T12:00:00Z');
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

  it('never fires while an episode is still open', () => {
    expect(mayFire(ago(9999), true, 300, now)).toBe(false);
  });

  it('stays quiet during the cooldown after the last firing', () => {
    expect(mayFire(ago(299), false, 300, now)).toBe(false);
    expect(mayFire(ago(300), false, 300, now)).toBe(true);
  });

  it('fires the first time', () => {
    expect(mayFire(null, false, 300, now)).toBe(true);
  });
});

describe('rule validation (BR-008)', () => {
  it('applies defaults for cooldown and enabled', () => {
    const parsed = createAlertRuleSchema.parse(valid);
    expect(parsed.cooldownSeconds).toBe(300);
    expect(parsed.isEnabled).toBe(true);
  });

  it('rejects windows under a minute or not in whole minutes', () => {
    expect(createAlertRuleSchema.safeParse({ ...valid, windowSeconds: 30 }).success).toBe(false);
    expect(createAlertRuleSchema.safeParse({ ...valid, windowSeconds: 90 }).success).toBe(false);
  });

  it('rejects thresholds that cannot apply to the metric', () => {
    expect(thresholdProblem('error_rate', 150)).not.toBeNull();
    expect(thresholdProblem('latency_p95', 150)).toBeNull();
    expect(thresholdProblem('latency_p95', -1)).not.toBeNull();
    const result = createAlertRuleSchema.safeParse({ ...valid, threshold: 150 });
    expect(result.success).toBe(false);
  });

  it('requires a change and the expected version on update', () => {
    expect(updateAlertRuleSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(updateAlertRuleSchema.safeParse({ threshold: 9 }).success).toBe(false);
    expect(updateAlertRuleSchema.safeParse({ threshold: 9, expectedVersion: 1 }).success).toBe(
      true,
    );
  });
});
