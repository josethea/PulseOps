import { INCIDENT_STATUSES, SEVERITIES } from '@pulseops/contracts';
import type { IncidentStatus, Severity } from '@pulseops/contracts';

/** Sorts offered in the UI; each maps to an API `sort` value. */
export const SORT_OPTIONS = [
  { value: '-createdAt', label: 'Newest first' },
  { value: 'createdAt', label: 'Oldest first' },
  { value: '-updatedAt', label: 'Recently updated' },
  { value: 'severity', label: 'Severity (highest first)' },
  { value: '-severity', label: 'Severity (lowest first)' },
] as const;
export type SortValue = (typeof SORT_OPTIONS)[number]['value'];

export const DEFAULT_SORT: SortValue = '-createdAt';

export interface IncidentFilters {
  status?: IncidentStatus;
  severity?: Severity;
  service?: string;
  q?: string;
  sort: SortValue;
}

/** Reads filters from the URL; unknown or malformed values fall back to "no filter". */
export function parseFilters(params: URLSearchParams): IncidentFilters {
  const status = params.get('status');
  const severity = params.get('severity');
  const sort = params.get('sort');
  const q = params.get('q')?.trim();
  return {
    status: INCIDENT_STATUSES.find((s) => s === status),
    severity: SEVERITIES.find((s) => s === severity),
    service: params.get('service') || undefined,
    q: q ? q.slice(0, 100) : undefined,
    sort: SORT_OPTIONS.find((o) => o.value === sort)?.value ?? DEFAULT_SORT,
  };
}

/** Serializes filters for the URL, omitting defaults so the default view has a clean URL. */
export function filtersToSearch(filters: IncidentFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.service) params.set('service', filters.service);
  if (filters.q) params.set('q', filters.q);
  if (filters.sort !== DEFAULT_SORT) params.set('sort', filters.sort);
  return params.toString();
}

export function hasActiveFilters(filters: IncidentFilters): boolean {
  return Boolean(filters.status || filters.severity || filters.service || filters.q);
}
