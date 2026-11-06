import type { KpiValue, MetricKey } from '@pulseops/contracts';

export const METRIC_LABELS: Record<string, string> = {
  orders_per_minute: 'Orders per minute',
  error_rate: 'Error rate',
  latency_p95: 'p95 latency',
  availability: 'Availability',
  orders_failed: 'Failed orders',
  orders_delayed: 'Delayed orders',
};

const COMBINE_LABELS: Record<KpiValue['combine'], string> = {
  total: 'total',
  mean: 'average',
  worst: 'worst service',
};

export function formatValue(value: number | null, unit: string): string {
  if (value === null) return '—';
  const digits = unit === '%' ? 2 : Number.isInteger(value) ? 0 : 1;
  const formatted = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: unit === '%' ? 2 : 0,
  }).format(value);
  return unit === '%' ? `${formatted}%` : formatted;
}

export function unitSuffix(unit: string): string {
  return unit === '%' || unit === '' ? '' : unit;
}

export function kpiCaption(kpi: KpiValue): string {
  const minutes = Math.round(kpi.windowSeconds / 60);
  return `Last ${minutes} min · ${COMBINE_LABELS[kpi.combine]}`;
}

export type Health = 'normal' | 'elevated' | 'critical';

/** Thresholds mirror the synthetic profiles and the seeded alert rules. */
export function healthFor(key: MetricKey, value: number | null): Health {
  if (value === null) return 'normal';
  if (key === 'error_rate') return value >= 20 ? 'critical' : value >= 3 ? 'elevated' : 'normal';
  if (key === 'availability') return value < 90 ? 'critical' : value < 99 ? 'elevated' : 'normal';
  return 'normal';
}

/** Formats an instant in the organization's time zone (UX-010: zone always visible). */
export function formatInstant(iso: string, timeZone: string, withDate: boolean): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    ...(withDate ? { day: '2-digit', month: 'short' } : { second: '2-digit' }),
    hour12: false,
  }).format(new Date(iso));
}
