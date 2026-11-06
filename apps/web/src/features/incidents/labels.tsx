import type { Incident, IncidentStatus, IncidentTransition, Severity } from '@pulseops/contracts';
import { CheckCircle2, CircleDot, Eye, Search } from 'lucide-react';

export const SEVERITY_LABELS: Record<Severity, string> = {
  SEV1: 'Critical',
  SEV2: 'High',
  SEV3: 'Medium',
  SEV4: 'Low',
};

const SEVERITY_DOT: Record<Severity, string> = {
  SEV1: 'bg-sev1',
  SEV2: 'bg-sev2',
  SEV3: 'bg-sev3',
  SEV4: 'bg-sev4',
};

export const STATUS_LABELS: Record<IncidentStatus, string> = {
  OPEN: 'Open',
  ACKNOWLEDGED: 'Acknowledged',
  INVESTIGATING: 'Investigating',
  RESOLVED: 'Resolved',
};

const STATUS_ICON = {
  OPEN: CircleDot,
  ACKNOWLEDGED: Eye,
  INVESTIGATING: Search,
  RESOLVED: CheckCircle2,
} satisfies Record<IncidentStatus, unknown>;

export const TRANSITION_LABELS: Record<IncidentTransition, string> = {
  acknowledge: 'Acknowledge',
  investigate: 'Start investigating',
  resolve: 'Resolve',
  reopen: 'Reopen',
};

/** Severity is always conveyed by code and name; the dot only reinforces it (UX-020). */
export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span aria-hidden className={`size-2.5 rounded-full ${SEVERITY_DOT[severity]}`} />
      <span className="font-medium">{severity}</span>
      <span className="text-muted-foreground">{SEVERITY_LABELS[severity]}</span>
    </span>
  );
}

export function StatusBadge({ status }: { status: IncidentStatus }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  );
}

export type { Incident };
