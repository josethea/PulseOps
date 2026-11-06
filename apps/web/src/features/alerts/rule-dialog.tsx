'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ALERT_OPERATORS,
  METRIC_KEYS,
  OPERATOR_SYMBOLS,
  SEVERITIES,
  createAlertRuleSchema,
} from '@pulseops/contracts';
import type { AlertRule, CreateAlertRuleRequest } from '@pulseops/contracts';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useServices } from '@/features/incidents/api';
import { Field } from '@/features/incidents/field';
import { SEVERITY_LABELS } from '@/features/incidents/labels';
import { ApiError } from '@/lib/api-client';
import { ruleConflictOf, useCreateRule, useUpdateRule } from './api';
import { metricLabel } from './labels';

type FormInput = z.input<typeof createAlertRuleSchema>;

interface Props {
  orgId: string;
  /** The rule being edited; omit to create one. */
  rule?: AlertRule;
  open: boolean;
  onClose: () => void;
}

export function RuleDialog({ orgId, rule, open, onClose }: Props) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={rule ? 'Edit alert rule' : 'New alert rule'}
      description="The next evaluation uses the saved configuration. Windows are whole minutes."
    >
      <RuleForm orgId={orgId} rule={rule} onClose={onClose} />
    </Dialog>
  );
}

function RuleForm({ orgId, rule, onClose }: Omit<Props, 'open'>) {
  const services = useServices(orgId);
  const create = useCreateRule(orgId);
  const update = useUpdateRule(orgId, rule?.id ?? '');
  const editing = Boolean(rule);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, CreateAlertRuleRequest>({
    resolver: zodResolver(createAlertRuleSchema),
    defaultValues: rule
      ? { ...rule }
      : {
          metricKey: 'error_rate',
          operator: 'GT',
          windowSeconds: 300,
          cooldownSeconds: 300,
          severity: 'SEV3',
          isEnabled: true,
        },
  });

  const serverMessage = (() => {
    const error = editing ? update.error : create.error;
    if (!error) return null;
    const latest = ruleConflictOf(error);
    if (latest)
      return 'Someone else changed this rule. Close and reopen it to see the latest version.';
    return error instanceof ApiError && error.status !== 422 ? error.message : null;
  })();

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (rule) {
        await update.mutateAsync({
          name: values.name,
          operator: values.operator,
          threshold: values.threshold,
          windowSeconds: values.windowSeconds,
          cooldownSeconds: values.cooldownSeconds,
          severity: values.severity,
          expectedVersion: rule.version,
        });
      } else {
        await create.mutateAsync(values);
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        const fields = (error.details as { fieldErrors?: Record<string, string[]> } | undefined)
          ?.fieldErrors;
        for (const [name, messages] of Object.entries(fields ?? {})) {
          setError(name as keyof FormInput, { message: messages[0] });
        }
      }
    }
  });

  const friendly = (message?: string) =>
    message?.startsWith('Invalid input') ? 'Enter a valid number.' : message;
  const err = (name: keyof FormInput) => errors[name]?.message as string | undefined;
  const aria = (name: keyof FormInput, id: string) => ({
    'aria-invalid': errors[name] ? (true as const) : undefined,
    'aria-describedby': errors[name] ? `${id}-error` : undefined,
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Field id="rule-name" label="Name" error={err('name') && 'Enter 3 to 120 characters.'}>
        <Input id="rule-name" autoFocus {...aria('name', 'rule-name')} {...register('name')} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="rule-service" label="Service" error={err('serviceId') && 'Choose a service.'}>
          <Select
            id="rule-service"
            disabled={editing}
            {...aria('serviceId', 'rule-service')}
            {...register('serviceId')}
          >
            <option value="">{services.isPending ? 'Loading…' : 'Choose a service'}</option>
            {services.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="rule-metric" label="Metric" hint={editing ? 'Fixed once created.' : undefined}>
          <Select id="rule-metric" disabled={editing} {...register('metricKey')}>
            {METRIC_KEYS.map((key) => (
              <option key={key} value={key}>
                {metricLabel(key)}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="rule-operator" label="Fires when value is">
          <Select id="rule-operator" {...register('operator')}>
            {ALERT_OPERATORS.map((op) => (
              <option key={op} value={op}>
                {OPERATOR_SYMBOLS[op]}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="rule-threshold" label="Threshold" error={friendly(err('threshold'))}>
          <Input
            id="rule-threshold"
            type="number"
            step="any"
            {...aria('threshold', 'rule-threshold')}
            {...register('threshold', { valueAsNumber: true })}
          />
        </Field>

        <Field
          id="rule-window"
          label="Window (minutes)"
          error={err('windowSeconds') && 'Use a whole number of minutes from 1 to 60.'}
          hint="The mean over this window is compared with the threshold."
        >
          <Input
            id="rule-window"
            type="number"
            min={1}
            max={60}
            {...aria('windowSeconds', 'rule-window')}
            onChange={(e) => setValue('windowSeconds', Number(e.target.value) * 60)}
            defaultValue={(rule?.windowSeconds ?? 300) / 60}
          />
        </Field>

        <Field
          id="rule-cooldown"
          label="Cooldown (minutes)"
          error={err('cooldownSeconds') && 'Use 1 to 1440 minutes.'}
          hint="Quiet period before the rule may fire again."
        >
          <Input
            id="rule-cooldown"
            type="number"
            min={1}
            max={1440}
            {...aria('cooldownSeconds', 'rule-cooldown')}
            onChange={(e) => setValue('cooldownSeconds', Number(e.target.value) * 60)}
            defaultValue={(rule?.cooldownSeconds ?? 300) / 60}
          />
        </Field>

        <Field id="rule-severity" label="Severity">
          <Select id="rule-severity" {...register('severity')}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s} · {SEVERITY_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {serverMessage && (
        <p role="alert" className="text-sm text-sev1">
          {serverMessage}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Create rule'}
        </Button>
      </div>
    </form>
  );
}
