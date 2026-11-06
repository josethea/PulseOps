'use client';

import type {
  AssigneeOption,
  CreateIncidentRequest,
  Incident,
  IncidentEvent,
  IncidentPage,
  Role,
  ServiceSummary,
} from '@pulseops/contracts';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import type { IncidentFilters } from './filters';
import { predictIncident } from './optimistic';
import type { IncidentAction } from './optimistic';

const PAGE_SIZE = 50;
/** Detail view refresh until the realtime socket (Phase 4) pushes changes instead. */
const DETAIL_REFETCH_MS = 15_000;

// Every key carries the organization, so tenants never share cache entries.
export const incidentKeys = {
  all: (orgId: string) => ['org', orgId, 'incidents'] as const,
  list: (orgId: string, f: IncidentFilters) => ['org', orgId, 'incidents', 'list', f] as const,
  detail: (orgId: string, id: string) => ['org', orgId, 'incidents', 'detail', id] as const,
  events: (orgId: string, id: string) => ['org', orgId, 'incidents', 'events', id] as const,
  assignees: (orgId: string) => ['org', orgId, 'incidents', 'assignees'] as const,
  services: (orgId: string) => ['org', orgId, 'services'] as const,
};

export function useIncidentList(orgId: string, filters: IncidentFilters) {
  return useInfiniteQuery({
    queryKey: incidentKeys.list(orgId, filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiGet<IncidentPage>(
        `/organizations/${orgId}/incidents`,
        {
          status: filters.status,
          severity: filters.severity,
          service: filters.service,
          q: filters.q,
          sort: filters.sort,
          cursor: pageParam,
          limit: String(PAGE_SIZE),
        },
        signal,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useIncident(orgId: string, id: string) {
  return useQuery({
    queryKey: incidentKeys.detail(orgId, id),
    queryFn: ({ signal }) =>
      apiGet<Incident>(`/organizations/${orgId}/incidents/${id}`, {}, signal),
    refetchInterval: DETAIL_REFETCH_MS,
    // A missing or foreign incident will not appear on retry.
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
  });
}

export function useIncidentEvents(orgId: string, id: string) {
  return useQuery({
    queryKey: incidentKeys.events(orgId, id),
    queryFn: ({ signal }) =>
      apiGet<IncidentEvent[]>(`/organizations/${orgId}/incidents/${id}/events`, {}, signal),
    refetchInterval: DETAIL_REFETCH_MS,
  });
}

export function useAssignees(orgId: string, enabled = true) {
  return useQuery({
    queryKey: incidentKeys.assignees(orgId),
    queryFn: ({ signal }) =>
      apiGet<AssigneeOption[]>(`/organizations/${orgId}/incidents/assignees`, {}, signal),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useServices(orgId: string) {
  return useQuery({
    queryKey: incidentKeys.services(orgId),
    queryFn: ({ signal }) =>
      apiGet<ServiceSummary[]>(`/organizations/${orgId}/services`, {}, signal),
    staleTime: 5 * 60_000,
  });
}

/** The latest incident carried by a 409 version-conflict response, if that is what this is. */
export function conflictOf(error: unknown): Incident | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const details = error.details as { reason?: string; current?: Incident } | undefined;
  return details?.reason === 'VERSION_CONFLICT' && details.current ? details.current : null;
}

/** Anything that changes an incident also changes lists, counts and the dashboard. */
function invalidateIncidentData(qc: QueryClient, orgId: string, id?: string) {
  void qc.invalidateQueries({ queryKey: incidentKeys.all(orgId) });
  void qc.invalidateQueries({ queryKey: ['org', orgId, 'dashboard'] });
  if (id) void qc.invalidateQueries({ queryKey: incidentKeys.events(orgId, id) });
}

interface ActionVariables {
  action: IncidentAction;
  /** The version the user was looking at when they acted (FR-INC-009). */
  expectedVersion: number;
}

function send(orgId: string, id: string, { action, expectedVersion }: ActionVariables) {
  const base = `/organizations/${orgId}/incidents/${id}`;
  switch (action.kind) {
    case 'transition':
      return apiPost<Incident>(`${base}/${action.transition}`, {
        expectedVersion,
        ...(action.reason !== undefined && { reason: action.reason }),
      });
    case 'assign':
      return apiPost<Incident>(`${base}/assign`, {
        assigneeId: action.assignee?.userId ?? null,
        expectedVersion,
      });
    case 'update':
      return apiPatch<Incident>(base, { ...action.patch, expectedVersion });
  }
}

/**
 * Optimistic update with rollback (FR-INC-010): the predicted incident is shown at once;
 * on a version conflict the cache is replaced by the latest state the server returned, on
 * any other failure it is restored to what it was.
 */
export function useIncidentAction(orgId: string, id: string, role: Role) {
  const qc = useQueryClient();
  const key = incidentKeys.detail(orgId, id);

  return useMutation({
    mutationFn: (variables: ActionVariables) => send(orgId, id, variables),
    onMutate: async ({ action }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Incident>(key);
      if (previous) qc.setQueryData(key, predictIncident(previous, action, role));
      return { previous };
    },
    onSuccess: (incident) => qc.setQueryData(key, incident),
    onError: (error, _variables, context) => {
      const latest = conflictOf(error);
      if (latest) qc.setQueryData(key, latest);
      else if (context?.previous) qc.setQueryData(key, context.previous);
    },
    onSettled: () => invalidateIncidentData(qc, orgId, id),
  });
}

export function useCreateIncident(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateIncidentRequest) =>
      apiPost<Incident>(`/organizations/${orgId}/incidents`, input),
    onSuccess: (incident) => {
      qc.setQueryData(incidentKeys.detail(orgId, incident.id), incident);
      invalidateIncidentData(qc, orgId);
    },
  });
}
