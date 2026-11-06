'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { SEVERITIES, createIncidentSchema } from '@pulseops/contracts';
import type { Incident } from '@pulseops/contracts';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Field } from './field';
import { SEVERITY_LABELS } from './labels';

const editSchema = createIncidentSchema.pick({ title: true, description: true, severity: true });
type EditInput = z.input<typeof editSchema>;
type EditValues = z.output<typeof editSchema>;

interface Props {
  incident: Incident;
  open: boolean;
  onClose: () => void;
  onSubmit: (patch: Partial<EditValues>) => void;
}

export function EditIncidentDialog({ incident, open, onClose, onSubmit }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title="Edit incident">
      <EditForm incident={incident} onClose={onClose} onSubmit={onSubmit} />
    </Dialog>
  );
}

function EditForm({ incident, onClose, onSubmit }: Omit<Props, 'open'>) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EditInput, unknown, EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      title: incident.title,
      description: incident.description,
      severity: incident.severity,
    },
  });

  const submit = handleSubmit((values) => {
    // Send only what changed so the audit trail shows exactly that.
    const patch: Partial<EditValues> = {};
    if (values.title !== incident.title) patch.title = values.title;
    if (values.description !== incident.description) patch.description = values.description;
    if (values.severity !== incident.severity) patch.severity = values.severity;
    if (Object.keys(patch).length > 0) onSubmit(patch);
    onClose();
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field id="edit-title" label="Title" error={errors.title && 'Enter 3 to 140 characters.'}>
        <Input
          id="edit-title"
          autoFocus
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? 'edit-title-error' : undefined}
          {...register('title')}
        />
      </Field>
      <Field id="edit-description" label="Description">
        <Textarea id="edit-description" {...register('description')} />
      </Field>
      <Field id="edit-severity" label="Severity">
        <Select id="edit-severity" {...register('severity')}>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s} · {SEVERITY_LABELS[s]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Save changes</Button>
      </div>
    </form>
  );
}
