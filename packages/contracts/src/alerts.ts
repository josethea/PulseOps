import { z } from 'zod';

import { METRIC_KEYS, SEVERITIES } from './metrics.js';
import type { MetricKey, Severity } from './metrics.js';

export const ALERT_OPERATORS = ['GT', 'GTE', 'LT', 'LTE', 'EQ'] as const;
export type AlertOperator = (typeof ALERT_OPERATORS)[number];

export const ALERT_STATES = ['FIRING', 'CLEARED'] as const;
export type AlertState = (typeof ALERT_STATES)[number];

// ---------------------------------------------------------------- evaluation (BR-008/009)

export const OPERATOR_SYMBOLS: Record<AlertOperator, string> = {
  GT: '>',
  GTE: '>=',
  LT: '<',
  LTE: '<=',
  EQ: '=',
};

/** True when `value` violates the rule, i.e. `value <operator> threshold` holds. */
export function isViolation(operator: AlertOperator, value: number, threshold: number): boolean {
  switch (operator) {
    case 'GT':
      return value > threshold;
    case 'GTE':
      return value >= threshold;
    case 'LT':
      return value < threshold;
    case 'LTE':
      return value <= threshold;
    case 'EQ':
      return value === threshold;
  }
}

/** Metrics expressed as a percentage: a threshold outside 0-100 can never be meaningful. */
const PERCENT_METRICS: readonly MetricKey[] = ['error_rate', 'availability'];

/** Why a threshold is invalid for the metric, or null when it is acceptable (BR-008). */
export function thresholdProblem(metricKey: MetricKey, threshold: number): string | null {
  if (threshold < 0) return 'Threshold cannot be negative for this metric';
  if (PERCENT_METRICS.includes(metricKey) && threshold > 100) {
    return 'Threshold for a percentage metric must be between 0 and 100';
  }
  return null;
}

/**
 * Whether a rule may fire again. A rule has at most one open episode, and once an episode
 * ends it stays quiet until `cooldownSeconds` after the last firing, which stops a metric
 * hovering around the threshold from producing a stream of alerts (BR-009).
 */
export function mayFire(
  lastTriggeredAt: Date | null,
  hasFiringEpisode: boolean,
  cooldownSeconds: number,
  now: Date,
): boolean {
  if (hasFiringEpisode) return false;
  if (!lastTriggeredAt) return true;
  return now.getTime() - lastTriggeredAt.getTime() >= cooldownSeconds * 1000;
}

// ---------------------------------------------------------------- requests

const ruleFields = {
  name: z.string().trim().min(3).max(120),
  serviceId: z.string().min(1),
  metricKey: z.enum(METRIC_KEYS),
  operator: z.enum(ALERT_OPERATORS),
  threshold: z.number().finite(),
  // Whole minutes between 1 and 60: evaluation reads minute aggregates.
  windowSeconds: z
    .number()
    .int()
    .min(60)
    .max(3600)
    .refine((value) => value % 60 === 0, 'Window must be a whole number of minutes'),
  cooldownSeconds: z.number().int().min(60).max(86_400),
  severity: z.enum(SEVERITIES),
  isEnabled: z.boolean(),
};

export const createAlertRuleSchema = z
  .object({
    ...ruleFields,
    cooldownSeconds: ruleFields.cooldownSeconds.default(300),
    isEnabled: ruleFields.isEnabled.default(true),
  })
  .superRefine((rule, ctx) => {
    const problem = thresholdProblem(rule.metricKey, rule.threshold);
    if (problem) ctx.addIssue({ code: 'custom', path: ['threshold'], message: problem });
  });
export type CreateAlertRuleRequest = z.infer<typeof createAlertRuleSchema>;

export const updateAlertRuleSchema = z
  .object({
    name: ruleFields.name.optional(),
    operator: ruleFields.operator.optional(),
    threshold: ruleFields.threshold.optional(),
    windowSeconds: ruleFields.windowSeconds.optional(),
    cooldownSeconds: ruleFields.cooldownSeconds.optional(),
    severity: ruleFields.severity.optional(),
    isEnabled: ruleFields.isEnabled.optional(),
    expectedVersion: z.number().int().positive(),
  })
  .refine(
    ({ expectedVersion: _version, ...fields }) =>
      Object.values(fields).some((value) => value !== undefined),
    'Provide at least one field to change',
  );
export type UpdateAlertRuleRequest = z.infer<typeof updateAlertRuleSchema>;

export const alertListQuerySchema = z.object({
  state: z.enum(ALERT_STATES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AlertListQuery = z.infer<typeof alertListQuerySchema>;

export const notificationListQuerySchema = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

// ---------------------------------------------------------------- DTOs

export interface AlertRule {
  id: string;
  organizationId: string;
  name: string;
  serviceId: string;
  serviceName: string;
  metricKey: MetricKey;
  operator: AlertOperator;
  threshold: number;
  windowSeconds: number;
  cooldownSeconds: number;
  severity: Severity;
  isEnabled: boolean;
  version: number;
  updatedAt: string;
}

export interface Alert {
  id: string;
  organizationId: string;
  ruleId: string;
  ruleName: string;
  serviceId: string;
  serviceName: string;
  metricKey: MetricKey;
  operator: AlertOperator;
  threshold: number;
  severity: Severity;
  state: AlertState;
  observedValue: number;
  triggeredAt: string;
  clearedAt: string | null;
  relatedIncidentId: string | null;
}

export interface AlertPage {
  items: Alert[];
  nextCursor: string | null;
}

export type NotificationType = 'INCIDENT' | 'ALERT';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  referenceType: string | null;
  referenceId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: AppNotification[];
  nextCursor: string | null;
  unreadCount: number;
}
