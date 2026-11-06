import type { Metadata } from 'next';

import { PagePlaceholder } from '@/components/layout/page-placeholder';

export const metadata: Metadata = { title: 'Settings' };

export default function Page() {
  return <PagePlaceholder title="Settings" description="Coming soon: time zone and preferences." />;
}
