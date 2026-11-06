import 'server-only';

import type { MeResponse } from '@pulseops/contracts';
import { cookies } from 'next/headers';
import { cache } from 'react';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/**
 * Resolves the signed-in user on the server by forwarding the session cookie to the API.
 * The API is the authority: the web app never trusts the cookie's mere presence.
 */
export const getMe = cache(async (): Promise<MeResponse | null> => {
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader) return null;

  try {
    const res = await fetch(`${API_INTERNAL_URL}/api/v1/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    return res.ok ? ((await res.json()) as MeResponse) : null;
  } catch {
    return null;
  }
});
