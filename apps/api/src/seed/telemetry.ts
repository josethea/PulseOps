/**
 * Synthetic telemetry (spec 18.3). Every value is a pure function of
 * (series, minute), so the seed and the future simulator generate identical data and
 * any minute can be computed independently. All numbers are synthetic parameters.
 */
import type { MetricKey } from '@pulseops/contracts';

export type ScenarioState = 'healthy' | 'degraded' | 'outage';

export interface SeriesSpec {
  /** Stable id used to derive noise, e.g. `svc_checkout:LIM`. */
  key: string;
  baseOrdersPerMinute: number;
  baseLatencyP50Ms: number;
}

export type MinuteSample = Record<MetricKey, number>;

const MINUTE_MS = 60_000;
const EPISODE_BLOCK_MINUTES = 120;
const EPISODE_PROBABILITY = 0.01;
const OUTAGE_SHARE = 0.3;

/** 32-bit string hash (FNV-1a). */
function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic uniform value in [0, 1) for a (series, minute, salt) triple. */
function noise(seriesHash: number, minute: number, salt: number): number {
  let h = seriesHash ^ Math.imul(minute | 0, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Epoch minute index (whole minutes since the Unix epoch). */
export function toMinute(date: Date | number): number {
  return Math.floor((typeof date === 'number' ? date : date.getTime()) / MINUTE_MS);
}

/** Demand curve with lunch and dinner peaks (Lima time, UTC-5), in [~0.25, 1]. */
function demandFactor(minute: number): number {
  const localHour = (((minute / 60 - 5) % 24) + 24) % 24;
  const peak = (center: number, width: number) =>
    Math.exp(-((localHour - center) ** 2) / (2 * width ** 2));
  return 0.25 + 0.75 * Math.max(peak(13, 1.8), peak(20, 2.2));
}

/**
 * Whether the series is inside a degraded/outage episode. Time is split into blocks;
 * a block hosts at most one episode that starts and ends inside it.
 */
export function scenarioAt(series: SeriesSpec, minute: number): ScenarioState {
  const seriesHash = hashString(series.key);
  const block = Math.floor(minute / EPISODE_BLOCK_MINUTES);
  if (noise(seriesHash, block, 1) >= EPISODE_PROBABILITY) return 'healthy';

  const start = block * EPISODE_BLOCK_MINUTES + Math.floor(noise(seriesHash, block, 2) * 30);
  const duration = 15 + Math.floor(noise(seriesHash, block, 3) * 60);
  if (minute < start || minute >= start + duration) return 'healthy';
  return noise(seriesHash, block, 4) < OUTAGE_SHARE ? 'outage' : 'degraded';
}

/**
 * One minute of telemetry. `forced` replaces the generated scenario state, which is how a
 * demo scenario injects an outage while the underlying noise stays deterministic.
 */
export function sampleAt(series: SeriesSpec, minute: number, forced?: ScenarioState): MinuteSample {
  const seriesHash = hashString(series.key);
  const n = (salt: number) => noise(seriesHash, minute, 10 + salt);
  const state = forced ?? scenarioAt(series, minute);

  const orders = Math.round(
    series.baseOrdersPerMinute *
      demandFactor(minute) *
      (0.9 + 0.2 * n(0)) *
      (state === 'outage' ? 0.5 : 1),
  );

  const errorRate =
    state === 'outage' ? 20 + 30 * n(1) : state === 'degraded' ? 3 + 5 * n(1) : 0.2 + 0.8 * n(1);

  const latencyFactor = state === 'outage' ? 4 : state === 'degraded' ? 2 : 1;
  const p50 = series.baseLatencyP50Ms * latencyFactor * (0.9 + 0.2 * n(2));
  const p95 = p50 * (2 + 0.5 * n(3));
  const p99 = p95 * (1.4 + 0.3 * n(4));

  const failed = Math.round((orders * errorRate) / 100);
  const delayed = Math.round(orders * (0.02 + errorRate / 50) * (0.8 + 0.4 * n(5)));

  return {
    orders_per_minute: orders,
    error_rate: round(errorRate, 2),
    latency_p50: round(p50, 1),
    latency_p95: round(p95, 1),
    latency_p99: round(p99, 1),
    availability: round(Math.min(100, Math.max(0, 100 - errorRate * 0.9)), 3),
    orders_completed: Math.max(0, orders - failed),
    orders_failed: failed,
    orders_delayed: delayed,
  };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Per-service load profile used by the seed. */
export const SERVICE_PROFILES: Record<string, { orders: number; latency: number }> = {
  'checkout-api': { orders: 120, latency: 140 },
  'orders-service': { orders: 100, latency: 110 },
  'dispatch-service': { orders: 80, latency: 180 },
  'payments-adapter': { orders: 90, latency: 220 },
  'notifications-service': { orders: 150, latency: 60 },
  'api-gateway': { orders: 60, latency: 90 },
  'billing-sync': { orders: 25, latency: 250 },
};

export const REGION_LOAD: Record<string, number> = { LIM: 1, AQP: 0.35, CUS: 0.25, TAC: 0.15 };

export function seriesSpec(serviceId: string, serviceSlug: string, region: string): SeriesSpec {
  const profile = SERVICE_PROFILES[serviceSlug] ?? { orders: 50, latency: 120 };
  return {
    key: `${serviceId}:${region}`,
    baseOrdersPerMinute: Math.max(2, profile.orders * (REGION_LOAD[region] ?? 0.2)),
    baseLatencyP50Ms: profile.latency,
  };
}
