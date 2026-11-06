import type { ServiceStatus, ServiceSummary } from '@pulseops/contracts';
import { AlertOctagon, AlertTriangle, CheckCircle2 } from 'lucide-react';

import { EmptyState } from '@/components/states';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatValue } from './format';

const STATUS = {
  HEALTHY: { label: 'Healthy', icon: CheckCircle2, className: 'text-muted-foreground' },
  DEGRADED: { label: 'Degraded', icon: AlertTriangle, className: 'text-sev2' },
  DOWN: { label: 'Down', icon: AlertOctagon, className: 'text-sev1' },
} satisfies Record<ServiceStatus, { label: string; icon: unknown; className: string }>;

export function ServicesTable({ services }: { services: ServiceSummary[] }) {
  return (
    <Card aria-labelledby="services-heading" className="p-4">
      <h2 id="services-heading" className="mb-3 text-sm font-semibold">
        Services
      </h2>
      {services.length === 0 ? (
        <EmptyState title="No services yet" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <caption className="sr-only">Service health over the last 5 minutes</caption>
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Service
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Status
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  Orders/min
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  Errors
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  p95 (ms)
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Availability
                </th>
              </tr>
            </thead>
            <tbody>
              {services.map((service) => {
                const { label, icon: Icon, className } = STATUS[service.status];
                return (
                  <tr key={service.id} className="border-t">
                    <th scope="row" className="py-2 pr-4 font-medium">
                      {service.name}
                    </th>
                    <td className="py-2 pr-4">
                      <span className={cn('inline-flex items-center gap-1.5', className)}>
                        <Icon className="size-4" aria-hidden />
                        {label}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {formatValue(service.ordersPerMinute, 'orders/min')}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {formatValue(service.errorRate, '%')}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {formatValue(service.latencyP95, 'ms')}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatValue(service.availability, '%')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
