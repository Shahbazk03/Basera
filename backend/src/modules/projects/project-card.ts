import { computeProjectStatus, enumLabel, type ProjectCard } from '@estate/shared';
import { Prisma } from '@prisma/client';
import type { Db } from '../../prisma/prisma.service';
import { iso, isoDate, num } from '../../common/http';

/** Public visibility rule for projects (published, approved, not draft/archived, managing org active). */
export function publicProjectWhere(): Prisma.ProjectWhereInput {
  return {
    deletedAt: null,
    isPublished: true,
    reviewStatus: 'APPROVED',
    status: { notIn: ['DRAFT', 'ARCHIVED'] },
    organization: { status: 'ACTIVE', deletedAt: null },
  };
}

export const projectCardSelect = {
  id: true,
  slug: true,
  name: true,
  tagline: true,
  projectType: true,
  status: true,
  autoStatus: true,
  bookingOpensAt: true,
  bookingClosesAt: true,
  closingSoonHours: true,
  heroImageUrl: true,
  priceMinOverride: true,
  priceMaxOverride: true,
  reraNumber: true,
  possessionDate: true,
  isFeatured: true,
  isDemo: true,
  city: { select: { id: true, name: true, slug: true } },
  locality: { select: { id: true, name: true, slug: true } },
  developerOrg: { select: { id: true, name: true, slug: true, type: true, logoUrl: true, verificationStatus: true } },
} satisfies Prisma.ProjectSelect;

export type ProjectCardRow = Prisma.ProjectGetPayload<{ select: typeof projectCardSelect }>;

export interface UnitStats {
  available: number;
  released: number;
  total: number;
  priceMin: number | null;
  priceMax: number | null;
  types: string[];
}

const UNRELEASED = new Set(['NOT_RELEASED', 'BLOCKED']);

/** Live inventory for many projects: two grouped queries (by status, and by unit type/configuration). */
export async function unitStatsFor(db: Db, projectIds: string[]): Promise<Map<string, UnitStats>> {
  if (!projectIds.length) return new Map();
  const [byStatus, byType] = await Promise.all([
    db.projectUnit.groupBy({ by: ['projectId', 'status'], where: { projectId: { in: projectIds } }, _count: { _all: true }, _min: { totalPrice: true }, _max: { totalPrice: true } }),
    db.projectUnit.groupBy({ by: ['projectId', 'configuration', 'unitType'], where: { projectId: { in: projectIds } } }),
  ]);
  const stats = new Map<string, UnitStats>();
  const get = (id: string) => {
    let s = stats.get(id);
    if (!s) stats.set(id, (s = { available: 0, released: 0, total: 0, priceMin: null, priceMax: null, types: [] }));
    return s;
  };
  for (const g of byStatus) {
    const s = get(g.projectId);
    s.total += g._count._all;
    if (g.status === 'AVAILABLE') s.available += g._count._all;
    if (UNRELEASED.has(g.status)) continue;
    s.released += g._count._all;
    if (g._min.totalPrice !== null) s.priceMin = s.priceMin === null ? g._min.totalPrice : Math.min(s.priceMin, g._min.totalPrice);
    if (g._max.totalPrice !== null) s.priceMax = s.priceMax === null ? g._max.totalPrice : Math.max(s.priceMax, g._max.totalPrice);
  }
  const types = new Map<string, Set<string>>();
  for (const g of byType) {
    const label = g.configuration ?? g.unitType;
    if (!label) continue;
    let set = types.get(g.projectId);
    if (!set) types.set(g.projectId, (set = new Set()));
    set.add(label);
  }
  for (const [id, set] of types) get(id).types = [...set].sort();
  return stats;
}

function unitTypeLabel(t: string): string {
  return /^[A-Z_]+$/.test(t) ? `${enumLabel(t)}s` : t;
}

export function toProjectCard(p: ProjectCardRow, stats: UnitStats | undefined, now: Date = new Date()): ProjectCard {
  const s = stats ?? { available: 0, released: 0, total: 0, priceMin: null, priceMax: null, types: [] };
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    tagline: p.tagline,
    projectType: p.projectType,
    status: computeProjectStatus(
      {
        status: p.status,
        autoStatus: p.autoStatus,
        bookingOpensAt: p.bookingOpensAt,
        bookingClosesAt: p.bookingClosesAt,
        closingSoonHours: p.closingSoonHours,
        availableUnits: s.available,
        releasedUnits: s.released,
      },
      now,
    ),
    city: p.city,
    locality: p.locality,
    developer: p.developerOrg
      ? { id: p.developerOrg.id, name: p.developerOrg.name, slug: p.developerOrg.slug, type: p.developerOrg.type, logoUrl: p.developerOrg.logoUrl, isVerified: p.developerOrg.verificationStatus === 'VERIFIED' }
      : null,
    heroImageUrl: p.heroImageUrl,
    priceMin: s.priceMin ?? num(p.priceMinOverride),
    priceMax: s.priceMax ?? num(p.priceMaxOverride),
    unitTypes: [...new Set(s.types.map(unitTypeLabel))].sort(),
    availableUnits: s.available,
    totalUnits: s.total,
    reraNumber: p.reraNumber,
    possessionDate: isoDate(p.possessionDate),
    bookingOpensAt: iso(p.bookingOpensAt),
    bookingClosesAt: iso(p.bookingClosesAt),
    isFeatured: p.isFeatured,
    isDemo: p.isDemo,
  };
}

export async function projectCards(db: Db, where: Prisma.ProjectWhereInput, take: number, orderBy: Prisma.ProjectOrderByWithRelationInput[] = [{ isFeatured: 'desc' }, { publishedAt: 'desc' }]): Promise<ProjectCard[]> {
  const rows = await db.project.findMany({ where: { ...publicProjectWhere(), ...where }, select: projectCardSelect, orderBy, take });
  const stats = await unitStatsFor(db, rows.map((r) => r.id));
  const now = new Date();
  return rows.map((r) => toProjectCard(r, stats.get(r.id), now));
}
