'use client';

import type { AppNotification, NotificationPage } from '@pulseops/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiPost } from '@/lib/api-client';

export const notificationKeys = {
  list: (orgId: string, unreadOnly: boolean) =>
    ['org', orgId, 'notifications', 'list', unreadOnly] as const,
  count: (orgId: string) => ['org', orgId, 'notifications', 'count'] as const,
};

export function useNotifications(orgId: string, unreadOnly: boolean) {
  return useInfiniteQuery({
    queryKey: notificationKeys.list(orgId, unreadOnly),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiGet<NotificationPage>(
        `/organizations/${orgId}/notifications`,
        { unreadOnly: String(unreadOnly), cursor: pageParam, limit: '30' },
        signal,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Cheap query for the bell: one item is enough, the page carries the unread total. */
export function useUnreadCount(orgId: string) {
  return useQuery({
    queryKey: notificationKeys.count(orgId),
    queryFn: async ({ signal }) =>
      (
        await apiGet<NotificationPage>(
          `/organizations/${orgId}/notifications`,
          { limit: '1' },
          signal,
        )
      ).unreadCount,
    refetchInterval: 60_000, // fallback while the socket is down
  });
}

export function useMarkRead(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiPost<AppNotification>(`/organizations/${orgId}/notifications/${id}/read`, {}),
    onSettled: () => qc.invalidateQueries({ queryKey: ['org', orgId, 'notifications'] }),
  });
}

export function useMarkAllRead(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiPost<{ updated: number }>(`/organizations/${orgId}/notifications/read-all`, {}),
    onSettled: () => qc.invalidateQueries({ queryKey: ['org', orgId, 'notifications'] }),
  });
}
