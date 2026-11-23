import { computeProjectStatus, enumLabel, type ProjectCard } from '@estate/shared';
import { Prisma } from '../../generated/prisma/client';
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

/** One aggregate query for many projects' live inventory. */
export async function unitStatsFor(db: Db, projectIds: string[]): Promise<Map<string, UnitStats>> {
  if (!projectIds.length) return new Map();
  const rows = await db.$queryRaw<{ projectId: string; available: bigint; released: bigint; total: bigint; priceMin: Prisma.Decimal | null; priceMax: Prisma.Decimal | null; types: string[] | null }[]>`
    SELECT "projectId",
      count(*) FILTER (WHERE status = 'AVAILABLE') AS available,
      count(*) FILTER (WHERE status NOT IN ('NOT_RELEASED', 'BLOCKED')) AS released,
      count(*) AS total,
      min("totalPrice") FILTER (WHERE status NOT IN ('NOT_RELEASED', 'BLOCKED')) AS "priceMin",
      max("totalPrice") FILTER (WHERE status NOT IN ('NOT_RELEASED', 'BLOCKED')) AS "priceMax",
      array_agg(DISTINCT COALESCE(configuration, "unitType"::text)) AS types
    FROM project_units
    WHERE "projectId" = ANY(${projectIds}::uuid[])
    GROUP BY "projectId"`;
  return new Map(
    rows.map((r) => [
      r.projectId,
      {
        available: Number(r.available),
        released: Number(r.released),
        total: Number(r.total),
        priceMin: r.priceMin === null ? null : Number(r.priceMin),
        priceMax: r.priceMax === null ? null : Number(r.priceMax),
        types: (r.types ?? []).filter(Boolean),
      },
    ]),
  );
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
