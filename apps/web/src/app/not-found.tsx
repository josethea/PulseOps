import Link from 'next/link';

import { PagePlaceholder } from '@/components/layout/page-placeholder';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md p-8">
      <PagePlaceholder
        title="404 · Not found"
        description="The page you are looking for does not exist."
      />
      <Link href="/app/dashboard" className="mt-4 inline-block text-sm text-primary underline">
        Back to dashboard
      </Link>
    </main>
  );
}
