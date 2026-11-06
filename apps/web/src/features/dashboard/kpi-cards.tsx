import type { DashboardSnapshot } from '@pulseops/contracts';
import { AlertOctagon, AlertTriangle } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatValue, healthFor, kpiCaption, METRIC_LABELS, unitSuffix } from './format';

const KPI_COUNT = 6;

export function KpiCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: KPI_COUNT }, (_, i) => (
        <Card key={i} className="p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-8 w-20" />
          <Skeleton className="mt-3 h-3 w-28" />
        </Card>
      ))}
    </div>
  );
}

export function KpiCards({ kpis }: { kpis: DashboardSnapshot['kpis'] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      {kpis.map((kpi) => {
        const health = healthFor(kpi.key, kpi.value);
        return (
          <li key={kpi.key}>
            <Card className="h-full p-4">
              <p className="text-sm text-muted-foreground">{METRIC_LABELS[kpi.key] ?? kpi.key}</p>
              <p className="mt-1 flex items-baseline gap-1">
                <span
                  className={cn(
                    'text-2xl font-semibold tabular-nums',
                    health === 'critical' && 'text-sev1',
                    health === 'elevated' && 'text-sev2',
                  )}
                >
                  {formatValue(kpi.value, kpi.unit)}
                </span>
                <span className="text-xs text-muted-foreground">{unitSuffix(kpi.unit)}</span>
              </p>
              {/* Severity is conveyed by icon and text as well as color (UX-009). */}
              {health !== 'normal' && (
                <p
                  className={cn(
                    'mt-1 flex items-center gap-1 text-xs font-medium',
                    health === 'critical' ? 'text-sev1' : 'text-sev2',
                  )}
                >
                  {health === 'critical' ? (
                    <AlertOctagon className="size-3.5" aria-hidden />
                  ) : (
                    <AlertTriangle className="size-3.5" aria-hidden />
                  )}
                  {health === 'critical' ? 'Critical' : 'Elevated'}
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">{kpiCaption(kpi)}</p>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
