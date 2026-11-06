'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useUnreadCount } from './api';

/** Header shortcut to the notification center with the unread counter (FR-NOTIF-004). */
export function NotificationBell({ orgId }: { orgId: string }) {
  const { data: unread = 0 } = useUnreadCount(orgId);
  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <Link
      href="/app/notifications"
      aria-label={label}
      className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'relative')}
    >
      <Bell className="size-4" aria-hidden />
      {unread > 0 && (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-4 text-primary-foreground"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );
}
