'use client';

import type { MetricKey, MetricPoint } from '@pulseops/contracts';
import { useTheme } from 'next-themes';
import { useId, useMemo } from 'react';

import { EChart } from '@/components/charts/echart';
import type { EChartOption } from '@/components/charts/echart';
import { EmptyState, ErrorState } from '@/components/states';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSeries } from './api';
import { RANGES } from './filters';
import type { DashboardFilters } from './filters';
import { formatInstant, formatValue } from './format';

const CHART_HEIGHT = 240;
const TABLE_ROWS = 12;

interface Threshold {
  value: number;
  label: string;
}

interface Props {
  orgId: string;
  metric: MetricKey;
  title: string;
  color: string;
  filters: DashboardFilters;
  timezone: string;
  threshold?: Threshold;
  /** Fill under the line: suits volumes (orders), not rates. */
  area?: boolean;
}

/** Evenly spaced sample of the points, for the accessible table alternative (UX-018). */
function sample(points: MetricPoint[], rows: number): MetricPoint[] {
  if (points.length <= rows) return points;
  return Array.from(
    { length: rows },
    (_, i) => points[Math.round((i * (points.length - 1)) / (rows - 1))]!,
  );
}

export function MetricChart({
  orgId,
  metric,
  title,
  color,
  filters,
  timezone,
  threshold,
  area,
}: Props) {
  const { resolvedTheme } = useTheme();
  const headingId = useId();
  const { data, isPending, isError, error, refetch } = useSeries(orgId, metric, filters);

  const withDate = RANGES[filters.range].ms > 24 * 60 * 60_000;
  const unit = data?.unit ?? '';
  const dark = resolvedTheme === 'dark';

  const option = useMemo<EChartOption>(() => {
    const axis = dark ? '#94a3b8' : '#64748b';
    const grid = dark ? '#334155' : '#e2e8f0';
    return {
      aria: { enabled: true },
      grid: { left: 52, right: 16, top: 20, bottom: 28 },
      tooltip: {
        trigger: 'axis',
        confine: true,
        formatter: (raw: unknown) => {
          const [p] = raw as { value: [number, number] }[];
          if (!p) return '';
          const when = formatInstant(new Date(p.value[0]).toISOString(), timezone, withDate);
          return `${when}<br/><strong>${formatValue(p.value[1], unit)}</strong> ${unit === '%' ? '' : unit}`;
        },
      },
      xAxis: {
        type: 'time',
        axisLabel: {
          color: axis,
          formatter: (value: number) =>
            formatInstant(new Date(value).toISOString(), timezone, withDate).slice(
              0,
              withDate ? 12 : 5,
            ),
        },
        axisLine: { lineStyle: { color: grid } },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLabel: { color: axis },
        splitLine: { lineStyle: { color: grid } },
      },
      series: [
        {
          type: 'line',
          showSymbol: false,
          sampling: 'lttb',
          data: (data?.points ?? []).map((p) => [new Date(p.t).getTime(), p.avg]),
          lineStyle: { width: 2, color },
          itemStyle: { color },
          ...(area && { areaStyle: { color, opacity: 0.12 } }),
          ...(threshold && {
            markLine: {
              silent: true,
              symbol: 'none',
              lineStyle: { type: 'dashed', color: '#ef4444' },
              label: { formatter: threshold.label, color: axis, position: 'insideEndTop' },
              data: [{ yAxis: threshold.value }],
            },
          }),
        },
      ],
    };
  }, [data, dark, color, unit, timezone, withDate, threshold, area]);

  const points = data?.points ?? [];
  const latest = points.at(-1);

  return (
    <Card aria-labelledby={headingId} className="p-4">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 id={headingId} className="text-sm font-semibold">
          {title}
          <span className="ml-1 font-normal text-muted-foreground">
            ({unit === '%' ? '%' : unit || '…'})
          </span>
        </h2>
        {latest && (
          <span className="text-sm text-muted-foreground">
            Latest <strong className="text-foreground">{formatValue(latest.avg, unit)}</strong>
          </span>
        )}
      </header>

      {isPending ? (
        <Skeleton className="h-[240px] w-full" />
      ) : isError && !data ? (
        <ErrorState error={error} onRetry={() => refetch()} title={`Could not load ${title}`} />
      ) : points.length === 0 ? (
        <EmptyState
          title="No data for this selection"
          hint="Try a wider time range or clear the service and region filters."
        />
      ) : (
        <>
          <EChart
            option={option}
            height={CHART_HEIGHT}
            label={`${title} over ${RANGES[filters.range].label.toLowerCase()}`}
          />
          {isError && (
            <p role="status" className="mt-2 text-xs text-sev2">
              Could not refresh; showing the last loaded data.
            </p>
          )}
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground">View data table</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">
                  {title}, sampled values. Times shown in {timezone}.
                </caption>
                <thead className="text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1 pr-4 font-medium">
                      Time ({timezone})
                    </th>
                    <th scope="col" className="py-1 pr-4 font-medium">
                      Average
                    </th>
                    <th scope="col" className="py-1 pr-4 font-medium">
                      Min
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      Max
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sample(points, TABLE_ROWS).map((p) => (
                    <tr key={p.t} className="border-t">
                      <th scope="row" className="py-1 pr-4 font-normal">
                        {formatInstant(p.t, timezone, withDate)}
                      </th>
                      <td className="py-1 pr-4">{formatValue(p.avg, unit)}</td>
                      <td className="py-1 pr-4">{formatValue(p.min, unit)}</td>
                      <td className="py-1">{formatValue(p.max, unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </Card>
  );
}
