'use client';

import type {
  AlertPage,
  AlertRule,
  AlertState,
  CreateAlertRuleRequest,
  Severity,
  UpdateAlertRuleRequest,
} from '@pulseops/contracts';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api-client';

// Keys start with ['org', orgId, ...] so realtime events and tenant switches can target them.
export const alertKeys = {
  list: (orgId: string, state?: AlertState, severity?: Severity) =>
    ['org', orgId, 'alerts', 'list', state ?? null, severity ?? null] as const,
  rules: (orgId: string) => ['org', orgId, 'alert-rules'] as const,
};

export function useAlerts(orgId: string, state?: AlertState, severity?: Severity) {
  return useInfiniteQuery({
    queryKey: alertKeys.list(orgId, state, severity),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiGet<AlertPage>(
        `/organizations/${orgId}/alerts`,
        { state, severity, cursor: pageParam, limit: '25' },
        signal,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useAlertRules(orgId: string) {
  return useQuery({
    queryKey: alertKeys.rules(orgId),
    queryFn: ({ signal }) => apiGet<AlertRule[]>(`/organizations/${orgId}/alert-rules`, {}, signal),
  });
}

/** The latest rule carried by a 409 version-conflict response, if that is what this is. */
export function ruleConflictOf(error: unknown): AlertRule | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const details = error.details as { reason?: string; current?: AlertRule } | undefined;
  return details?.reason === 'VERSION_CONFLICT' && details.current ? details.current : null;
}

export function useCreateRule(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAlertRuleRequest) =>
      apiPost<AlertRule>(`/organizations/${orgId}/alert-rules`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: alertKeys.rules(orgId) }),
  });
}

export function useUpdateRule(orgId: string, ruleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateAlertRuleRequest) =>
      apiPatch<AlertRule>(`/organizations/${orgId}/alert-rules/${ruleId}`, input),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: alertKeys.rules(orgId) });
      void qc.invalidateQueries({ queryKey: ['org', orgId, 'alerts'] });
    },
  });
}
