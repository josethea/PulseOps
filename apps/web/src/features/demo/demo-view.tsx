'use client';

import { REGIONS, SCENARIO_DURATION_MINUTES } from '@pulseops/contracts';
import type { DemoScenario, ScenarioKind } from '@pulseops/contracts';
import { FlaskConical, RotateCcw, Square, Zap } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ErrorState } from '@/components/states';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatInstant } from '@/features/dashboard/format';
import {
  demoErrorMessage,
  useCancelScenario,
  useDemoServices,
  useDemoStatus,
  useResetDemo,
  useStartScenario,
} from './api';

const KIND_COPY: Record<ScenarioKind, { label: string; hint: string }> = {
  OUTAGE: { label: 'Outage', hint: 'Errors above 20% and latency several times higher.' },
  DEGRADED: { label: 'Degraded', hint: 'Errors between 3% and 8% and slower responses.' },
};

/** Seconds left until `iso`, ticking once a second; null while idle. */
function useCountdown(iso: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [iso]);
  return iso ? Math.max(0, Math.round((Date.parse(iso) - now) / 1000)) : null;
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export function DemoView({
  orgId,
  timezone,
  canReset,
}: {
  orgId: string;
  timezone: string;
  canReset: boolean;
}) {
  const status = useDemoStatus(orgId);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Demo</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Inject a synthetic production incident and follow it through the dashboard, alerts and
          incident management. Everything here is generated data: no real systems are involved.
        </p>
      </header>

      {status.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : status.isError ? (
        <ErrorState error={status.error} onRetry={() => void status.refetch()} />
      ) : !status.data.enabled ? (
        <Card className="p-5 text-sm text-muted-foreground">
          The simulator is only available in the demo organization.
        </Card>
      ) : (
        <>
          {status.data.active ? (
            <ActiveSimulation orgId={orgId} timezone={timezone} scenario={status.data.active} />
          ) : (
            <StartForm orgId={orgId} quota={status.data.quota} timezone={timezone} />
          )}
          <Guide />
          <Recent scenarios={status.data.recent} timezone={timezone} />
          {canReset && (
            <ResetCard
              orgId={orgId}
              availableAt={status.data.reset.availableAt}
              timezone={timezone}
            />
          )}
        </>
      )}
    </div>
  );
}

