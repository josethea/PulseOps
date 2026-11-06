import {
  Activity,
  Bell,
  BellRing,
  Flame,
  FlaskConical,
  Server,
  Settings,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV_ITEMS: NavItem[] = [
  { href: '/app/dashboard', label: 'Dashboard', icon: Activity },
  { href: '/app/incidents', label: 'Incidents', icon: Flame },
  { href: '/app/alerts', label: 'Alerts', icon: BellRing },
  { href: '/app/alert-rules', label: 'Alert rules', icon: SlidersHorizontal },
  { href: '/app/services', label: 'Services', icon: Server },
  { href: '/app/notifications', label: 'Notifications', icon: Bell },
  { href: '/app/demo', label: 'Demo', icon: FlaskConical },
  { href: '/app/settings', label: 'Settings', icon: Settings },
];
