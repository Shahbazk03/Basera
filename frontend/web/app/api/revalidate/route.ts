import { revalidatePath } from 'next/cache';

const API = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/**
 * The API calls this after something shown on the website was changed in the console. The one-time code
 * is confirmed with the API before every cached page is marked for refresh on its next visit, so nobody
 * else can trigger it.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = body?.code;
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(code)) return Response.json({ ok: false }, { status: 400 });
  const check = await fetch(`${API}/api/v1/public/site-revalidation/${code}`, { cache: 'no-store' }).catch(() => null);
  if (check?.status !== 204) return Response.json({ ok: false }, { status: 403 });
  revalidatePath('/', 'layout');
  return Response.json({ ok: true });
}
