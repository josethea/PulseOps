# PulseOps

Real-time, multi-tenant operations command center (portfolio project).
Full specification: `PulseOps_Requerimientos_Especificacion_Tecnica.txt`.

## Requirements

- Node.js >= 24
- pnpm 9 (`corepack enable`)
- Docker (local PostgreSQL and Redis)

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm infra:up
pnpm --filter @pulseops/api db:migrate
pnpm --filter @pulseops/api db:seed
pnpm dev
```

Local PostgreSQL and Redis run on ports 5433 and 6380 so they do not clash with services
already installed on your machine.

- Web: http://localhost:3000
- API: http://localhost:4000 (OpenAPI docs at /docs, health at /health/live)

## Structure

- `apps/` — web (Next.js) and api (NestJS; it also runs the telemetry simulator)
- `packages/` — config, contracts, ui, utils
- `infra/` — Docker Compose and scripts
- `docs/` — architecture, ADRs, realtime protocol

## Demo accounts

The seed creates a deterministic demo dataset (30 users, 5 services, 20 alert rules and
10,000 incidents in `Demo Delivery Co.`, plus a second tenant, `Acme Logistics`, used to
verify tenant isolation). The login page has a **Try the live demo** section that signs you
in as any role without credentials. To sign in with a password, use
`<role>@demo.pulseops.test` (`admin`, `operator`, `analyst`, `viewer`); the shared seed
password is `SEED_PASSWORD` in `.env.example`.

## Demo simulator

While the API runs, a background worker keeps every tenant's telemetry current (a new
minute of synthetic data every minute, deterministic per series). The **Demo** page
(`/app/demo`) lets any role start a _Simulate Production Incident_ scenario: an outage or
degradation on one service and region, for 5 to 30 minutes. The dashboard turns red,
alert rules fire after their window fills, and the incident can be worked end to end,
ideally from two sessions (for example Operator and Analyst) to see changes arrive live.

- Simulations only run in the demo tenant, one at a time, up to `DEMO_SCENARIOS_PER_HOUR`
  per hour (default 6).
- Operators and admins can **reset the demo**: incidents, alerts, notifications and altered
  telemetry created during the demo are removed and the seeded backlog and alert rules are
  regenerated. Other tenants are never touched. Resets are spaced by
  `DEMO_RESET_COOLDOWN_SECONDS` (default 60).
- Endpoints: `GET /organizations/:orgId/demo/status`, `POST .../demo/scenarios`,
  `POST .../demo/scenarios/:id/cancel`, `POST .../demo/reset`.
- All of it is synthetic: no real systems are involved.

> Status: Phase 1 (foundations) in progress: monorepo, web, API, data model and auth are done.
