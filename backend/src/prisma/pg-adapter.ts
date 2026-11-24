import { PrismaPg } from '@prisma/adapter-pg';

const TLS_MODES = new Set(['require', 'verify-ca', 'verify-full', 'no-verify', 'prefer']);

/**
 * node-postgres connection settings with TLS configured explicitly rather than through `sslmode` in the URL:
 * node-postgres treats `sslmode=require` as full verification against Node's built-in certificate authorities,
 * which managed databases with their own CA (e.g. Supabase) fail.
 *  • DATABASE_SSL_CA (PEM text) given → TLS with the server certificate verified against that CA (recommended);
 *  • URL asks for TLS (sslmode=require…) but no CA given → TLS, encrypted, without certificate verification;
 *  • otherwise → exactly as in the URL (local development: no TLS).
 */
export function pgConnectionConfig(connectionString: string, caPem?: string): { connectionString: string; ssl?: { ca?: string; rejectUnauthorized: boolean } } {
  const ca = caPem?.trim() ? caPem.trim().replace(/\\n/g, '\n') : undefined;
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return { connectionString };
  }
  const mode = url.searchParams.get('sslmode');
  const wantsTls = Boolean(ca) || (mode !== null && TLS_MODES.has(mode));
  if (!wantsTls) return { connectionString };
  for (const p of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) url.searchParams.delete(p);
  return { connectionString: url.toString(), ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false } };
}

export function createPgAdapter(connectionString: string, caPem: string | undefined = process.env.DATABASE_SSL_CA): PrismaPg {
  return new PrismaPg(pgConnectionConfig(connectionString, caPem));
}
