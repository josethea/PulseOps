'use client';

import type { DashboardSnapshot, MetricKey, MetricSeriesResponse } from '@pulseops/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { apiGet } from '@/lib/api-client';
import { rangeWindow } from './filters';
import type { DashboardFilters } from './filters';

/** Live refresh until the realtime socket (Phase 4) pushes deltas instead. */
const SNAPSHOT_REFETCH_MS = 15_000;
const SERIES_REFETCH_MS = 30_000;

// Every key carries the organization and all filters so tenants and views never share cache.
export const dashboardKeys = {
  snapshot: (orgId: string, f: DashboardFilters) =>
    ['org', orgId, 'dashboard', 'snapshot', { service: f.service, region: f.region }] as const,
  series: (orgId: string, metric: MetricKey, f: DashboardFilters) =>
    ['org', orgId, 'dashboard', 'series', metric, f] as const,
};

export function useSnapshot(orgId: string, filters: DashboardFilters) {
  return useQuery({
    queryKey: dashboardKeys.snapshot(orgId, filters),
    queryFn: ({ signal }) =>
      apiGet<DashboardSnapshot>(
        `/organizations/${orgId}/dashboard/snapshot`,
        { service: filters.service, region: filters.region },
        signal,
      ),
    refetchInterval: SNAPSHOT_REFETCH_MS,
    placeholderData: keepPreviousData,
  });
}

export function useSeries(orgId: string, metric: MetricKey, filters: DashboardFilters) {
  return useQuery({
    queryKey: dashboardKeys.series(orgId, metric, filters),
    queryFn: ({ signal }) => {
      const { from, to } = rangeWindow(filters.range);
      return apiGet<MetricSeriesResponse>(
        `/organizations/${orgId}/metrics/series`,
        {
          metric,
          service: filters.service,
          region: filters.region,
          from: from.toISOString(),
          to: to.toISOString(),
        },
        signal,
      );
    },
    refetchInterval: SERIES_REFETCH_MS,
    placeholderData: keepPreviousData,
  });
}
