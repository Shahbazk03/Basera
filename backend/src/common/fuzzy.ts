/**
 * Trigram similarity with the same rules as PostgreSQL's pg_trgm (which the PostgreSQL version used):
 * lower-cased words padded with two leading spaces and one trailing space, similarity =
 * shared trigrams / all distinct trigrams. pg_trgm's default match threshold is 0.3.
 */
export const TRIGRAM_MATCH_THRESHOLD = 0.3;

export function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!word) continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) out.add(padded.slice(i, i + 3));
  }
  return out;
}

export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}
