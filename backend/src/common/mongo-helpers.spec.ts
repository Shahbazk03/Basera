import { TRIGRAM_MATCH_THRESHOLD, trigramSimilarity } from './fuzzy';
import { enumRank, nullsLast, segmentedPage, sortByEnum } from './ordering';
import { Prisma } from '@prisma/client';
import { escapeRegex } from '../prisma/mongo-guards';
import { ensureDatabaseRules } from '../prisma/database-rules';

const Status = { TODO: 'TODO', IN_PROGRESS: 'IN_PROGRESS', DONE: 'DONE', CANCELLED: 'CANCELLED' } as const;

describe('trigram similarity (pg_trgm rules)', () => {
  it('matches typos and word order like PostgreSQL did', () => {
    expect(trigramSimilarity('Gomti Nagar', 'Gomti Nagar')).toBe(1);
    expect(trigramSimilarity('Gomti Nagar', 'gomti nagr')).toBeGreaterThanOrEqual(TRIGRAM_MATCH_THRESHOLD);
    expect(trigramSimilarity('Hazratganj', 'hazratgang')).toBeGreaterThanOrEqual(TRIGRAM_MATCH_THRESHOLD);
    expect(trigramSimilarity('Gomti Nagar', 'Aliganj')).toBeLessThan(TRIGRAM_MATCH_THRESHOLD);
    expect(trigramSimilarity('', 'Aliganj')).toBe(0);
  });
});

describe('enum ordering', () => {
  it('ranks and sorts by declaration order, not alphabetically', () => {
    const rank = enumRank(Status);
    expect(rank('TODO')).toBeLessThan(rank('CANCELLED'));
    expect(rank('UNKNOWN')).toBe(4);
    const rows = [{ s: 'CANCELLED' }, { s: 'DONE' }, { s: 'TODO' }, { s: 'IN_PROGRESS' }, { s: 'TODO' }];
    expect(sortByEnum(rows, (r) => r.s, Status).map((r) => r.s)).toEqual(['TODO', 'TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED']);
    expect(sortByEnum(rows, (r) => r.s, Status, 'desc')[0].s).toBe('CANCELLED');
  });

  it('puts nulls last without disturbing the existing order', () => {
    const rows = [{ g: null, t: 'a' }, { g: 'Company', t: 'b' }, { g: null, t: 'c' }, { g: 'Legal', t: 'd' }];
    expect(nullsLast(rows, (r) => r.g).map((r) => r.t)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('paginates across segments exactly like one ordered list', async () => {
    const data: Record<string, number[]> = { a: [1, 2, 3], b: [], c: [4, 5], d: [6, 7, 8, 9] };
    const segments = Object.keys(data).map((k) => ({ where: k, orderBy: 'asc' }));
    const ops = {
      count: async (w: string) => data[w].length,
      find: async ({ where, skip, take }: { where: string; orderBy: string; skip: number; take: number }) => data[where].slice(skip, skip + take),
    };
    const all = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (const take of [1, 2, 4, 10]) {
      for (let skip = 0; skip <= 10; skip += 1) {
        const page = await segmentedPage(segments, ops, { skip, take });
        expect(page.total).toBe(9);
        expect(page.rows).toEqual(all.slice(skip, skip + take));
      }
    }
  });
});

describe('regex escaping for MongoDB text filters', () => {
  it('turns any text into a pattern that matches only itself', () => {
    for (const text of ['+919916851154', 'a.b', '(x)', '50%', 'C++', '[a-z]', 'back\\slash', 'x/y', '^$|?*{}']) {
      const re = new RegExp(escapeRegex(text));
      expect(re.test(text)).toBe(true);
      expect(re.test(text.replace(/[^a-z0-9]/gi, 'Q'))).toBe(/^[a-z0-9]*$/i.test(text));
    }
    expect(new RegExp(`^${escapeRegex('a.b')}$`).test('axb')).toBe(false);
  });
});

describe('database rules', () => {
  const ok = { ok: 1 } as unknown as Prisma.JsonObject;
  const fakeDb = (failCollMod: (cmd: Record<string, unknown>) => Error | null) => ({
    $runCommandRaw: (cmd: Record<string, unknown>) => {
      const err = 'collMod' in cmd ? failCollMod(cmd) : null;
      return (err ? Promise.reject(err) : Promise.resolve('listCollections' in cmd ? { cursor: { firstBatch: [] } } : ok)) as unknown as Prisma.PrismaPromise<Prisma.JsonObject>;
    },
  });
  const raw = (code: string) => new Prisma.PrismaClientKnownRequestError('Raw query failed', { code: 'P2010', clientVersion: 'test', meta: { code, message: 'x' } });

  it('warns (instead of failing start-up) when the user may not install validators', async () => {
    const warnings = await ensureDatabaseRules(fakeDb(() => raw('13')));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/dbAdmin/);
  });

  it('still fails on other errors', async () => {
    await expect(ensureDatabaseRules(fakeDb(() => raw('2')))).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(await ensureDatabaseRules(fakeDb(() => null))).toEqual([]);
  });
});
