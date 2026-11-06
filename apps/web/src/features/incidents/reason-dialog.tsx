'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { reasonedTransitionSchema } from '@pulseops/contracts';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Field } from './field';

const schema = reasonedTransitionSchema.pick({ reason: true });
type Values = z.output<typeof schema>;

interface Props {
  open: boolean;
  title: string;
  confirmLabel: string;
  description: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

/** Resolving and reopening need a written reason (FR-INC-008). */
export function ReasonDialog({
  open,
  title,
  confirmLabel,
  description,
  onClose,
  onConfirm,
}: Props) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      <ReasonForm confirmLabel={confirmLabel} onClose={onClose} onConfirm={onConfirm} />
    </Dialog>
  );
}

function ReasonForm({
  confirmLabel,
  onClose,
  onConfirm,
}: Pick<Props, 'confirmLabel' | 'onClose' | 'onConfirm'>) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const submit = handleSubmit(({ reason }) => {
    onConfirm(reason);
    onClose();
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field
        id="reason"
        label="Reason"
        error={errors.reason && 'Enter a reason (3 to 1000 characters).'}
      >
        <Textarea
          id="reason"
          autoFocus
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={errors.reason ? 'reason-error' : undefined}
          {...register('reason')}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">{confirmLabel}</Button>
      </div>
    </form>
  );
}
