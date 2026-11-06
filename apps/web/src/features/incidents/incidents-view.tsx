'use client';

import { SEVERITIES, INCIDENT_STATUSES } from '@pulseops/contracts';
import type { Incident, IncidentStatus, Severity } from '@pulseops/contracts';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { EmptyState, ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatInstant } from '@/features/dashboard/format';
import { useIncidentList, useServices } from './api';
import { CreateIncidentDialog } from './create-incident-dialog';
import { SORT_OPTIONS, filtersToSearch, hasActiveFilters, parseFilters } from './filters';
import type { IncidentFilters, SortValue } from './filters';
import { SEVERITY_LABELS, STATUS_LABELS, SeverityBadge, StatusBadge } from './labels';

const SEARCH_DEBOUNCE_MS = 300;

interface Props {
  orgId: string;
  timezone: string;
  canCreate: boolean;
}

export function IncidentsView({ orgId, timezone, canCreate }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The URL is the source of truth for filters, so views are shareable and survive reloads.
  const filters = useMemo(() => parseFilters(new URLSearchParams(searchParams)), [searchParams]);
  const setFilters = (next: IncidentFilters) => {
    const qs = filtersToSearch(next);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // Typing updates the box at once; the URL (and the query) follow after a pause.
  const [text, setText] = useState(filters.q ?? '');
  useEffect(() => {
    const next = text.trim() || undefined;
    if (next === filters.q) return;
    const timer = setTimeout(() => setFilters({ ...filters, q: next }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-arm only when the text changes
  }, [text]);

  const [creating, setCreating] = useState(false);
  const list = useIncidentList(orgId, filters);
  const services = useServices(orgId);

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages.at(-1)?.total ?? 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Incidents</h1>
          <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
            {list.isPending
              ? 'Loading…'
              : `${new Intl.NumberFormat('en-US').format(total)} matching`}
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-1.5 size-4" aria-hidden />
            New incident
          </Button>
        )}
      </header>

      <form
        role="search"
        aria-label="Incident filters"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(e) => e.preventDefault()}
      >
        <FilterField label="Search" id="inc-q">
          <Input
            id="inc-q"
            type="search"
            placeholder="Title contains…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </FilterField>
        <FilterField label="Status" id="inc-status">
          <Select
            id="inc-status"
            value={filters.status ?? ''}
            onChange={(e) =>
              setFilters({ ...filters, status: (e.target.value as IncidentStatus) || undefined })
            }
          >
            <option value="">All statuses</option>
            {INCIDENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Severity" id="inc-sev">
          <Select
            id="inc-sev"
            value={filters.severity ?? ''}
            onChange={(e) =>
              setFilters({ ...filters, severity: (e.target.value as Severity) || undefined })
            }
          >
            <option value="">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s} · {SEVERITY_LABELS[s]}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Service" id="inc-svc">
          <Select
            id="inc-svc"
            value={filters.service ?? ''}
            onChange={(e) => setFilters({ ...filters, service: e.target.value || undefined })}
          >
            <option value="">All services</option>
            {services.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Sort by" id="inc-sort">
          <Select
            id="inc-sort"
            value={filters.sort}
            onChange={(e) => setFilters({ ...filters, sort: e.target.value as SortValue })}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </FilterField>
      </form>

      <Card aria-label="Incident list">
        {list.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : list.isError && !list.data ? (
          <ErrorState
            error={list.error}
            onRetry={() => list.refetch()}
            title="Could not load incidents"
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={
              hasActiveFilters(filters) ? 'No incidents match these filters' : 'No incidents yet'
            }
            hint={
              hasActiveFilters(filters)
                ? 'Try removing a filter or searching for something else.'
                : canCreate
                  ? 'Create the first one with “New incident”.'
                  : undefined
            }
          />
        ) : (
          <IncidentTable items={items} timezone={timezone} />
        )}

        {items.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t p-3 text-sm">
            <span className="text-muted-foreground">
              Showing {new Intl.NumberFormat('en-US').format(items.length)} of{' '}
              {new Intl.NumberFormat('en-US').format(total)}
            </span>
            {hasActiveFilters(filters) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setText('');
                  setFilters({ sort: filters.sort });
                }}
              >
                Clear filters
              </Button>
            )}
            {list.hasNextPage && (
              <Button
                variant="outline"
                size="sm"
                disabled={list.isFetchingNextPage}
                onClick={() => list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            )}
          </div>
        )}
      </Card>

      <CreateIncidentDialog
        orgId={orgId}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(incident) => router.push(`/app/incidents/${incident.id}`)}
      />
    </div>
  );
}

function FilterField({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function IncidentTable({ items, timezone }: { items: Incident[]; timezone: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] text-left text-sm">
        <caption className="sr-only">Incidents. Times shown in {timezone}.</caption>
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="px-4 py-2 font-medium">
              Severity
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Title
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Service
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Assignee
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Created ({timezone})
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((incident) => (
            <tr key={incident.id} className="border-b last:border-b-0 hover:bg-accent/50">
              <td className="px-4 py-2.5">
                <SeverityBadge severity={incident.severity} />
              </td>
              <th scope="row" className="max-w-md px-4 py-2.5 font-medium">
                <Link
                  href={`/app/incidents/${incident.id}`}
                  className="line-clamp-2 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {incident.title}
                </Link>
              </th>
              <td className="px-4 py-2.5">
                <StatusBadge status={incident.status} />
              </td>
              <td className="px-4 py-2.5">
                {incident.serviceName}
                <span className="text-muted-foreground"> · {incident.region}</span>
              </td>
              <td className="px-4 py-2.5">
                {incident.assignee?.displayName ?? (
                  <span className="text-muted-foreground">Unassigned</span>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                {formatInstant(incident.createdAt, timezone, true)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
