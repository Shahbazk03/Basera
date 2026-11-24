// Server-side helper (used by the root layout).
const API = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/** The configured brand name (cached for 5 minutes); "Console" only if the API cannot be reached. */
export async function getBrandName(): Promise<string> {
  try {
    const res = await fetch(`${API}/api/v1/public/settings`, { headers: { Accept: 'application/json', 'x-estate-internal': '1' }, next: { revalidate: 300 } });
    if (!res.ok) return 'Console';
    const data = (await res.json()) as { brand?: { name?: string } };
    return data.brand?.name?.trim() || 'Console';
  } catch {
    return 'Console';
  }
}
