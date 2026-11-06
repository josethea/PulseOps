'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { REGIONS, SEVERITIES, createIncidentSchema } from '@pulseops/contracts';
import type { CreateIncidentRequest, Incident } from '@pulseops/contracts';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api-client';
import { useAssignees, useCreateIncident, useServices } from './api';
import { Field } from './field';
import { SEVERITY_LABELS } from './labels';

type FormInput = z.input<typeof createIncidentSchema>;

interface Props {
  orgId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (incident: Incident) => void;
}

export function CreateIncidentDialog({ orgId, open, onClose, onCreated }: Props) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create incident"
      description="It starts as Open, with you as the creator."
    >
      <CreateForm orgId={orgId} onClose={onClose} onCreated={onCreated} />
    </Dialog>
  );
}

function CreateForm({ orgId, onClose, onCreated }: Omit<Props, 'open'>) {
  const services = useServices(orgId);
  const assignees = useAssignees(orgId);
  const create = useCreateIncident(orgId);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, CreateIncidentRequest>({
    resolver: zodResolver(createIncidentSchema),
    defaultValues: { severity: 'SEV3', region: 'LIM' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const incident = await create.mutateAsync(values);
      onCreated(incident);
    } catch (error) {
      // Field errors from the server (e.g. an assignee who cannot handle incidents).
      if (error instanceof ApiError && error.status === 422) {
        const fields = (error.details as { fieldErrors?: Record<string, string[]> } | undefined)
          ?.fieldErrors;
        for (const [name, messages] of Object.entries(fields ?? {})) {
          setError(name as keyof FormInput, { message: messages[0] });
        }
      }
    }
  });

  const serverMessage =
    create.error instanceof ApiError && create.error.status !== 422 ? create.error.message : null;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Field
        id="inc-title"
        label="Title"
        error={errors.title?.message && 'Enter 3 to 140 characters.'}
      >
        <Input
          id="inc-title"
          autoFocus
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? 'inc-title-error' : undefined}
          {...register('title')}
        />
      </Field>

      <Field
        id="inc-description"
        label="Description"
        hint="What is happening and what is affected?"
      >
        <Textarea id="inc-description" {...register('description')} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="inc-service" label="Service" error={errors.serviceId && 'Choose a service.'}>
          <Select
            id="inc-service"
            aria-invalid={errors.serviceId ? true : undefined}
            aria-describedby={errors.serviceId ? 'inc-service-error' : undefined}
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

        <Field id="inc-region" label="Region">
          <Select id="inc-region" {...register('region')}>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="inc-severity" label="Severity">
          <Select id="inc-severity" {...register('severity')}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s} · {SEVERITY_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="inc-assignee" label="Assignee (optional)" error={errors.assigneeId?.message}>
          <Select
            id="inc-assignee"
            aria-invalid={errors.assigneeId ? true : undefined}
            aria-describedby={errors.assigneeId ? 'inc-assignee-error' : undefined}
            // The empty "Unassigned" option must mean "no assignee", not an empty id.
            {...register('assigneeId', { setValueAs: (value: string) => value || undefined })}
          >
            <option value="">Unassigned</option>
            {assignees.data?.map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.displayName}
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
          {isSubmitting ? 'Creating…' : 'Create incident'}
        </Button>
      </div>
    </form>
  );
}
