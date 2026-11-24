import type { Metadata } from 'next';
import type { ProjectCard as Card, ProjectDetail } from '@estate/shared';
import { apiGet, apiGetOptional, siteUrl } from '@/lib/api-server';
import { ProjectCard } from '@/components/cards/project-card';
import { ProjectPage } from '@/components/projects/project-page';
import { projectJsonLd } from '@/components/projects/json-ld';

export const revalidate = 30;

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Unpublished/unknown projects 404 (apiGet maps API 404s to notFound()); drafts render only with a valid preview token. */
function load(slug: string, preview?: string): Promise<ProjectDetail> {
  return apiGet<ProjectDetail>(`/public/projects/${encodeURIComponent(slug)}`, preview ? { preview } : undefined, { revalidate: preview ? 0 : 30 });
}

function previewParam(sp: Record<string, string | string[] | undefined>): string | undefined {
  const v = Array.isArray(sp.preview) ? sp.preview[0] : sp.preview;
  return v && v.length <= 200 ? v : undefined;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const p = await load(slug, previewParam(await searchParams));
  return {
    title: p.seo.title,
    description: p.seo.description,
    alternates: { canonical: p.canonicalUrl },
    openGraph: { title: p.seo.title, description: p.seo.description, images: p.seo.ogImageUrl ? [{ url: p.seo.ogImageUrl }] : undefined, type: 'website', url: p.canonicalUrl },
    robots: p.isPreview || p.isDemo ? { index: false, follow: !p.isPreview } : undefined,
  };
}

export default async function ProjectRoute({ params, searchParams }: Props) {
  const { slug } = await params;
  const p = await load(slug, previewParam(await searchParams));
  const related = p.isPreview ? [] : ((await apiGetOptional<Card[]>(`/public/projects/${encodeURIComponent(p.slug)}/related`)) ?? []);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(projectJsonLd(p, `${siteUrl()}/projects/${p.slug}`)).replace(/</g, '\\u003c') }} />
      <ProjectPage p={p} variant="marketplace" />
      {related.length ? (
        <section aria-labelledby="related" className="border-t border-line py-14">
          <div className="container-page">
            <h2 id="related" className="text-[24px] font-bold tracking-tight text-ink-900">
              More projects nearby
            </h2>
            <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {related.map((r) => (
                <li key={r.id}>
                  <ProjectCard p={r} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </>
  );
}
