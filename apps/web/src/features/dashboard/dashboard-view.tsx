'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSnapshot } from './api';
import { filtersToSearch, parseFilters } from './filters';
import type { DashboardFilters } from './filters';
import { FiltersBar } from './filters-bar';
import { Freshness } from './freshness';
import { IncidentsCard } from './incidents-card';
import { KpiCards, KpiCardsSkeleton } from './kpi-cards';
import { MetricChart } from './metric-chart';
import { ServicesTable } from './services-table';

export function DashboardView({ orgId, timezone }: { orgId: string; timezone: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The URL is the source of truth for filters, so views are shareable and survive reloads.
  const filters = useMemo(() => parseFilters(new URLSearchParams(searchParams)), [searchParams]);
  const setFilters = (next: DashboardFilters) => {
    const qs = filtersToSearch(next);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const snapshot = useSnapshot(orgId, filters);
  const { data } = snapshot;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        {data ? (
          <Freshness
            freshness={data.freshness}
            timezone={timezone}
            isFetching={snapshot.isFetching}
            fetchFailed={snapshot.isError}
          />
        ) : (
          <Skeleton className="h-5 w-72" />
        )}
      </header>

      <FiltersBar filters={filters} services={data?.services ?? []} onChange={setFilters} />

      {snapshot.isPending ? (
        <KpiCardsSkeleton />
      ) : snapshot.isError && !data ? (
        <Card>
          <ErrorState
            error={snapshot.error}
            onRetry={() => snapshot.refetch()}
            title="Could not load the dashboard"
          />
          {filters.service && (
            <div className="pb-4 text-center">
              {/* A stale or invalid service ID in the URL would otherwise leave no way out. */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFilters({ ...filters, service: undefined })}
              >
                Clear service filter
              </Button>
            </div>
          )}
        </Card>
      ) : data ? (
        <KpiCards kpis={data.kpis} />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <MetricChart
          orgId={orgId}
          metric="orders_per_minute"
          title="Orders per minute"
          color="#3b82f6"
          filters={filters}
          timezone={timezone}
          area
        />
        <MetricChart
          orgId={orgId}
          metric="error_rate"
          title="Error rate"
          color="#f97316"
          filters={filters}
          timezone={timezone}
          threshold={{ value: 5, label: 'Alert threshold 5%' }}
        />
        <div className="lg:col-span-2">
          <MetricChart
            orgId={orgId}
            metric="latency_p95"
            title="p95 latency"
            color="#8b5cf6"
            filters={filters}
            timezone={timezone}
            threshold={{ value: 800, label: 'Alert threshold 800 ms' }}
          />
        </div>
      </div>

      {data && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ServicesTable services={data.services} />
          </div>
          <IncidentsCard incidents={data.incidents} alerts={data.alerts} />
        </div>
      )}
    </div>
  );
}
