import type { NextConfig } from 'next';

// Server-side only: where the Next server reaches the API.
const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The browser talks to the API through this same-origin proxy, so the session cookie
  // is first-party (SameSite=Lax) and no cross-site cookie or CORS setup is needed.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiInternalUrl}/api/:path*` }];
  },
};

export default nextConfig;
