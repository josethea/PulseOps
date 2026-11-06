import { METRIC_KEYS, REGIONS } from '@pulseops/contracts';
import type { MetricKey } from '@pulseops/contracts';

import { Prisma } from '../generated/prisma/client.js';
import { sampleAt, seriesSpec, toMinute } from './telemetry.js';
import type { ScenarioState } from './telemetry.js';

const MINUTES_PER_HOUR = 60;
const MINUTE_WINDOW = 24 * 60; // minute-level aggregates kept for the last 24 hours
const HOURLY_DAYS = 30; // hour-level aggregates kept for the last 30 days (spec 9.3)

interface ServiceRef {
  id: string;
  slug: string;
}

/** Forces a series into a state for a minute (demo scenarios); undefined keeps the baseline. */
export type StateOverride = (
  serviceId: string,
  region: string,
  minute: number,
) => ScenarioState | undefined;

function percentile95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1]!;
}

/** Minute-resolution rows for [fromMinute, toMinute) across every service x region. */
export function buildMinuteRows(
  organizationId: string,
  services: ServiceRef[],
  fromMinute: number,
  toMinute: number,
  override?: StateOverride,
): Prisma.MetricAggregateCreateManyInput[] {
  const rows: Prisma.MetricAggregateCreateManyInput[] = [];
  for (const service of services) {
    for (const region of REGIONS) {
      const spec = seriesSpec(service.id, service.slug, region);
      const base = { organizationId, serviceId: service.id, region };
      for (let minute = fromMinute; minute < toMinute; minute++) {
        const sample = sampleAt(spec, minute, override?.(service.id, region, minute));
        for (const key of METRIC_KEYS) {
          const value = sample[key];
          rows.push({
            ...base,
            metricKey: key,
            bucketStart: new Date(minute * 60_000),
            bucketSize: 'MINUTE',
            min: value,
            max: value,
            avg: value,
            count: 1,
            p95: null,
          });
        }
      }
    }
  }
  return rows;
}

/** Hour-resolution rows for the whole hours starting at each minute in `hourStarts`. */
export function buildHourRows(
  organizationId: string,
  services: ServiceRef[],
  hourStarts: number[],
  override?: StateOverride,
): Prisma.MetricAggregateCreateManyInput[] {
  const rows: Prisma.MetricAggregateCreateManyInput[] = [];
  for (const service of services) {
    for (const region of REGIONS) {
      const spec = seriesSpec(service.id, service.slug, region);
      const base = { organizationId, serviceId: service.id, region };
      for (const hourStart of hourStarts) {
        const buffers = newBuffers();
        for (let minute = hourStart; minute < hourStart + MINUTES_PER_HOUR; minute++) {
          const sample = sampleAt(spec, minute, override?.(service.id, region, minute));
          for (const key of METRIC_KEYS) buffers[key].push(sample[key]);
        }
        for (const key of METRIC_KEYS) {
          const values = buffers[key];
          rows.push({
            ...base,
            metricKey: key,
            bucketStart: new Date(hourStart * 60_000),
            bucketSize: 'HOUR',
            min: Math.min(...values),
            max: Math.max(...values),
            avg: values.reduce((sum, v) => sum + v, 0) / values.length,
            count: values.length,
            p95: percentile95(values),
          });
        }
      }
    }
  }
  return rows;
}

/** Whole-hour start minutes in [fromMinute, toMinute), aligned to the hour. */
export function wholeHours(fromMinute: number, toMinute: number): number[] {
  const hours: number[] = [];
  for (
    let h = Math.ceil(fromMinute / MINUTES_PER_HOUR) * MINUTES_PER_HOUR;
    h + MINUTES_PER_HOUR <= toMinute;
    h += MINUTES_PER_HOUR
  ) {
    hours.push(h);
  }
  return hours;
}

/**
 * Seed window: minute aggregates for the last 24h and hour aggregates for the last 30
 * days. The current (incomplete) hour only appears at minute resolution.
 */
export function buildMetricAggregates(
  organizationId: string,
  services: ServiceRef[],
  now: Date,
): Prisma.MetricAggregateCreateManyInput[] {
  const nowMinute = toMinute(now);
  return [
    ...buildMinuteRows(organizationId, services, nowMinute - MINUTE_WINDOW, nowMinute),
    ...buildHourRows(
      organizationId,
      services,
      wholeHours(nowMinute - HOURLY_DAYS * 24 * 60, nowMinute),
    ),
  ];
}

function newBuffers(): Record<MetricKey, number[]> {
  return Object.fromEntries(METRIC_KEYS.map((key) => [key, [] as number[]])) as Record<
    MetricKey,
    number[]
  >;
}

const INSERT_BATCH = 50_000;

/**
 * Bulk insert via `unnest` over column arrays: one statement per batch instead of one
 * bound parameter per value, which is far faster than `createMany` for ~500k rows.
 */
export async function insertMetricAggregates(
  prisma: Pick<Prisma.TransactionClient, '$executeRaw'>,
  rows: Prisma.MetricAggregateCreateManyInput[],
  { ignoreConflicts = false }: { ignoreConflicts?: boolean } = {},
) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "MetricAggregate"
        ("organizationId", "serviceId", "region", "metricKey", "bucketStart", "bucketSize",
         "min", "max", "avg", "count", "p95")
      SELECT * FROM unnest(
        ${batch.map((r) => r.organizationId)}::text[],
        ${batch.map((r) => r.serviceId)}::text[],
        ${batch.map((r) => r.region)}::text[],
        ${batch.map((r) => r.metricKey)}::text[],
        ${batch.map((r) => (r.bucketStart as Date).toISOString())}::timestamptz[],
        ${batch.map((r) => r.bucketSize)}::"BucketSize"[],
        ${batch.map((r) => r.min)}::float8[],
        ${batch.map((r) => r.max)}::float8[],
        ${batch.map((r) => r.avg)}::float8[],
        ${batch.map((r) => r.count)}::int[],
        ${batch.map((r) => r.p95 ?? null)}::float8[]
      )
      ${ignoreConflicts ? Prisma.sql`ON CONFLICT DO NOTHING` : Prisma.empty}
    `);
  }
}
