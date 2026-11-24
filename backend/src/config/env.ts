import fs from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

/** Loads the monorepo root `.env` (walking up from cwd). Real environment variables always win. */
export function loadEnvFile(): void {
  let dir = process.cwd();
  for (let i = 0; i < 5; i += 1) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      loadEnv({ path: candidate, quiet: true });
      return;
    }
    dir = path.dirname(dir);
  }
}

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase())));
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const envSchema = z
  .object({
    APP_ENV: z.enum(['local', 'development', 'staging', 'production', 'test']).default('local'),
    NODE_ENV: z.string().default('development'),
    /** MongoDB connection string (a replica set: Atlas, or the local single-node set in docker compose). */
    DATABASE_URL: z.string().regex(/^mongodb(\+srv)?:\/\//, 'DATABASE_URL must be a mongodb:// or mongodb+srv:// connection string'),
    REDIS_URL: optionalString,
    API_PORT: z.coerce.number().int().default(4000),
    CORS_ORIGINS: z.string().default(''),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(120).default(20),
    DATA_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'DATA_ENCRYPTION_KEY must be 32 bytes, base64 encoded'),
    FILE_URL_SIGNING_SECRET: z.string().min(16),
    COOKIE_SECURE: bool.default(false),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    SWAGGER_ENABLED: bool.optional(),
    WEB_PUBLIC_URL: z.url().default('http://localhost:3200'),
    CONSOLE_PUBLIC_URL: z.url().default('http://localhost:3300'),
    API_PUBLIC_URL: z.url().default('http://localhost:4000'),
    PLATFORM_ROOT_DOMAIN: z.string().default('localhost'),
    PLATFORM_MAIN_HOSTS: z.string().default('localhost'),
    CUSTOM_DOMAIN_CNAME_TARGET: z.string().default(''),
    CUSTOM_DOMAIN_A_RECORD: optionalString,
    TLS_PROVIDER: z.enum(['none', 'caddy-on-demand']).default('none'),
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage'),
    S3_ENDPOINT: optionalString,
    S3_REGION: optionalString,
    S3_BUCKET_PUBLIC: optionalString,
    S3_BUCKET_PRIVATE: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_PUBLIC_BASE_URL: optionalString,
    S3_FORCE_PATH_STYLE: bool.default(false),
    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_SECURE: bool.default(false),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    MAIL_FROM: z.string().default('Basera <no-reply@example.com>'),
    TWILIO_ACCOUNT_SID: optionalString,
    TWILIO_AUTH_TOKEN: optionalString,
    TWILIO_FROM_NUMBER: optionalString,
    WHATSAPP_CLOUD_TOKEN: optionalString,
    WHATSAPP_PHONE_NUMBER_ID: optionalString,
    WHATSAPP_API_VERSION: z.string().default('v21.0'),
    TURNSTILE_SECRET_KEY: optionalString,
    NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY: optionalString,
    GEOCODING_PROVIDER: z.enum(['none', 'google']).default('none'),
    GOOGLE_GEOCODING_API_KEY: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV === 'production') {
      if (!env.COOKIE_SECURE) ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'must be true in production' });
      for (const key of ['JWT_ACCESS_SECRET', 'FILE_URL_SIGNING_SECRET'] as const) {
        if (env[key].startsWith('replace-with')) ctx.addIssue({ code: 'custom', path: [key], message: 'placeholder secret in production' });
      }
      if (env.STORAGE_DRIVER === 'local') {
        ctx.addIssue({ code: 'custom', path: ['STORAGE_DRIVER'], message: 'use s3-compatible object storage in production' });
      }
    }
  });

export type Env = z.output<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  loadEnvFile();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }
  cached = parsed.data;
  return cached;
}

/** For tests that mutate process.env. */
export function resetEnvCache(): void {
  cached = null;
}

export function corsOrigins(): string[] {
  const e = env();
  const list = e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  return [...new Set([...list, e.WEB_PUBLIC_URL, e.CONSOLE_PUBLIC_URL].map((o) => o.replace(/\/$/, '')))];
}

export function isProduction(): boolean {
  return env().APP_ENV === 'production';
}
