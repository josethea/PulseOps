/**
 * Deterministic demo dataset (spec 9.4, 18). Idempotent: it removes the seeded
 * organizations and users, then recreates them. All names and emails are fictional;
 * emails use the reserved `.test` TLD.
 *
 *   pnpm --filter @pulseops/api db:seed
 */
import { PrismaPg } from '@prisma/adapter-pg';

import { hashPassword } from '../auth/password.js';
import { loadEnv } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Role } from '../generated/prisma/client.js';
import { DEMO_INCIDENT_COUNT, SEED, buildAlertRules, buildIncidents } from './demo-data.js';
import { buildMetricAggregates, insertMetricAggregates } from './metrics-seed.js';
import { createRng } from './prng.js';
import type { Rng } from './prng.js';

const DEFAULT_PASSWORD = 'pulseops-demo-123';
const CHUNK = 5000;

const FIRST_NAMES = [
  'Ana',
  'Luis',
  'Marta',
  'Diego',
  'Lucia',
  'Pedro',
  'Sofia',
  'Carlos',
  'Elena',
  'Jorge',
  'Valeria',
  'Mateo',
  'Camila',
  'Andres',
  'Paula',
];
const LAST_NAMES = [
  'Quispe',
  'Rojas',
  'Flores',
  'Vargas',
  'Mendoza',
  'Salazar',
  'Paredes',
  'Huaman',
  'Cardenas',
  'Torres',
  'Delgado',
  'Ramos',
  'Castillo',
  'Soto',
  'Aguilar',
];

const METRICS = [
  {
    key: 'orders_per_minute',
    unit: 'orders/min',
    aggregationType: 'SUM',
    description: 'Orders received per minute',
  },
  { key: 'error_rate', unit: '%', aggregationType: 'AVG', description: 'Share of failed requests' },
  { key: 'latency_p50', unit: 'ms', aggregationType: 'AVG', description: 'Median request latency' },
  {
    key: 'latency_p95',
    unit: 'ms',
    aggregationType: 'AVG',
    description: '95th percentile request latency',
  },
  {
    key: 'latency_p99',
    unit: 'ms',
    aggregationType: 'AVG',
    description: '99th percentile request latency',
  },
  {
    key: 'availability',
    unit: '%',
    aggregationType: 'AVG',
    description: 'Estimated service availability',
  },
  {
    key: 'orders_completed',
    unit: 'orders',
    aggregationType: 'SUM',
    description: 'Orders completed',
  },
  { key: 'orders_failed', unit: 'orders', aggregationType: 'SUM', description: 'Orders failed' },
  { key: 'orders_delayed', unit: 'orders', aggregationType: 'SUM', description: 'Orders delayed' },
] as const;

const DEMO_SERVICES = [
  ['svc_checkout', 'checkout-api'],
  ['svc_orders', 'orders-service'],
  ['svc_dispatch', 'dispatch-service'],
  ['svc_payments', 'payments-adapter'],
  ['svc_notifications', 'notifications-service'],
] as const;

type SeedUser = { id: string; email: string; displayName: string; role: Role };

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed with NODE_ENV=production');
  }
  const env = loadEnv();
  const password = process.env.SEED_PASSWORD ?? DEFAULT_PASSWORD;
  const passwordHash = await hashPassword(password);
  const rng = createRng(SEED);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });

  try {
    console.log('Resetting seeded data...');
    await prisma.organization.deleteMany({ where: { id: { in: ['org_demo', 'org_acme'] } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: '.pulseops.test' } } });

    await prisma.metricDefinition.createMany({
      data: METRICS.map((m) => ({ ...m })),
      skipDuplicates: true,
    });

    const demoUsers = buildDemoUsers(rng);
    const acmeUsers = buildAcmeUsers();
    await prisma.user.createMany({
      data: [...demoUsers, ...acmeUsers].map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        passwordHash,
      })),
    });

    // The demo operator also belongs to the second tenant as a viewer (multi-membership, UC-02).
    const demoOperator = demoUsers.find((u) => u.id === 'usr_operator')!;
    await seedOrganization(prisma, {
      id: 'org_demo',
      name: 'Demo Delivery Co.',
      slug: 'demo',
      timezone: 'America/Lima',
      isDemo: true,
      users: demoUsers,
      extraMembers: [],
      services: DEMO_SERVICES.map(([id, slug]) => ({ id, slug })),
      incidentCount: DEMO_INCIDENT_COUNT,
      createdById: 'usr_admin',
    });
    await seedOrganization(prisma, {
      id: 'org_acme',
      name: 'Acme Logistics',
      slug: 'acme',
      timezone: 'UTC',
      isDemo: false,
      users: acmeUsers,
      extraMembers: [{ ...demoOperator, role: 'VIEWER' }],
      services: [
        { id: 'svc_acme_gateway', slug: 'api-gateway' },
        { id: 'svc_acme_billing', slug: 'billing-sync' },
      ],
      incidentCount: 150,
      createdById: 'usr_acme_admin',
    });

    console.log('Seed complete.');
  } finally {
    await prisma.$disconnect();
  }
}

