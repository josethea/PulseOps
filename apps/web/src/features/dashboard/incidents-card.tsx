import { SEVERITIES } from '@pulseops/contracts';
import type { DashboardSnapshot } from '@pulseops/contracts';
import Link from 'next/link';

import { Card } from '@/components/ui/card';

const SEVERITY_LABELS = {
  SEV1: 'Critical',
  SEV2: 'High',
  SEV3: 'Medium',
  SEV4: 'Low',
} as const;

const SEVERITY_DOT = {
  SEV1: 'bg-sev1',
  SEV2: 'bg-sev2',
  SEV3: 'bg-sev3',
  SEV4: 'bg-sev4',
} as const;

export function IncidentsCard({
  incidents,
  alerts,
}: Pick<DashboardSnapshot, 'incidents' | 'alerts'>) {
  return (
    <Card aria-labelledby="incidents-heading" className="p-4">
      <h2 id="incidents-heading" className="text-sm font-semibold">
        Open incidents
      </h2>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{incidents.openTotal}</p>

      <ul className="mt-3 space-y-1.5 text-sm">
        {SEVERITIES.map((severity) => (
          <li key={severity} className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              {/* The dot is decorative; the severity code and name carry the meaning. */}
              <span aria-hidden className={`size-2.5 rounded-full ${SEVERITY_DOT[severity]}`} />
              <span className="font-medium">{severity}</span>
              <span className="text-muted-foreground">{SEVERITY_LABELS[severity]}</span>
            </span>
            <span className="tabular-nums">{incidents.openBySeverity[severity]}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center justify-between border-t pt-3 text-sm">
        <span className="text-muted-foreground">Active alerts</span>
        <span className="font-medium tabular-nums">{alerts.active}</span>
      </div>

      <Link href="/app/incidents" className="mt-3 inline-block text-sm text-primary underline">
        View all incidents
      </Link>
    </Card>
  );
}
