'use client';

import { ALERT_STATES, SEVERITIES } from '@pulseops/contracts';
import type { AlertState, Severity } from '@pulseops/contracts';
import { BellRing, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';

import { EmptyState, ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatInstant } from '@/features/dashboard/format';
import { SEVERITY_LABELS, SeverityBadge } from '@/features/incidents/labels';
import { useAlerts } from './api';
import { conditionText } from './labels';

const STATE_LABELS: Record<AlertState, string> = { FIRING: 'Firing', CLEARED: 'Cleared' };

export function AlertsView({ orgId, timezone }: { orgId: string; timezone: string }) {
  const [state, setState] = useState<AlertState | undefined>('FIRING');
  const [severity, setSeverity] = useState<Severity | undefined>();
  const list = useAlerts(orgId, state, severity);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Raised automatically when a rule&apos;s metric crosses its threshold. Updates live.
        </p>
      </header>

      <div className="flex flex-wrap gap-3">
        <div className="w-44">
          <label htmlFor="alert-state" className="sr-only">
            State
          </label>
          <Select
            id="alert-state"
            value={state ?? ''}
            onChange={(e) => setState((e.target.value || undefined) as AlertState | undefined)}
          >
            <option value="">All states</option>
            {ALERT_STATES.map((s) => (
              <option key={s} value={s}>
                {STATE_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <label htmlFor="alert-severity" className="sr-only">
            Severity
          </label>
          <Select
            id="alert-severity"
            value={severity ?? ''}
            onChange={(e) => setSeverity((e.target.value || undefined) as Severity | undefined)}
          >
            <option value="">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s} · {SEVERITY_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden">
        {list.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={state === 'FIRING' ? 'No active alerts' : 'No alerts match these filters'}
            hint="Alerts appear here as soon as a rule fires."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Alerts, newest first</caption>
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Severity
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Rule
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Service
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Condition
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Observed
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    State
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Triggered
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((alert) => (
                  <tr key={alert.id}>
                    <td className="px-4 py-3">
                      <SeverityBadge severity={alert.severity} />
                    </td>
                    <td className="px-4 py-3 font-medium">{alert.ruleName}</td>
                    <td className="px-4 py-3">{alert.serviceName}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{conditionText(alert)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {Math.round(alert.observedValue * 100) / 100}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        {alert.state === 'FIRING' ? (
                          <BellRing className="size-4 text-sev2" aria-hidden />
                        ) : (
                          <CheckCircle2 className="size-4 text-muted-foreground" aria-hidden />
                        )}
                        {STATE_LABELS[alert.state]}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      {formatInstant(alert.triggeredAt, timezone, true)}
                      {alert.clearedAt && (
                        <span className="block text-xs">
                          cleared {formatInstant(alert.clearedAt, timezone, true)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {list.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => void list.fetchNextPage()}
            disabled={list.isFetchingNextPage}
          >
            {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
