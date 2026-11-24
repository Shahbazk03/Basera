/**
 * MongoDB sorts enum values alphabetically and puts nulls first; PostgreSQL sorted enums in their
 * declaration order (TODO before DONE, Residential before Commercial) and supported NULLS LAST.
 * These helpers keep the orders the screens were built for.
 */

/** Position of a value in an enum's declaration order (pass the generated enum, e.g. TaskStatus). */
export function enumRank(enumObj: Record<string, string>): (value: string) => number {
  const order = Object.values(enumObj);
  return (value) => {
    const i = order.indexOf(value);
    return i === -1 ? order.length : i;
  };
}

/** Stable in-memory sort by enum declaration order; rows keep their existing order within a value. */
export function sortByEnum<T>(rows: T[], key: (row: T) => string, enumObj: Record<string, string>, direction: 'asc' | 'desc' = 'asc'): T[] {
  const rank = enumRank(enumObj);
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => sign * (rank(key(a)) - rank(key(b))));
}

/** Stable: moves rows whose key is null to the end (PostgreSQL's ascending default), keeping the rest in order. */
export function nullsLast<T>(rows: T[], key: (row: T) => unknown): T[] {
  return [...rows].sort((a, b) => Number(key(a) === null || key(a) === undefined) - Number(key(b) === null || key(b) === undefined));
}

/** One slice of an ordered list: the rows matching `where`, sorted by `orderBy`. */
export interface Segment<W, O> {
  where: W;
  orderBy: O;
}

/**
 * Paginates a list whose order MongoDB cannot express in one sort — e.g. enum declaration order or
 * "nulls last". The list is the concatenation of `segments`; each is counted, and only the segments
 * the requested page overlaps are read.
 */
export async function segmentedPage<W, O, R>(
  segments: Segment<W, O>[],
  ops: { count(where: W): Promise<number>; find(args: { where: W; orderBy: O; skip: number; take: number }): Promise<R[]> },
  page: { skip: number; take: number },
): Promise<{ rows: R[]; total: number }> {
  const counts = await Promise.all(segments.map((s) => ops.count(s.where)));
  const total = counts.reduce((a, b) => a + b, 0);
  const rows: R[] = [];
  let offset = page.skip;
  for (let i = 0; i < segments.length && rows.length < page.take; i += 1) {
    if (offset >= counts[i]) {
      offset -= counts[i];
      continue;
    }
    rows.push(...(await ops.find({ where: segments[i].where, orderBy: segments[i].orderBy, skip: offset, take: page.take - rows.length })));
    offset = 0;
  }
  return { rows, total };
}