function buildDemoUsers(rng: Rng): SeedUser[] {
  const users: SeedUser[] = [
    {
      id: 'usr_admin',
      email: 'admin@demo.pulseops.test',
      displayName: 'Demo Admin',
      role: 'ORG_ADMIN',
    },
    {
      id: 'usr_operator',
      email: 'operator@demo.pulseops.test',
      displayName: 'Demo Operator',
      role: 'OPERATOR',
    },
    {
      id: 'usr_analyst',
      email: 'analyst@demo.pulseops.test',
      displayName: 'Demo Analyst',
      role: 'ANALYST',
    },
    {
      id: 'usr_viewer',
      email: 'viewer@demo.pulseops.test',
      displayName: 'Demo Viewer',
      role: 'VIEWER',
    },
  ];
  const roleCycle: Role[] = ['OPERATOR', 'OPERATOR', 'ANALYST', 'VIEWER', 'OPERATOR', 'ORG_ADMIN'];
  for (let i = users.length; i < 30; i++) {
    const first = rng.pick(FIRST_NAMES);
    const last = rng.pick(LAST_NAMES);
    users.push({
      id: `usr_${i + 1}`,
      email: `${first}.${last}${i + 1}@demo.pulseops.test`.toLowerCase(),
      displayName: `${first} ${last}`,
      role: roleCycle[i % roleCycle.length]!,
    });
  }
  return users;
}

function buildAcmeUsers(): SeedUser[] {
  return [
    {
      id: 'usr_acme_admin',
      email: 'admin@acme.pulseops.test',
      displayName: 'Acme Admin',
      role: 'ORG_ADMIN',
    },
    {
      id: 'usr_acme_operator',
      email: 'operator@acme.pulseops.test',
      displayName: 'Acme Operator',
      role: 'OPERATOR',
    },
    {
      id: 'usr_acme_analyst',
      email: 'analyst@acme.pulseops.test',
      displayName: 'Acme Analyst',
      role: 'ANALYST',
    },
    {
      id: 'usr_acme_viewer',
      email: 'viewer@acme.pulseops.test',
      displayName: 'Acme Viewer',
      role: 'VIEWER',
    },
  ];
}

interface OrgSpec {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  isDemo: boolean;
  users: SeedUser[];
  extraMembers: SeedUser[];
  services: { id: string; slug: string }[];
  incidentCount: number;
  createdById: string;
}

async function seedOrganization(prisma: PrismaClient, org: OrgSpec) {
  console.log(`Seeding ${org.slug}...`);
  await prisma.organization.create({
    data: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      timezone: org.timezone,
      isDemo: org.isDemo,
      eventSequence: { create: {} },
    },
  });

  const members = [...org.users, ...org.extraMembers];
  await prisma.membership.createMany({
    data: members.map((u) => ({
      id: `mem_${org.slug}_${u.id}`,
      organizationId: org.id,
      userId: u.id,
      role: u.role,
    })),
  });

  await prisma.service.createMany({
    data: org.services.map((s) => ({
      id: s.id,
      organizationId: org.id,
      name: s.slug,
      slug: s.slug,
      region: 'GLOBAL',
    })),
  });

  await prisma.alertRule.createMany({ data: buildAlertRules(org) });

  const aggregates = buildMetricAggregates(org.id, org.services, new Date());
  await insertMetricAggregates(prisma, aggregates);
  console.log(`  ${aggregates.length} metric aggregates`);

  // Sorted by id so the demo reset, which reads responders back from the database,
  // draws the same backlog as the seed.
  const responders = members
    .filter((u) => u.role === 'OPERATOR' || u.role === 'ORG_ADMIN')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const { incidents, events } = buildIncidents(org, responders);
  for (let i = 0; i < incidents.length; i += CHUNK) {
    await prisma.incident.createMany({ data: incidents.slice(i, i + CHUNK) });
  }
  for (let i = 0; i < events.length; i += CHUNK) {
    await prisma.incidentEvent.createMany({ data: events.slice(i, i + CHUNK) });
  }
  console.log(
    `  ${members.length} members, ${org.services.length} services, ${incidents.length} incidents`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
