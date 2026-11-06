'use client';

import { REGIONS } from '@pulseops/contracts';
import type { Region, ServiceSummary } from '@pulseops/contracts';
import { useId } from 'react';

import { Select } from '@/components/ui/select';
import { RANGES } from './filters';
import type { DashboardFilters, RangeKey } from './filters';

interface Props {
  filters: DashboardFilters;
  services: ServiceSummary[];
  onChange: (next: DashboardFilters) => void;
}

export function FiltersBar({ filters, services, onChange }: Props) {
  const id = useId();

  return (
    <form
      role="search"
      aria-label="Dashboard filters"
      className="grid gap-3 sm:grid-cols-3"
      onSubmit={(e) => e.preventDefault()}
    >
      <div className="space-y-1">
        <label htmlFor={`${id}-service`} className="text-xs font-medium text-muted-foreground">
          Service
        </label>
        <Select
          id={`${id}-service`}
          value={filters.service ?? ''}
          onChange={(e) => onChange({ ...filters, service: e.target.value || undefined })}
        >
          <option value="">All services</option>
          {services.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1">
        <label htmlFor={`${id}-region`} className="text-xs font-medium text-muted-foreground">
          Region
        </label>
        <Select
          id={`${id}-region`}
          value={filters.region ?? ''}
          onChange={(e) =>
            onChange({ ...filters, region: (e.target.value as Region) || undefined })
          }
        >
          <option value="">All regions</option>
          {REGIONS.map((region) => (
            <option key={region} value={region}>
              {region}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1">
        <label htmlFor={`${id}-range`} className="text-xs font-medium text-muted-foreground">
          Time range
        </label>
        <Select
          id={`${id}-range`}
          value={filters.range}
          onChange={(e) => onChange({ ...filters, range: e.target.value as RangeKey })}
        >
          {Object.entries(RANGES).map(([key, { label }]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
      </div>
    </form>
  );
}
