import { NotFoundException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { SEVERITIES } from '@pulseops/contracts';
import type {
  DashboardSnapshot,
  KpiValue,
  MetricKey,
  MetricSeriesResponse,
  Region,
  ServiceStatus,
  ServiceSummary,
  SeriesQuery,
  Severity,
  SnapshotQuery,
} from '@pulseops/contracts';

import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** KPIs and service health are computed over the last few minutes of data. */
const KPI_WINDOW_MINUTES = 5;
const MINUTE_RANGE_LIMIT_MS = 48 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Combine = KpiValue['combine'];

/** Which aggregate of the per-series window means each KPI reports. */
const KPI_DEFINITIONS: {
  key: MetricKey;
  combine: Combine;
  field: 'total_a' | 'mean_a' | 'worst_a' | 'total_s';
}[] = [
  { key: 'orders_per_minute', combine: 'total', field: 'total_a' },
  { key: 'error_rate', combine: 'mean', field: 'mean_a' },
  { key: 'latency_p95', combine: 'worst', field: 'worst_a' },
  { key: 'availability', combine: 'mean', field: 'mean_a' },
  { key: 'orders_failed', combine: 'total', field: 'total_s' },
  { key: 'orders_delayed', combine: 'total', field: 'total_s' },
];

interface WindowRow {
  metricKey: string;
  total_a: number;
  mean_a: number;
  worst_a: number;
  total_s: number;
}

interface ServiceWindowRow extends WindowRow {
  serviceId: string;
}

interface SeriesRow {
  t: Date;
  avg: number | null;
  min: number;
  max: number;
  p95: number | null;
  count: number;
}

@Injectable()
export class TelemetryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Throws 404 unless the service belongs to the organization (never trust a client id). */
  async assertService(organizationId: string, serviceId: string) {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, organizationId },
      select: { id: true },
    });
    if (!service) throw new NotFoundException('Service not found');
  }

  async series(organizationId: string, query: SeriesQuery): Promise<MetricSeriesResponse> {
    if (query.service) await this.assertService(organizationId, query.service);

    const definition = await this.prisma.metricDefinition.findUnique({
      where: { key: query.metric },
    });
    if (!definition) throw new NotFoundException('Metric not found');

    const rangeMs = query.to.getTime() - query.from.getTime();
    const step = query.step ?? (rangeMs <= DAY_MS ? 'minute' : 'hour');
    if (step === 'minute' && rangeMs > MINUTE_RANGE_LIMIT_MS) {
      throw new UnprocessableEntityException({
        message: 'Validation failed',
        details: { fieldErrors: { step: ['Minute resolution is limited to 48 hours'] } },
      });
    }

    // Additive metrics (orders) sum across series; the rest are count-weighted means.
    const additive = definition.aggregationType === 'SUM';
    const rows = await this.prisma.$queryRaw<SeriesRow[]>(Prisma.sql`
      SELECT
        "bucketStart" AS t,
        ${additive ? Prisma.sql`SUM("avg")` : Prisma.sql`SUM("avg" * "count") / NULLIF(SUM("count"), 0)`}::float8 AS avg,
        ${additive ? Prisma.sql`SUM("min")` : Prisma.sql`MIN("min")`}::float8 AS min,
        ${additive ? Prisma.sql`SUM("max")` : Prisma.sql`MAX("max")`}::float8 AS max,
        MAX("p95")::float8 AS p95,
        SUM("count")::int AS count
      FROM "MetricAggregate"
      WHERE "organizationId" = ${organizationId}
        AND "metricKey" = ${query.metric}
        AND "bucketSize" = ${step === 'minute' ? 'MINUTE' : 'HOUR'}::"BucketSize"
        AND "bucketStart" >= ${query.from.toISOString()}::timestamptz
        AND "bucketStart" < ${query.to.toISOString()}::timestamptz
        ${query.service ? Prisma.sql`AND "serviceId" = ${query.service}` : Prisma.empty}
        ${query.region ? Prisma.sql`AND "region" = ${query.region}` : Prisma.empty}
      GROUP BY "bucketStart"
      ORDER BY "bucketStart"
    `);

    return {
      metric: query.metric,
      unit: definition.unit,
      aggregation: definition.aggregationType,
      step,
      from: query.from.toISOString(),
      to: query.to.toISOString(),
      filters: { service: query.service ?? null, region: query.region ?? null },
      points: rows.map((r) => ({
        t: r.t.toISOString(),
        avg: r.avg ?? 0,
        min: r.min,
        max: r.max,
        p95: r.p95,
        count: r.count,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  async snapshot(organizationId: string, query: SnapshotQuery): Promise<DashboardSnapshot> {
    if (query.service) await this.assertService(organizationId, query.service);

    const [latestBucketAt, kpiRows, services, openIncidents, activeAlerts, sequence, definitions] =
      await Promise.all([
        this.latestBucket(organizationId),
        this.windowByMetric(organizationId, query),
        this.services(organizationId, query.region),
        this.prisma.incident.groupBy({
          by: ['severity'],
          where: {
            organizationId,
            status: { not: 'RESOLVED' },
            ...(query.service && { serviceId: query.service }),
            ...(query.region && { region: query.region }),
          },
          _count: { _all: true },
        }),
        this.prisma.alertOccurrence.count({ where: { organizationId, state: 'FIRING' } }),
        this.prisma.eventSequence.findUnique({ where: { organizationId } }),
        this.prisma.metricDefinition.findMany({ select: { key: true, unit: true } }),
      ]);

    const units = new Map(definitions.map((d) => [d.key, d.unit]));
    const byMetric = new Map(kpiRows.map((r) => [r.metricKey, r]));
    const asOf = latestBucketAt?.toISOString() ?? null;

    const kpis: KpiValue[] = KPI_DEFINITIONS.map(({ key, combine, field }) => ({
      key,
      unit: units.get(key) ?? '',
      value: byMetric.has(key) ? round(byMetric.get(key)![field]) : null,
      combine,
      windowSeconds: KPI_WINDOW_MINUTES * 60,
      asOf,
    }));

    const openBySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<
      Severity,
      number
    >;
    for (const row of openIncidents) openBySeverity[row.severity] = row._count._all;

    return {
      generatedAt: new Date().toISOString(),
      cursor: (sequence?.lastSequence ?? 0n).toString(),
      filters: { service: query.service ?? null, region: query.region ?? null },
      freshness: {
        latestBucketAt: asOf,
        ageSeconds: latestBucketAt
          ? Math.max(0, Math.round((Date.now() - latestBucketAt.getTime()) / 1000))
          : null,
      },
      kpis,
      incidents: {
        openTotal: Object.values(openBySeverity).reduce((sum, n) => sum + n, 0),
        openBySeverity,
      },
      alerts: { active: activeAlerts },
      services,
    };
  }

  /** Service catalog with health derived from the latest metrics window. */
  async services(organizationId: string, region?: Region): Promise<ServiceSummary[]> {
    const [services, latestBucketAt, rows] = await Promise.all([
      this.prisma.service.findMany({
        where: { organizationId },
        orderBy: { name: 'asc' },
      }),
      this.latestBucket(organizationId),
      this.windowByService(organizationId, region),
    ]);
    const asOf = latestBucketAt?.toISOString() ?? null;

    return services.map((service) => {
      const metrics = new Map(
        rows.filter((r) => r.serviceId === service.id).map((r) => [r.metricKey, r]),
      );
      const errorRate = metrics.get('error_rate')?.mean_a ?? null;
      const availability = metrics.get('availability')?.mean_a ?? null;
      return {
        id: service.id,
        name: service.name,
        slug: service.slug,
        status: deriveStatus(errorRate, availability),
        ordersPerMinute: roundOrNull(metrics.get('orders_per_minute')?.total_a),
        errorRate: roundOrNull(errorRate),
        latencyP95: roundOrNull(metrics.get('latency_p95')?.worst_a),
        availability: roundOrNull(availability),
        asOf,
      };
    });
  }

  private async latestBucket(organizationId: string): Promise<Date | null> {
    const result = await this.prisma.metricAggregate.aggregate({
      where: { organizationId, bucketSize: 'MINUTE' },
      _max: { bucketStart: true },
    });
    return result._max.bucketStart;
  }

  /**
   * Window means per (service, region, metric) over the last KPI_WINDOW_MINUTES of data,
   * then combined per metric. The window ends at the newest bucket so it stays meaningful
   * when ingestion is behind (freshness is reported separately).
   */
  private windowByMetric(organizationId: string, query: SnapshotQuery) {
    return this.prisma.$queryRaw<WindowRow[]>(Prisma.sql`
      WITH latest AS (
        SELECT MAX("bucketStart") AS ts FROM "MetricAggregate"
        WHERE "organizationId" = ${organizationId} AND "bucketSize" = 'MINUTE'
      ),
      per_series AS (
        SELECT m."serviceId", m."region", m."metricKey", AVG(m."avg") AS a, SUM(m."avg") AS s
        FROM "MetricAggregate" m, latest
        WHERE m."organizationId" = ${organizationId}
          AND m."bucketSize" = 'MINUTE'
          AND m."bucketStart" > latest.ts - ${KPI_WINDOW_MINUTES} * interval '1 minute'
          AND m."metricKey" = ANY(${KPI_DEFINITIONS.map((k) => k.key)}::text[])
          ${query.service ? Prisma.sql`AND m."serviceId" = ${query.service}` : Prisma.empty}
          ${query.region ? Prisma.sql`AND m."region" = ${query.region}` : Prisma.empty}
        GROUP BY m."serviceId", m."region", m."metricKey"
      )
      SELECT "metricKey",
             SUM(a)::float8 AS total_a, AVG(a)::float8 AS mean_a,
             MAX(a)::float8 AS worst_a, SUM(s)::float8 AS total_s
      FROM per_series
      GROUP BY "metricKey"
    `);
  }

  private windowByService(organizationId: string, region?: Region) {
    return this.prisma.$queryRaw<ServiceWindowRow[]>(Prisma.sql`
      WITH latest AS (
        SELECT MAX("bucketStart") AS ts FROM "MetricAggregate"
        WHERE "organizationId" = ${organizationId} AND "bucketSize" = 'MINUTE'
      ),
      per_series AS (
        SELECT m."serviceId", m."region", m."metricKey", AVG(m."avg") AS a, SUM(m."avg") AS s
        FROM "MetricAggregate" m, latest
        WHERE m."organizationId" = ${organizationId}
          AND m."bucketSize" = 'MINUTE'
          AND m."bucketStart" > latest.ts - ${KPI_WINDOW_MINUTES} * interval '1 minute'
          AND m."metricKey" IN ('orders_per_minute', 'error_rate', 'latency_p95', 'availability')
          ${region ? Prisma.sql`AND m."region" = ${region}` : Prisma.empty}
        GROUP BY m."serviceId", m."region", m."metricKey"
      )
      SELECT "serviceId", "metricKey",
             SUM(a)::float8 AS total_a, AVG(a)::float8 AS mean_a,
             MAX(a)::float8 AS worst_a, SUM(s)::float8 AS total_s
      FROM per_series
      GROUP BY "serviceId", "metricKey"
    `);
  }
}

/** Thresholds follow the synthetic profiles: degraded >= 3% errors, outage >= 20%. */
export function deriveStatus(errorRate: number | null, availability: number | null): ServiceStatus {
  if (errorRate === null && availability === null) return 'HEALTHY';
  if ((errorRate ?? 0) >= 20 || (availability ?? 100) < 85) return 'DOWN';
  if ((errorRate ?? 0) >= 3) return 'DEGRADED';
  return 'HEALTHY';
}

const round = (value: number) => Math.round(value * 100) / 100;
const roundOrNull = (value: number | null | undefined) =>
  value === null || value === undefined ? null : round(value);
