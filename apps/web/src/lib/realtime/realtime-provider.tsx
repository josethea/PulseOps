'use client';

import { SOCKET_MESSAGES, REALTIME_NAMESPACE } from '@pulseops/contracts';
import type { ReadyMessage, RealtimeEnvelope } from '@pulseops/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { FATAL_HANDSHAKE_ERRORS, affectedQueries, classify, realtimeUrl } from './events';

export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

const RealtimeContext = createContext<RealtimeStatus>('connecting');

export const useRealtimeStatus = () => useContext(RealtimeContext);

/** Invalidations are coalesced so a burst of events refetches each query once. */
const FLUSH_MS = 250;

/**
 * Keeps one authenticated socket for the current organization and turns its events into
 * cache invalidations (FR-RT-001..008). The tenant is part of the effect's dependencies,
 * so switching organization tears the old socket down before a new one opens (BR-013).
 */
export function RealtimeProvider({
  orgId,
  userId,
  children,
}: {
  orgId: string;
  userId: string;
  children: ReactNode;
}) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>('connecting');

  useEffect(() => {
    let lastSeen: number | null = null;
    let firstReady = true;
    let resyncing = false;
    const pending = new Map<string, readonly string[]>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;

    const flush = () => {
      flushTimer = undefined;
      for (const queryKey of pending.values()) void qc.invalidateQueries({ queryKey });
      pending.clear();
    };
    const schedule = (keys: (readonly string[])[]) => {
      for (const key of keys) pending.set(key.join('/'), key);
      flushTimer ??= setTimeout(flush, FLUSH_MS);
    };

    const socket = io(
      `${realtimeUrl(window.location, process.env.NEXT_PUBLIC_REALTIME_URL)}${REALTIME_NAMESPACE}`,
      {
        transports: ['websocket'],
        withCredentials: true,
        // Exponential backoff with jitter; Socket.IO's heartbeat detects dead links.
        reconnectionDelay: 1_000,
        reconnectionDelayMax: 30_000,
        randomizationFactor: 0.5,
        // Evaluated on every (re)connection so the latest cursor is sent.
        auth: (send) =>
          send({
            organizationId: orgId,
            ...(lastSeen !== null && { lastSeenSequence: lastSeen }),
          }),
      },
    );

    /** Cursor lost or expired: drop it, refetch everything, and start a fresh stream. */
    const resync = () => {
      if (resyncing) return;
      resyncing = true;
      lastSeen = null;
      firstReady = true;
      socket.disconnect();
      setStatus('connecting');
      socket.connect();
    };

    socket.on(SOCKET_MESSAGES.event, (event: RealtimeEnvelope) => {
      if (event.organizationId !== orgId) return;
      const delivery = classify(lastSeen, event.sequence);
      if (delivery === 'duplicate') return;
      if (delivery === 'gap') return resync();
      lastSeen = event.sequence;
      schedule(affectedQueries(event, orgId, userId));
    });

    socket.on(SOCKET_MESSAGES.ready, (ready: ReadyMessage) => {
      resyncing = false;
      lastSeen = Math.max(lastSeen ?? 0, ready.cursor);
      setStatus('live');
      // Data loaded before the stream started may predate it: refresh once to be safe.
      if (firstReady) {
        firstReady = false;
        void qc.invalidateQueries({ queryKey: ['org', orgId] });
      }
    });

    socket.on(SOCKET_MESSAGES.resync, resync);

    socket.on('connect_error', (error) => {
      if (FATAL_HANDSHAKE_ERRORS.includes(error.message)) {
        socket.disconnect(); // refused for good: no retry loop
        setStatus('offline');
      } else {
        setStatus('reconnecting');
      }
    });

    socket.on('disconnect', (reason) => {
      if (resyncing) return;
      // The server only hangs up deliberately when access was revoked.
      setStatus(reason === 'io server disconnect' ? 'offline' : 'reconnecting');
    });

    return () => {
      clearTimeout(flushTimer);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [orgId, userId, qc]);

  const value = useMemo(() => status, [status]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
