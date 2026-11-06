'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

const ROLE_LABELS: Record<string, string> = {
  ORG_ADMIN: 'Admin',
  OPERATOR: 'Operator',
  ANALYST: 'Analyst',
  VIEWER: 'Viewer',
};

export function UserMenu({ displayName, role }: { displayName: string; role: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const signOut = async () => {
    setPending(true);
    await fetch('/api/v1/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  };

  return (
    <div className="flex items-center gap-3">
      <div className="text-right text-sm leading-tight">
        <div className="font-medium">{displayName}</div>
        <div className="text-xs text-muted-foreground">{ROLE_LABELS[role] ?? role}</div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Sign out"
        onClick={signOut}
        disabled={pending}
      >
        <LogOut className="size-4" aria-hidden />
      </Button>
    </div>
  );
}
