import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { enumLabel, type Paginated, type ProjectCard as Card } from '@estate/shared';
import { EmptyState, Pagination } from '@estate/ui';
import { apiGet, apiGetOptional, getSettings, siteUrl } from '@/lib/api-server';
import { ProjectCard } from '@/components/cards/project-card';
import { ProjectFilters } from '@/components/projects/project-filters';

export const revalidate = 60;

type SP = Record<string, string | string[] | undefined>;
type Props = { searchParams: Promise<SP> };

const KEYS = ['q', 'locality', 'projectType', 'status', 'minPrice', 'maxPrice', 'developer', 'page'] as const;

function pick(sp: SP): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of KEYS) {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    if (s) out[k] = s.slice(0, 100);
  }
  return out;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = pick(await searchParams);
  const s = await getSettings();
  const city = s.marketplace.defaultCitySlug === 'lucknow' ? 'Lucknow' : s.marketplace.defaultCitySlug;
  const typeLabel = sp.projectType ? `${enumLabel(sp.projectType)} projects` : 'New projects';
  return {
    title: `${typeLabel} in ${city}`,
    description: `Browse ${typeLabel.toLowerCase()} in ${city} with live inventory, prices, booking status and RERA details.`,
    alternates: { canonical: `${siteUrl()}/projects` },
    robots: Object.keys(sp).some((k) => k !== 'page') ? { index: false, follow: true } : undefined,
  };
}

export default async function ProjectsPage({ searchParams }: Props) {
  const sp = pick(await searchParams);
  const settings = await getSettings();
  const citySlug = settings.marketplace.defaultCitySlug || 'lucknow';
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const [result, localities] = await Promise.all([
    apiGet<Paginated<Card> & { appliedCity: { name: string; slug: string } | null }>('/public/projects', { ...sp, page, pageSize: 12 }, { revalidate: 30 }),
    apiGetOptional<{ name: string; slug: string; activeListings: number }[]>(`/public/cities/${citySlug}/localities`, undefined, 600),
  ]);
  const cityName = result.appliedCity?.name ?? 'Lucknow';
  const qs = (p: number) => {
    const next = new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][]);
    return `/projects?${next.toString()}`;
  };

  return (
    <div className="pb-16">
      <section className="border-b border-line bg-canvas">
        <div className="container-page py-10 md:py-12">
          <nav aria-label="Breadcrumb" className="text-[13px] text-ink-500">
            <Link href="/" className="hover:text-ink-900">
              Home
            </Link>
            <span className="mx-1.5">/</span>
            <span className="text-ink-700">New projects</span>
          </nav>
          <h1 className="mt-3 text-[30px] font-bold tracking-tight text-ink-900 md:text-[38px]">New projects in {cityName}</h1>
          <p className="mt-2 max-w-2xl text-[15.5px] text-ink-600">Launches and ongoing developments with live unit availability, booking windows and RERA details — straight from each project&apos;s inventory.</p>
          <div className="mt-6">
            <Suspense fallback={<div className="h-[66px] rounded-xl border border-line bg-surface" />}>
              <ProjectFilters localities={(localities ?? []).map((l) => ({ name: l.name, slug: l.slug }))} />
            </Suspense>
          </div>
        </div>
      </section>

      <div className="container-page pt-8">
        <p className="text-sm text-ink-600">
          <span className="font-semibold text-ink-900 tabular">{result.meta.total}</span> {result.meta.total === 1 ? 'project' : 'projects'}
        </p>
        {result.data.length ? (
          <>
            <ul className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {result.data.map((p) => (
                <li key={p.id}>
                  <ProjectCard p={p} />
                </li>
              ))}
            </ul>
            <div className="mt-10">
              <Pagination page={result.meta.page} totalPages={result.meta.totalPages} total={result.meta.total} pageSize={result.meta.pageSize} hrefForPage={qs} />
            </div>
          </>
        ) : (
          <div className="mt-6 rounded-xl border border-line">
            <EmptyState icon={<Building2 />} title="No projects match your filters" description="Try a different locality, budget or status — or clear the filters to see every project." />
          </div>
        )}
      </div>
    </div>
  );
}
