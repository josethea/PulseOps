import type { Metadata } from 'next';

import { PagePlaceholder } from '@/components/layout/page-placeholder';

export const metadata: Metadata = { title: 'Services' };

export default function Page() {
  return <PagePlaceholder title="Services" description="Coming soon: service catalog (Phase 2)." />;
}
