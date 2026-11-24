import fs from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import type { NextConfig } from 'next';

// Load the monorepo root .env (real environment variables take precedence).
for (const candidate of [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../.env')]) {
  if (fs.existsSync(candidate)) {
    loadEnv({ path: candidate, quiet: true });
    break;
  }
}

const API = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const s3Host = (() => {
  try {
    return process.env.S3_PUBLIC_BASE_URL ? new URL(process.env.S3_PUBLIC_BASE_URL).hostname : null;
  } catch {
    return null;
  }
})();

const csp = [
  "default-src 'self'",
  // Next.js hydration requires inline scripts unless nonces are configured.
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://images.unsplash.com https://*.tile.openstreetmap.org https://maps.gstatic.com https://maps.googleapis.com${s3Host ? ` https://${s3Host}` : ''}`,
  "font-src 'self' data:",
  "connect-src 'self'",
  'frame-src https://www.openstreetmap.org https://www.google.com https://challenges.cloudflare.com https://www.youtube-nocookie.com https://player.vimeo.com',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@estate/ui', '@estate/api-client'],
  turbopack: { root: path.resolve(process.cwd(), '../..') },
  // Docker images use the self-contained standalone server (see infrastructure/docker/next.Dockerfile).
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  env: {
    NEXT_PUBLIC_CONSOLE_URL: process.env.CONSOLE_PUBLIC_URL ?? 'http://localhost:3300',
    NEXT_PUBLIC_WEB_URL: process.env.WEB_PUBLIC_URL ?? 'http://localhost:3200',
    NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY ?? '',
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '',
  },
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: `${API}/api/v1/:path*` },
      { source: '/uploads/:path*', destination: `${API}/uploads/:path*` },
    ];
  },
  images: {
    qualities: [60, 75, 85],
    // Local uploads are proxied from the API on localhost during development only.
    dangerouslyAllowLocalIP: process.env.NODE_ENV !== 'production',
    localPatterns: [{ pathname: '/uploads/**' }, { pathname: '/images/**' }],
    remotePatterns: [{ protocol: 'https', hostname: 'images.unsplash.com' }, ...(s3Host ? [{ protocol: 'https' as const, hostname: s3Host }] : [])],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
