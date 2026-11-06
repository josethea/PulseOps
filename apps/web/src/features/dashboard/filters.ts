import { REGIONS } from '@pulseops/contracts';
import type { Region } from '@pulseops/contracts';

export const RANGES = {
  '15m': { label: 'Last 15 minutes', ms: 15 * 60_000 },
  '1h': { label: 'Last hour', ms: 60 * 60_000 },
  '6h': { label: 'Last 6 hours', ms: 6 * 60 * 60_000 },
  '24h': { label: 'Last 24 hours', ms: 24 * 60 * 60_000 },
  '7d': { label: 'Last 7 days', ms: 7 * 24 * 60 * 60_000 },
  '30d': { label: 'Last 30 days', ms: 30 * 24 * 60 * 60_000 },
} as const;

export type RangeKey = keyof typeof RANGES;
export const DEFAULT_RANGE: RangeKey = '1h';

export interface DashboardFilters {
  service?: string;
  region?: Region;
  range: RangeKey;
}

const isRange = (value: string | null): value is RangeKey =>
  value !== null && Object.hasOwn(RANGES, value);
const isRegion = (value: string | null): value is Region =>
  value !== null && (REGIONS as readonly string[]).includes(value);

/** Reads filters from the URL; unknown or tampered values fall back to defaults. */
export function parseFilters(params: URLSearchParams): DashboardFilters {
  const service = params.get('service');
  const region = params.get('region');
  const range = params.get('range');
  return {
    service: service && service.length <= 64 ? service : undefined,
    region: isRegion(region) ? region : undefined,
    range: isRange(range) ? range : DEFAULT_RANGE,
  };
}

/** Serializes filters, omitting defaults so shared URLs stay short. */
export function filtersToSearch(filters: DashboardFilters): string {
  const params = new URLSearchParams();
  if (filters.service) params.set('service', filters.service);
  if (filters.region) params.set('region', filters.region);
  if (filters.range !== DEFAULT_RANGE) params.set('range', filters.range);
  return params.toString();
}

/** Query window ending at the current minute, so consecutive refetches line up on buckets. */
export function rangeWindow(range: RangeKey, now: number = Date.now()) {
  const to = new Date(Math.floor(now / 60_000) * 60_000 + 60_000);
  return { from: new Date(to.getTime() - RANGES[range].ms), to };
}