function StartForm({
  orgId,
  quota,
  timezone,
}: {
  orgId: string;
  quota: { limit: number; used: number; nextSlotAt: string | null };
  timezone: string;
}) {
  const services = useDemoServices(orgId);
  const start = useStartScenario(orgId);
  const [kind, setKind] = useState<ScenarioKind>('OUTAGE');
  const [serviceId, setServiceId] = useState('');
  const [region, setRegion] = useState('LIM');
  const [duration, setDuration] = useState<number>(SCENARIO_DURATION_MINUTES.default);

  const exhausted = quota.used >= quota.limit;

  return (
    <Card className="space-y-5 p-5">
      <div className="flex items-start gap-3">
        <FlaskConical className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div>
          <h2 className="font-semibold">Simulate Production Incident</h2>
          <p className="text-sm text-muted-foreground">
            Defaults reproduce the headline scenario: an outage on checkout-api in LIM.
          </p>
        </div>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Severity of the failure</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(KIND_COPY) as ScenarioKind[]).map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring"
            >
              <input
                type="radio"
                name="kind"
                value={option}
                checked={kind === option}
                onChange={() => setKind(option)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium">{KIND_COPY[option].label}</span>
                <span className="block text-xs text-muted-foreground">
                  {KIND_COPY[option].hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor="sim-service" className="text-sm font-medium">
            Service
          </label>
          <Select
            id="sim-service"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            disabled={services.isPending}
          >
            <option value="">checkout-api (default)</option>
            {services.data?.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="sim-region" className="text-sm font-medium">
            Region
          </label>
          <Select id="sim-region" value={region} onChange={(e) => setRegion(e.target.value)}>
            {REGIONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="sim-duration" className="text-sm font-medium">
            Duration
          </label>
          <Select
            id="sim-duration"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          >
            {[5, 10, 15, 20, 30].map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} minutes
              </option>
            ))}
          </Select>
        </div>
      </div>

      {start.isError && (
        <p role="alert" className="text-sm text-sev1">
          {demoErrorMessage(start.error, timezone)}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={exhausted || start.isPending}
          onClick={() =>
            start.mutate({
              kind,
              region: region as (typeof REGIONS)[number],
              durationMinutes: duration,
              ...(serviceId && { serviceId }),
            })
          }
        >
          <Zap className="size-4" aria-hidden />
          {start.isPending ? 'Starting…' : 'Start simulation'}
        </Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {quota.used} of {quota.limit} simulations used this hour
          {exhausted && quota.nextSlotAt
            ? ` · next slot at ${formatInstant(quota.nextSlotAt, timezone, false).slice(0, 5)}`
            : ''}
        </p>
      </div>
    </Card>
  );
}

function ActiveSimulation({
  orgId,
  timezone,
  scenario,
}: {
  orgId: string;
  timezone: string;
  scenario: DemoScenario;
}) {
  const cancel = useCancelScenario(orgId);
  const left = useCountdown(scenario.endsAt);

  return (
    <Card className="space-y-4 border-sev2 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <span className="size-2 animate-pulse rounded-full bg-sev2" aria-hidden />
            {KIND_COPY[scenario.kind].label} running on {scenario.serviceName} · {scenario.region}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Started {formatInstant(scenario.startedAt, timezone, false)}
            {scenario.startedByName ? ` by ${scenario.startedByName}` : ''}. Ends at{' '}
            {formatInstant(scenario.endsAt, timezone, false)}.
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold tabular-nums" role="timer" aria-label="Time left">
            {left === null ? '—' : clock(left)}
          </p>
          <p className="text-xs text-muted-foreground">left</p>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Alert rules look at completed minutes, so the first alerts usually fire one to three minutes
        in. Open the pages below, ideally in a second session, and watch them update.
      </p>

      <div className="flex flex-wrap gap-2">
        <Link href="/app/dashboard" className={buttonVariants({ variant: 'outline' })}>
          Dashboard
        </Link>
        <Link href="/app/alerts" className={buttonVariants({ variant: 'outline' })}>
          Alerts
        </Link>
        <Link href="/app/incidents" className={buttonVariants({ variant: 'outline' })}>
          Incidents
        </Link>
        <Button
          variant="outline"
          className="ml-auto"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate(scenario.id)}
        >
          <Square className="size-4" aria-hidden />
          Stop simulation
        </Button>
      </div>
      {cancel.isError && (
        <p role="alert" className="text-sm text-sev1">
          {demoErrorMessage(cancel.error, timezone)}
        </p>
      )}
    </Card>
  );
}

function Guide() {
  const steps = [
    ['Start a simulation', 'Pick the failure and let the telemetry degrade.'],
    ['Watch it surface', 'The dashboard turns red and an alert fires once the window fills.'],
    ['Work the incident', 'Open an incident, assign it, acknowledge, investigate and resolve.'],
  ];
  return (
    <Card className="p-5">
      <h2 className="font-semibold">How the demo works</h2>
      <ol className="mt-3 grid gap-4 sm:grid-cols-3">
        {steps.map(([title, body], index) => (
          <li key={title} className="flex gap-3">
            <span
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
              aria-hidden
            >
              {index + 1}
            </span>
            <div>
              <p className="text-sm font-medium">{title}</p>
              <p className="text-sm text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-muted-foreground">
        Tip: sign in as an Operator in one window and as an Analyst in another to see changes arrive
        on both sides in real time.
      </p>
    </Card>
  );
}

const STATUS_LABEL: Record<DemoScenario['status'], string> = {
  RUNNING: 'Running',
  FINISHED: 'Finished',
  CANCELLED: 'Stopped',
};

function Recent({ scenarios, timezone }: { scenarios: DemoScenario[]; timezone: string }) {
  if (scenarios.length === 0) return null;
  return (
    <Card className="overflow-hidden">
      <h2 className="border-b px-5 py-3 font-semibold">Recent simulations</h2>
      <ul className="divide-y">
        {scenarios.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
            <div>
              <p className="text-sm font-medium">
                {KIND_COPY[s.kind].label} · {s.serviceName} · {s.region}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatInstant(s.startedAt, timezone, true)}
                {s.startedByName ? ` · ${s.startedByName}` : ''}
              </p>
            </div>
            <span className="rounded-full border px-2 py-0.5 text-xs">
              {STATUS_LABEL[s.status]}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ResetCard({
  orgId,
  availableAt,
  timezone,
}: {
  orgId: string;
  availableAt: string | null;
  timezone: string;
}) {
  const reset = useResetDemo(orgId);
  const [open, setOpen] = useState(false);
  const wait = useCountdown(availableAt);
  const cooling = wait !== null && wait > 0;

  return (
    <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
      <div>
        <h2 className="font-semibold">Restore the demo</h2>
        <p className="text-sm text-muted-foreground">
          Removes incidents, alerts and notifications created during the demo and brings the dataset
          back to its starting point. Other organizations are not affected.
        </p>
      </div>
      <Button variant="outline" disabled={reset.isPending || cooling} onClick={() => setOpen(true)}>
        <RotateCcw className="size-4" aria-hidden />
        {cooling ? `Available in ${clock(wait)}` : reset.isPending ? 'Restoring…' : 'Reset demo'}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Reset the demo?"
        description="This permanently deletes everything created since the last reset. It takes a few seconds."
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setOpen(false);
              reset.mutate();
            }}
          >
            Reset demo
          </Button>
        </div>
      </Dialog>

      {reset.isError && (
        <p role="alert" className="w-full text-sm text-sev1">
          {demoErrorMessage(reset.error, timezone)}
        </p>
      )}
      {reset.isSuccess && (
        <p role="status" className="w-full text-sm text-muted-foreground">
          Demo restored: {reset.data.incidents.toLocaleString('en-US')} incidents and{' '}
          {reset.data.alertRules} alert rules are back to their starting state.
        </p>
      )}
    </Card>
  );
}
