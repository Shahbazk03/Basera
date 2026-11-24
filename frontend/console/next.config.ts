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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@estate/ui', '@estate/api-client'],
  env: {
    NEXT_PUBLIC_WEB_URL: process.env.WEB_PUBLIC_URL ?? 'http://localhost:3200',
    NEXT_PUBLIC_APP_ENV: process.env.APP_ENV ?? 'local',
  },
  turbopack: { root: path.resolve(process.cwd(), '../..') },
  // Docker images use the self-contained standalone server (see infrastructure/docker/next.Dockerfile).
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: `${API}/api/v1/:path*` },
      { source: '/uploads/:path*', destination: `${API}/uploads/:path*` },
    ];
  },
  images: {
    qualities: [60, 75, 85],
    localPatterns: [{ pathname: '/uploads/**' }],
    remotePatterns: [{ protocol: 'https', hostname: 'images.unsplash.com' }, ...(s3Host ? [{ protocol: 'https' as const, hostname: s3Host }] : [])],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
          // The console is never indexed
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default nextConfig;
