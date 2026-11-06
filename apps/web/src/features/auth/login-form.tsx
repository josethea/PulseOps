'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { loginRequestSchema } from '@pulseops/contracts';
import type { DemoLoginRequest, LoginRequest } from '@pulseops/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const DEMO_ROLES: { role: DemoLoginRequest['role']; label: string; hint: string }[] = [
  { role: 'OPERATOR', label: 'Operator', hint: 'Manage incidents' },
  { role: 'ANALYST', label: 'Analyst', hint: 'Read and export' },
  { role: 'VIEWER', label: 'Viewer', hint: 'Read-only' },
  { role: 'ORG_ADMIN', label: 'Admin', hint: 'Everything' },
];

async function postJson(path: string, body: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const error = (await res.json().catch(() => null)) as { message?: string } | null;
  // A non-JSON failure means the request never reached the API (e.g. it is down).
  return error?.message ?? 'The service is unavailable right now. Please try again shortly.';
}

export function LoginForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDemo, setPendingDemo] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({ resolver: zodResolver(loginRequestSchema) });

  const enter = () => {
    router.replace('/app/dashboard');
    router.refresh();
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const error = await postJson('/api/v1/auth/login', values);
    if (error) setFormError(error);
    else enter();
  });

  const onDemo = async (role: DemoLoginRequest['role']) => {
    setFormError(null);
    setPendingDemo(role);
    const error = await postJson('/api/v1/auth/demo', { role });
    if (error) {
      setFormError(error);
      setPendingDemo(null);
    } else {
      enter();
    }
  };

  return (
    <div className="space-y-8">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'email-error' : undefined}
            {...register('email')}
          />
          {errors.email && (
            <p id="email-error" className="text-sm text-sev1">
              Enter a valid email address.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? 'password-error' : undefined}
            {...register('password')}
          />
          {errors.password && (
            <p id="password-error" className="text-sm text-sev1">
              Enter your password.
            </p>
          )}
        </div>

        {formError && (
          <p role="alert" className="text-sm text-sev1">
            {formError}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={isSubmitting || pendingDemo !== null}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <section aria-labelledby="demo-heading" className="space-y-3 border-t pt-6">
        <div>
          <h2 id="demo-heading" className="text-sm font-semibold">
            Try the live demo
          </h2>
          <p className="text-sm text-muted-foreground">
            No account needed. Pick a role to explore synthetic data.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {DEMO_ROLES.map(({ role, label, hint }) => (
            <Button
              key={role}
              type="button"
              variant="outline"
              className="h-auto flex-col items-start gap-0 py-2"
              disabled={isSubmitting || pendingDemo !== null}
              onClick={() => onDemo(role)}
            >
              <span>{pendingDemo === role ? 'Entering…' : label}</span>
              <span className="text-xs font-normal text-muted-foreground">{hint}</span>
            </Button>
          ))}
        </div>
      </section>
    </div>
  );
}
