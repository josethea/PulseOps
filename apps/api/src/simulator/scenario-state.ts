import type { ScenarioKind } from '@pulseops/contracts';

import type { StateOverride } from '../seed/metrics-seed.js';
import { toMinute } from '../seed/telemetry.js';

export interface ScenarioWindow {
  serviceId: string;
  region: string;
  kind: ScenarioKind;
  startedAt: Date;
  /** Planned end while running, actual end once finished or cancelled. */
  endsAt: Date;
}

/**
 * Turns scenarios into the per-minute state override the telemetry generator consumes.
 * A scenario covers the whole minutes from the one it started in up to, but excluding,
 * the one it ends in; where scenarios overlap on a series, an outage wins.
 */
export function scenarioOverride(scenarios: readonly ScenarioWindow[]): StateOverride {
  const windows = scenarios.map((s) => ({
    serviceId: s.serviceId,
    region: s.region,
    outage: s.kind === 'OUTAGE',
    from: toMinute(s.startedAt),
    to: toMinute(s.endsAt),
  }));

  return (serviceId, region, minute) => {
    let state: 'degraded' | 'outage' | undefined;
    for (const w of windows) {
      if (w.serviceId !== serviceId || w.region !== region) continue;
      if (minute < w.from || minute >= w.to) continue;
      if (w.outage) return 'outage';
      state = 'degraded';
    }
    return state;
  };
}
