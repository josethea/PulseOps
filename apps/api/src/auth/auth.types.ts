import type { Role } from '@pulseops/contracts';
import type {} from 'express';

export interface AuthContext {
  sessionId: string;
  user: { id: string; email: string; displayName: string };
}

export interface MembershipContext {
  id: string;
  organizationId: string;
  role: Role;
}

declare module 'express' {
  interface Request {
    auth?: AuthContext;
    membership?: MembershipContext;
  }
}
