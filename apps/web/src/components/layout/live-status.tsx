'use client';

import { Radio, WifiOff } from 'lucide-react';

import { useRealtimeStatus } from '@/lib/realtime/realtime-provider';
import type { RealtimeStatus } from '@/lib/realtime/realtime-provider';

const COPY: Record<RealtimeStatus, { text: string; hint: string }> = {
  connecting: { text: 'Connecting…', hint: 'Opening the live channel' },
  live: { text: 'Live', hint: 'Changes appear as they happen' },
  reconnecting: { text: 'Reconnecting…', hint: 'Showing the last known data; retrying' },
  offline: { text: 'Offline', hint: 'Live updates are off; data refreshes periodically' },
};

/** Connection state is always spelled out, never conveyed by color alone. */
export function LiveStatus() {
  const status = useRealtimeStatus();
  const { text, hint } = COPY[status];
  const Icon = status === 'live' || status === 'connecting' ? Radio : WifiOff;
  return (
    <span
      role="status"
      title={hint}
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      <Icon className={`size-3.5 ${status === 'live' ? 'text-foreground' : ''}`} aria-hidden />
      {text}
    </span>
  );
}
