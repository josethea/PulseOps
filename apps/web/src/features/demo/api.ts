'use client';

import type {
  DashboardSnapshot,
  DemoResetResult,
  DemoScenario,
  DemoStatus,
  StartScenarioRequest,
} from '@pulseops/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, apiGet, apiPost } from '@/lib/api-client';

export const demoKeys = {
  status: (orgId: string) => ['org', orgId, 'demo', 'status'] as const,
  services: (orgId: string) => ['org', orgId, 'demo', 'services'] as const,
};

export function useDemoStatus(orgId: string) {
  return useQuery({
    queryKey: demoKeys.status(orgId),
    queryFn: ({ signal }) => apiGet<DemoStatus>(`/organizations/${orgId}/demo/status`, {}, signal),
    // The socket announces changes; this only covers a simulation ending while it is down.
    refetchInterval: 30_000,
  });
}

/** Services a simulation can target, from the same snapshot the dashboard uses. */
export function useDemoServices(orgId: string) {
  return useQuery({
    queryKey: demoKeys.services(orgId),
    queryFn: async ({ signal }) =>
      (
        await apiGet<DashboardSnapshot>(`/organizations/${orgId}/dashboard/snapshot`, {}, signal)
      ).services.map(({ id, name }) => ({ id, name })),
    staleTime: 5 * 60_000,
  });
}

export function useStartScenario(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<StartScenarioRequest>) =>
      apiPost<DemoScenario>(`/organizations/${orgId}/demo/scenarios`, input),
    onSettled: () => qc.invalidateQueries({ queryKey: ['org', orgId, 'demo'] }),
  });
}

export function useCancelScenario(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scenarioId: string) =>
      apiPost<DemoScenario>(`/organizations/${orgId}/demo/scenarios/${scenarioId}/cancel`, {}),
    onSettled: () => qc.invalidateQueries({ queryKey: ['org', orgId, 'demo'] }),
  });
}

export function useResetDemo(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<DemoResetResult>(`/organizations/${orgId}/demo/reset`, {}),
    // Everything cached for the tenant describes the old dataset.
    onSettled: () => qc.invalidateQueries({ queryKey: ['org', orgId] }),
  });
}

/** A readable reason for a refused start or reset (limits, a running simulation, cooldown). */
export function demoErrorMessage(error: unknown, timezone: string): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';
  const details = error.details as
    { reason?: string; nextSlotAt?: string; availableAt?: string } | undefined;
  const at = (iso?: string) =>
    iso
      ? new Intl.DateTimeFormat('en-GB', {
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(iso))
      : 'a little later';

  switch (details?.reason) {
    case 'SCENARIO_ACTIVE':
      return 'A simulation is already running. Wait for it to finish or stop it first.';
    case 'QUOTA_EXCEEDED':
      return `You have used this hour's simulations. The next slot opens at ${at(details.nextSlotAt)}.`;
    case 'RESET_COOLDOWN':
      return `The demo was reset a moment ago. Try again at ${at(details.availableAt)}.`;
    case 'not_demo_tenant':
    case 'demo_disabled':
      return 'The simulator is not available for this organization.';
    default:
      return error.message;
  }
}
