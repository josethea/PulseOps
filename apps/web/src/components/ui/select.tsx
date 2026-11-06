import * as React from 'react';

import { cn } from '@/lib/utils';

/** Styled native select: keyboard and screen-reader behavior come from the platform. */
function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-9 w-full rounded-md border bg-card px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Select };
