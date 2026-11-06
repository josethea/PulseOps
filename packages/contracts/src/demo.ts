import { z } from 'zod';

import { REGIONS } from './metrics.js';

/**
 * Demo simulator contract (spec 18, FR-SIM). Scenarios inject synthetic degradation into
 * the telemetry of one service and region; they never touch real systems (FR-SIM-006).
 */
export const SCENARIO_KINDS = ['DEGRADED', 'OUTAGE'] as const;
export type ScenarioKind = (typeof SCENARIO_KINDS)[number];

export const SCENARIO_STATUSES = ['RUNNING', 'FINISHED', 'CANCELLED'] as const;
export type ScenarioStatus = (typeof SCENARIO_STATUSES)[number];

export const SCENARIO_DURATION_MINUTES = { min: 5, max: 30, default: 10 } as const;

/** Defaults for the headline scenario (spec 18.4: checkout-api in LIM). */
export const DEFAULT_SCENARIO_SERVICE_SLUG = 'checkout-api';
export const DEFAULT_SCENARIO_REGION = 'LIM';

export const startScenarioSchema = z.object({
  kind: z.enum(SCENARIO_KINDS).default('OUTAGE'),
  /** Service id from `GET /services`. Defaults to checkout-api. */
  serviceId: z.string().min(1).max(64).optional(),
  region: z.enum(REGIONS).default(DEFAULT_SCENARIO_REGION),
  durationMinutes: z
    .number()
    .int()
    .min(SCENARIO_DURATION_MINUTES.min)
    .max(SCENARIO_DURATION_MINUTES.max)
    .default(SCENARIO_DURATION_MINUTES.default),
});
export type StartScenarioRequest = z.infer<typeof startScenarioSchema>;

export interface DemoScenario {
  id: string;
  kind: ScenarioKind;
  status: ScenarioStatus;
  serviceId: string;
  serviceName: string;
  region: string;
  startedAt: string;
  /** Planned end while running, actual end once finished or cancelled. */
  endsAt: string;
  startedByName: string | null;
}

export interface DemoQuota {
  /** Scenarios allowed per rolling hour, and how many this tenant has started in it. */
  limit: number;
  used: number;
  /** When the oldest counted scenario leaves the window; null while quota remains. */
  nextSlotAt: string | null;
}

export type DemoUnavailableReason = 'not_demo_tenant' | 'demo_disabled';

export interface DemoStatus {
  enabled: boolean;
  reason: DemoUnavailableReason | null;
  active: DemoScenario | null;
  recent: DemoScenario[];
  quota: DemoQuota;
  reset: { lastResetAt: string | null; availableAt: string | null };
}

export interface DemoResetResult {
  resetAt: string;
  incidents: number;
  alertRules: number;
}
