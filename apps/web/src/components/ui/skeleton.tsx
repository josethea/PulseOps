import { cn } from '@/lib/utils';

/** Placeholder block. Always give it explicit dimensions so loading causes no layout shift. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-muted', className)} />;
}
