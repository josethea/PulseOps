/**
 * Deterministic demo content shared by the seed and the demo reset: alert rules and the
 * historical incident backlog. Each organization draws from its own random stream, so
 * regenerating one tenant reproduces exactly what the seed created for it.
 */
import { REGIONS } from '@pulseops/contracts';

import type { IncidentStatus, Prisma, Severity } from '../generated/prisma/client.js';
import { createRng } from './prng.js';

export const SEED = 20261104;

/** Incidents in the demo tenant's backlog (spec 9.4: >= 10,000 for the table and filters). */
export const DEMO_INCIDENT_COUNT = 10_000;

export interface DemoOrgSpec {
  id: string;
  slug: string;
  services: { id: string; slug: string }[];
  incidentCount: number;
  /** Membership user that owns the seeded alert rules. */
  createdById: string;
}

export interface Responder {
  id: string;
}

function incidentSeed(slug: string): number {
  let hash = SEED;
  for (let i = 0; i < slug.length; i++) hash = Math.imul(hash ^ slug.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

const SYMPTOMS = [
  'Elevated error rate',
  'High latency',
  'Timeouts on upstream calls',
  'Degraded throughput',
  'Queue backlog growing',
  'Failed health checks',
  'Intermittent 5xx responses',
  'Connection pool exhausted',
];

export function buildAlertRules(org: DemoOrgSpec): Prisma.AlertRuleCreateManyInput[] {
  const templates = [
    {
      suffix: 'error rate high',
      metricKey: 'error_rate',
      operator: 'GT',
      threshold: 5,
      windowSeconds: 300,
      severity: 'SEV2',
    },
    {
      suffix: 'error rate critical',
      metricKey: 'error_rate',
      operator: 'GT',
      threshold: 20,
      windowSeconds: 120,
      severity: 'SEV1',
    },
    {
      suffix: 'p95 latency high',
      metricKey: 'latency_p95',
      operator: 'GT',
      threshold: 800,
      windowSeconds: 300,
      severity: 'SEV3',
    },
    {
      suffix: 'availability low',
      metricKey: 'availability',
      operator: 'LT',
      threshold: 99,
      windowSeconds: 600,
      severity: 'SEV3',
    },
  ] as const;

  return org.services.flatMap((service) =>
    templates.map((t) => ({
      id: `rule_${service.id}_${t.metricKey}_${t.threshold}`,
      organizationId: org.id,
      name: `${service.slug}: ${t.suffix}`,
      serviceId: service.id,
      metricKey: t.metricKey,
      operator: t.operator,
      threshold: t.threshold,
      windowSeconds: t.windowSeconds,
      cooldownSeconds: 600,
      severity: t.severity,
      createdBy: org.createdById,
    })),
  );
}

export function buildIncidents(org: DemoOrgSpec, responders: Responder[]) {
  const rng = createRng(incidentSeed(org.slug));
  const now = Date.now();
  const minute = 60_000;
  const day = 24 * 60 * minute;
  const incidents: Prisma.IncidentCreateManyInput[] = [];
  const events: Prisma.IncidentEventCreateManyInput[] = [];

  for (let i = 1; i <= org.incidentCount; i++) {
    const service = rng.pick(org.services);
    const region = rng.pick(REGIONS);
    const severity: Severity = rng.weighted([
      ['SEV1', 5],
      ['SEV2', 20],
      ['SEV3', 40],
      ['SEV4', 35],
    ]);
    const ageMs = Math.floor(rng.next() * 90 * day);
    const createdAt = new Date(now - ageMs);
    const creator = rng.pick(responders);

    // Older incidents are almost always resolved; recent ones can still be in flight.
    const status: IncidentStatus =
      ageMs > 7 * day
        ? rng.weighted([
            ['RESOLVED', 97],
            ['INVESTIGATING', 3],
          ])
        : rng.weighted([
            ['RESOLVED', 70],
            ['INVESTIGATING', 12],
            ['ACKNOWLEDGED', 8],
            ['OPEN', 10],
          ]);

    const assignee = status === 'OPEN' && rng.next() < 0.6 ? null : rng.pick(responders);
    const acknowledgedAt =
      status === 'OPEN' ? null : new Date(createdAt.getTime() + rng.int(1, 30) * minute);
    const resolvedAt =
      status === 'RESOLVED' && acknowledgedAt
        ? new Date(acknowledgedAt.getTime() + rng.int(10, 360) * minute)
        : null;

    const id = `inc_${org.slug}_${i}`;
    const actorId = assignee?.id ?? creator.id;
    const transitions = { OPEN: 0, ACKNOWLEDGED: 1, INVESTIGATING: 2, RESOLVED: 3 }[status];

    incidents.push({
      id,
      organizationId: org.id,
      serviceId: service.id,
      region,
      title: `${rng.pick(SYMPTOMS)} on ${service.slug} (${region})`,
      description: `Synthetic incident #${i} generated for the PulseOps demo dataset.`,
      severity,
      status,
      assigneeId: assignee?.id ?? null,
      createdBy: creator.id,
      createdAt,
      acknowledgedAt,
      resolvedAt,
      version: 1 + transitions + (assignee ? 1 : 0),
      updatedAt: resolvedAt ?? acknowledgedAt ?? createdAt,
    });

    const base = { organizationId: org.id, incidentId: id };
    events.push({
      ...base,
      actorId: creator.id,
      action: 'incident.created',
      occurredAt: createdAt,
      afterJson: { status: 'OPEN', severity },
    });
    if (assignee) {
      events.push({
        ...base,
        actorId: creator.id,
        action: 'incident.assigned',
        occurredAt: createdAt,
        afterJson: { assigneeId: assignee.id },
      });
    }
    if (acknowledgedAt) {
      events.push({
        ...base,
        actorId,
        action: 'incident.acknowledged',
        occurredAt: acknowledgedAt,
        beforeJson: { status: 'OPEN' },
        afterJson: { status: 'ACKNOWLEDGED' },
      });
    }
    if (status === 'INVESTIGATING' || status === 'RESOLVED') {
      const at = new Date((acknowledgedAt as Date).getTime() + 2 * minute);
      events.push({
        ...base,
        actorId,
        action: 'incident.investigating',
        occurredAt: at,
        beforeJson: { status: 'ACKNOWLEDGED' },
        afterJson: { status: 'INVESTIGATING' },
      });
    }
    if (resolvedAt) {
      events.push({
        ...base,
        actorId,
        action: 'incident.resolved',
        occurredAt: resolvedAt,
        beforeJson: { status: 'INVESTIGATING' },
        afterJson: { status: 'RESOLVED', reason: 'Recovered after mitigation' },
      });
    }
  }
  return { incidents, events };
}
