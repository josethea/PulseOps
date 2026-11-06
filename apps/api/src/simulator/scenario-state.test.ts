import { describe, expect, it } from 'vitest';

import { toMinute } from '../seed/telemetry.js';
import { scenarioOverride } from './scenario-state.js';
import type { ScenarioWindow } from './scenario-state.js';

const start = new Date('2026-11-05T12:00:40Z');
const minute = toMinute(start);
const window = (overrides: Partial<ScenarioWindow> = {}): ScenarioWindow => ({
  serviceId: 'svc_a',
  region: 'LIM',
  kind: 'OUTAGE',
  startedAt: start,
  endsAt: new Date(start.getTime() + 10 * 60_000),
  ...overrides,
});

describe('scenarioOverride', () => {
  it('covers the whole minutes from the start minute up to the end minute', () => {
    const override = scenarioOverride([window()]);
    expect(override('svc_a', 'LIM', minute - 1)).toBeUndefined();
    expect(override('svc_a', 'LIM', minute)).toBe('outage');
    expect(override('svc_a', 'LIM', minute + 9)).toBe('outage');
    expect(override('svc_a', 'LIM', minute + 10)).toBeUndefined();
  });

  it('only touches the targeted service and region', () => {
    const override = scenarioOverride([window()]);
    expect(override('svc_b', 'LIM', minute)).toBeUndefined();
    expect(override('svc_a', 'AQP', minute)).toBeUndefined();
  });

  it('maps degraded scenarios and lets an outage win when they overlap', () => {
    const degraded = window({ kind: 'DEGRADED' });
    expect(scenarioOverride([degraded])('svc_a', 'LIM', minute)).toBe('degraded');
    expect(scenarioOverride([degraded, window()])('svc_a', 'LIM', minute)).toBe('outage');
    expect(scenarioOverride([window(), degraded])('svc_a', 'LIM', minute)).toBe('outage');
  });

  it('ignores a scenario cancelled within its first minute', () => {
    const cancelled = window({ endsAt: new Date(start.getTime() + 5_000) });
    expect(scenarioOverride([cancelled])('svc_a', 'LIM', minute)).toBeUndefined();
  });
});
