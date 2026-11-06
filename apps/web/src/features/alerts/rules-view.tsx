'use client';

import type { AlertRule } from '@pulseops/contracts';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { EmptyState, ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SeverityBadge } from '@/features/incidents/labels';
import { ruleConflictOf, useAlertRules, useUpdateRule } from './api';
import { conditionText, windowText } from './labels';
import { RuleDialog } from './rule-dialog';

export function RulesView({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const rules = useAlertRules(orgId);
  const [editing, setEditing] = useState<AlertRule | 'new' | null>(null);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Alert rules</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {canManage
              ? 'Rules are evaluated on the server against stored telemetry.'
              : 'Only organization admins can change rules.'}
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setEditing('new')}>
            <Plus className="mr-1.5 size-4" aria-hidden />
            New rule
          </Button>
        )}
      </header>

      <Card className="overflow-hidden">
        {rules.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rules.isError ? (
          <ErrorState error={rules.error} onRetry={() => void rules.refetch()} />
        ) : rules.data.length === 0 ? (
          <EmptyState title="No alert rules yet" hint="Create one to start watching a metric." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Alert rules</caption>
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Rule
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Condition
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Window
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Severity
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Status
                  </th>
                  {canManage && (
                    <th scope="col" className="px-4 py-2 font-medium">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rules.data.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    orgId={orgId}
                    rule={rule}
                    canManage={canManage}
                    onEdit={() => setEditing(rule)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <RuleDialog
        key={editing === 'new' ? 'new' : (editing?.id ?? 'none')}
        orgId={orgId}
        rule={editing && editing !== 'new' ? editing : undefined}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function RuleRow({
  orgId,
  rule,
  canManage,
  onEdit,
}: {
  orgId: string;
  rule: AlertRule;
  canManage: boolean;
  onEdit: () => void;
}) {
  const update = useUpdateRule(orgId, rule.id);
  const conflict = ruleConflictOf(update.error);

  return (
    <tr>
      <td className="px-4 py-3">
        <div className="font-medium">{rule.name}</div>
        <div className="text-xs text-muted-foreground">{rule.serviceName}</div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">{conditionText(rule)}</td>
      <td className="px-4 py-3 whitespace-nowrap">
        {windowText(rule.windowSeconds)}
        <span className="block text-xs text-muted-foreground">
          cooldown {windowText(rule.cooldownSeconds)}
        </span>
      </td>
      <td className="px-4 py-3">
        <SeverityBadge severity={rule.severity} />
      </td>
      <td className="px-4 py-3">
        {rule.isEnabled ? 'Enabled' : 'Disabled'}
        {conflict && (
          <span role="alert" className="block text-xs text-sev1">
            Changed by someone else. Try again.
          </span>
        )}
      </td>
      {canManage && (
        <td className="px-4 py-3">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={update.isPending}
              onClick={() =>
                update.mutate({ isEnabled: !rule.isEnabled, expectedVersion: rule.version })
              }
              aria-label={`${rule.isEnabled ? 'Disable' : 'Enable'} ${rule.name}`}
            >
              {rule.isEnabled ? 'Disable' : 'Enable'}
            </Button>
          </div>
        </td>
      )}
    </tr>
  );
}
