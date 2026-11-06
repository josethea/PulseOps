import type { Metadata } from 'next';

import { PagePlaceholder } from '@/components/layout/page-placeholder';

export const metadata: Metadata = { title: 'Access denied' };

export default function ForbiddenPage() {
  return (
    <main className="mx-auto max-w-md p-8">
      <PagePlaceholder
        title="403 · Access denied"
        description="You do not have permission to view this resource."
      />
    </main>
  );
}
