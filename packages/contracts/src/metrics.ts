import { z } from 'zod';

export const REGIONS = ['LIM', 'AQP', 'CUS', 'TAC'] as const;
export type Region = (typeof REGIONS)[number];

export const METRIC_KEYS = [
  'orders_per_minute',
  'error_rate',
  'latency_p50',
  'latency_p95',
  'latency_p99',
  'availability',
  'orders_completed',
  'orders_failed',
  'orders_delayed',
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export const SEVERITIES = ['SEV1', 'SEV2', 'SEV3', 'SEV4'] as const;
export type Severity = (typeof SEVERITIES)[number];

export type ServiceStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN';
export type MetricStep = 'minute' | 'hour';

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;

const filterFields = {
  /** Opaque service id from `GET /services`. Omit for all services. */
  service: z.string().min(1).max(64).optional(),
  region: z.enum(REGIONS).optional(),
};

export const snapshotQuerySchema = z.object(filterFields);
export type SnapshotQuery = z.infer<typeof snapshotQuerySchema>;

export const seriesQuerySchema = z
  .object({
    metric: z.enum(METRIC_KEYS),
    ...filterFields,
    from: z.coerce.date(),
    to: z.coerce.date(),
    step: z.enum(['minute', 'hour']).optional(),
  })
  .refine((q) => q.from < q.to, { message: '`from` must be before `to`', path: ['from'] })
  .refine((q) => q.to.getTime() - q.from.getTime() <= MAX_RANGE_MS, {
    message: 'Range cannot exceed 31 days',
    path: ['to'],
  });
export type SeriesQuery = z.infer<typeof seriesQuerySchema>;

export interface MetricPoint {
  /** Bucket start, ISO 8601 UTC. */
  t: string;
  /** Mean per minute for the bucket (summed across series for additive metrics). */
  avg: number;
  min: number;
  max: number;
  /** Upper bound across series (max of the per-series p95). Null when not recorded. */
  p95: number | null;
  count: number;
}

export interface MetricSeriesResponse {
  metric: MetricKey;
  unit: string;
  aggregation: 'AVG' | 'SUM' | 'MAX' | 'MIN' | 'P95';
  step: MetricStep;
  from: string;
  to: string;
  filters: { service: string | null; region: Region | null };
  points: MetricPoint[];
  generatedAt: string;
}

/** A KPI carries its unit, window and freshness so it is never a bare number (BR-017). */
export interface KpiValue {
  key: MetricKey;
  unit: string;
  value: number | null;
  /** How the value was combined: window total, mean, or worst case across series. */
  combine: 'total' | 'mean' | 'worst';
  windowSeconds: number;
  asOf: string | null;
}

export interface ServiceSummary {
  id: string;
  name: string;
  slug: string;
  status: ServiceStatus;
  ordersPerMinute: number | null;
  errorRate: number | null;
  latencyP95: number | null;
  availability: number | null;
  asOf: string | null;
}

export interface DashboardSnapshot {
  generatedAt: string;
  /** Last consistent event sequence for this tenant; the realtime stream resumes from it. */
  cursor: string;
  filters: { service: string | null; region: Region | null };
  freshness: { latestBucketAt: string | null; ageSeconds: number | null };
  kpis: KpiValue[];
  incidents: { openTotal: number; openBySeverity: Record<Severity, number> };
  alerts: { active: number };
  services: ServiceSummary[];
}
