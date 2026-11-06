import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LoginForm } from '@/features/auth/login-form';
import { getMe } from '@/lib/session';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage() {
  if (await getMe()) redirect('/app/dashboard');

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">PulseOps</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in to the real-time operations command center.
        </p>
      </header>
      <LoginForm />
    </main>
  );
}
