'use client';

import type { AppNotification } from '@pulseops/contracts';
import { BellRing, Flame } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { EmptyState, ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatInstant } from '@/features/dashboard/format';
import { useMarkAllRead, useMarkRead, useNotifications } from './api';

/** Where a notification leads: its incident, or the alerts page. */
function targetOf(n: AppNotification): string {
  return n.referenceType === 'incident' && n.referenceId
    ? `/app/incidents/${n.referenceId}`
    : '/app/alerts';
}

export function NotificationsView({ orgId, timezone }: { orgId: string; timezone: string }) {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useNotifications(orgId, unreadOnly);
  const markRead = useMarkRead(orgId);
  const markAll = useMarkAllRead(orgId);

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = list.data?.pages[0]?.unreadCount ?? 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
            {list.isPending ? 'Loading…' : `${unread} unread`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            aria-pressed={unreadOnly}
            onClick={() => setUnreadOnly((value) => !value)}
          >
            {unreadOnly ? 'Showing unread' : 'Show unread only'}
          </Button>
          <Button
            variant="outline"
            disabled={unread === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            Mark all as read
          </Button>
        </div>
      </header>

      <Card className="overflow-hidden">
        {list.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={unreadOnly ? 'You are all caught up' : 'No notifications yet'}
            hint="Alerts and incident assignments will show up here."
          />
        ) : (
          <ul className="divide-y">
            {items.map((n) => {
              const Icon = n.type === 'ALERT' ? BellRing : Flame;
              return (
                <li key={n.id} className="flex items-start gap-3 px-4 py-3">
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={targetOf(n)}
                      onClick={() => !n.readAt && markRead.mutate(n.id)}
                      className={`text-sm hover:underline ${n.readAt ? '' : 'font-semibold'}`}
                    >
                      {n.title}
                      {!n.readAt && <span className="sr-only"> (unread)</span>}
                    </Link>
                    <p className="text-sm text-muted-foreground">{n.body}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatInstant(n.createdAt, timezone, true)}
                    </p>
                  </div>
                  {!n.readAt && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => markRead.mutate(n.id)}
                      aria-label={`Mark "${n.title}" as read`}
                    >
                      Mark read
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
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
