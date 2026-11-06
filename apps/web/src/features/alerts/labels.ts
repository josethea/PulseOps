import { OPERATOR_SYMBOLS } from '@pulseops/contracts';
import type { Alert, AlertRule } from '@pulseops/contracts';

import { METRIC_LABELS } from '@/features/dashboard/format';

/** Known metrics use their dashboard label; others fall back to a readable form of the key. */
export const metricLabel = (key: string) =>
  METRIC_LABELS[key] ?? key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** "Error rate > 5" */
export function conditionText(
  rule: Pick<Alert | AlertRule, 'metricKey' | 'operator' | 'threshold'>,
) {
  return `${metricLabel(rule.metricKey)} ${OPERATOR_SYMBOLS[rule.operator]} ${rule.threshold}`;
}

export function windowText(seconds: number) {
  const minutes = seconds / 60;
  return `${minutes} min`;
}
