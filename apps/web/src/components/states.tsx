import { AlertTriangle, Inbox } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';

export function ErrorState({
  error,
  onRetry,
  title = 'Could not load this data',
}: {
  error: unknown;
  onRetry: () => void;
  title?: string;
}) {
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center">
      <AlertTriangle className="size-6 text-sev2" aria-hidden />
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : 'Something went wrong.'}
        </p>
        {requestId && <p className="mt-1 text-xs text-muted-foreground">Request ID: {requestId}</p>}
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <Inbox className="size-6 text-muted-foreground" aria-hidden />
      <p className="font-medium">{title}</p>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}
