'use client';

import type { DashboardSnapshot } from '@pulseops/contracts';
import { formatDistanceToNowStrict } from 'date-fns';
import { Clock, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
import { formatInstant } from './format';

/** Data older than this is flagged as stale. */
export const STALE_AFTER_SECONDS = 120;

/** Re-renders on an interval so relative ages keep moving between refetches. */
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

interface Props {
  freshness: DashboardSnapshot['freshness'];
  timezone: string;
  isFetching: boolean;
  fetchFailed: boolean;
}

export function Freshness({ freshness, timezone, isFetching, fetchFailed }: Props) {
  const now = useNow(5_000);
  const latest = freshness.latestBucketAt;
  const ageSeconds = latest ? Math.max(0, Math.round((now - Date.parse(latest)) / 1000)) : null;
  const stale = ageSeconds === null || ageSeconds > STALE_AFTER_SECONDS;

  return (
    <div className="space-y-2">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Clock className="size-4" aria-hidden />
          {latest ? (
            <>
              Data as of {formatInstant(latest, timezone, false)} ({timezone}) ·{' '}
              {formatDistanceToNowStrict(Date.parse(latest), { addSuffix: true })}
            </>
          ) : (
            'No data received yet'
          )}
        </span>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-xs font-medium',
            stale ? 'border-sev2 text-sev2' : 'text-muted-foreground',
          )}
        >
          {stale ? 'Stale' : isFetching ? 'Updating…' : 'Live'}
        </span>
      </p>

      {(stale || fetchFailed) && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-sev2 p-3 text-sm"
        >
          <WifiOff className="mt-0.5 size-4 shrink-0 text-sev2" aria-hidden />
          <p>
            {fetchFailed
              ? 'Could not refresh the dashboard. Showing the last data we received.'
              : latest
                ? `The newest data point is ${formatDistanceToNowStrict(Date.parse(latest))} old. Values may not reflect the current state.`
                : 'No metrics have been ingested for this organization yet.'}
          </p>
        </div>
      )}
    </div>
  );
}
