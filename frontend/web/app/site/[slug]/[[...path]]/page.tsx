import type { Metadata } from 'next';
import Image from 'next/image';
import { headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import { MapPin, ShieldCheck } from 'lucide-react';
import type { ProjectDetail } from '@estate/shared';
import { apiGet, apiGetOptional, getSettings, siteUrl } from '@/lib/api-server';
import { isMarketplaceHost, normalizeHost } from '@/lib/hosts';
import { ProjectPage, projectAddress } from '@/components/projects/project-page';
import { ProjectCta } from '@/components/projects/project-cta';
import { projectJsonLd } from '@/components/projects/json-ld';

// Reading the request host makes every render dynamic; API reads below stay in the 30 s data cache.
export const revalidate = 30;

type SP = Record<string, string | string[] | undefined>;
type Props = { params: Promise<{ slug: string; path?: string[] }>; searchParams: Promise<SP> };


type FooterPages = ({ slug: string; title: string; footerGroup?: string | null } | { group: string; links: { slug: string; title: string }[] })[];

/** Legal pages (privacy, terms…) as configured in the CMS footer — linked on the main site, same paths as its footer. */
async function legalLinks(): Promise<{ slug: string; title: string }[]> {
  const pages = (await apiGetOptional<FooterPages>('/public/pages', { footer: true }, 300)) ?? [];
  return pages.flatMap((g) => ('links' in g ? (g.group.toLowerCase() === 'legal' ? g.links : []) : (g.footerGroup ?? '').toLowerCase() === 'legal' ? [g] : []));
}

function previewParam(sp: SP): string | undefined {
  const v = Array.isArray(sp.preview) ? sp.preview[0] : sp.preview;
  return v && v.length <= 200 ? v : undefined;
}

/**
 * Loads the project for a microsite request. proxy.ts rewrites ACTIVE mapped hosts to
 * /site/<slug>/<path>, but /site/* is also reachable directly, so the host is re-checked here:
 *  • a marketplace host is redirected to the canonical /projects/<slug> page;
 *  • any other host must resolve (verified, ACTIVE domain of a public project) to exactly this slug,
 *    so an unmapped or unverified host can never serve a project, and one project's domain can
 *    never serve another project.
 * Unknown projects/hosts → 404 (apiGet maps API 404s to notFound()).
 */
async function loadMicrosite({ params, searchParams }: Props): Promise<ProjectDetail> {
  const { slug, path } = await params;
  const h = await headers();
  const host = normalizeHost(h.get('x-forwarded-host') ?? h.get('host'));
  if (isMarketplaceHost(host)) permanentRedirect(`/projects/${encodeURIComponent(slug)}`);
  if (path?.length) notFound();
  const mapped = await apiGet<{ projectSlug: string }>('/public/domains/resolve', { host }, { revalidate: 30 });
  if (mapped.projectSlug !== slug) notFound();
  const preview = previewParam(await searchParams);
  return apiGet<ProjectDetail>(`/public/projects/${encodeURIComponent(slug)}`, preview ? { preview } : undefined, { revalidate: preview ? 0 : 30 });
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const p = await loadMicrosite(props);
  return {
    // The microsite is the project's own site: no marketplace title suffix.
    title: { absolute: p.seo.title },
    description: p.seo.description,
    alternates: { canonical: p.canonicalUrl },
    openGraph: { title: p.seo.title, description: p.seo.description, siteName: p.name, images: p.seo.ogImageUrl ? [{ url: p.seo.ogImageUrl }] : undefined, type: 'website', url: p.canonicalUrl },
    robots: p.isPreview || p.isDemo ? { index: false, follow: !p.isPreview } : undefined,
  };
}

export default async function MicrositePage(props: Props) {
  const p = await loadMicrosite(props);
  const [settings, legal] = await Promise.all([getSettings(), legalLinks()]);
  const main = siteUrl();
  const brand = settings.brand.name;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(projectJsonLd(p, p.canonicalUrl)).replace(/</g, '\\u003c') }} />
      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
        <div className="container-page flex h-16 items-center justify-between gap-4">
          <a href="#top" className="flex min-w-0 items-center gap-3" aria-label={`${p.name} — top of page`}>
            {p.logoUrl ? (
              <Image src={p.logoUrl} alt="" width={140} height={40} className="h-9 w-auto object-contain" />
            ) : (
              <span className="truncate font-display text-[18px] font-bold tracking-tight text-ink-900">{p.name}</span>
            )}
          </a>
          <div className="flex shrink-0 items-center gap-3">
            {p.reraNumber ? (
              <span className="hidden items-center gap-1 text-xs text-ink-500 md:inline-flex">
                <ShieldCheck className="size-3.5" /> RERA {p.reraNumber}
              </span>
            ) : null}
            <ProjectCta action="CALLBACK" label="Request callback" projectId={p.id} projectName={p.name} whatsappAvailable={p.whatsappAvailable} variant="outline" size="sm" />
          </div>
        </div>
      </header>

      <main id="main">
        <ProjectPage p={p} variant="microsite" />
      </main>

      <footer className="border-t border-line bg-canvas">
        <div className="container-page grid gap-8 py-10 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div>
            <p className="font-display text-lg font-bold text-ink-900">{p.name}</p>
            <p className="mt-2 flex items-start gap-1.5 text-sm text-ink-600">
              <MapPin className="mt-0.5 size-4 shrink-0 text-ink-400" />
              {projectAddress(p)}
            </p>
            {p.developer ? <p className="mt-2 text-sm text-ink-600">Developed by {p.developer.name}</p> : null}
            {p.reraNumber ? <p className="mt-1 text-sm text-ink-600">RERA registration: {p.reraNumber}</p> : null}
          </div>
          <div className="text-sm text-ink-600 md:text-right">
            <p>
              Marketed on{' '}
              <a href={main} className="font-medium text-brand-strong hover:underline">
                {brand}
              </a>
            </p>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 md:justify-end">
              {legal.map((l) => (
                <a key={l.slug} href={`${main}/${encodeURIComponent(l.slug)}`} className="hover:text-ink-900">
                  {l.title}
                </a>
              ))}
              <a href={`${main}/projects/${encodeURIComponent(p.slug)}`} className="hover:text-ink-900">
                View on {brand}
              </a>
            </p>
          </div>
        </div>
        <div className="border-t border-line">
          <p className="container-page py-4 text-xs leading-relaxed text-ink-500">
            © {new Date().getFullYear()} {settings.company.legalName || brand}. Images are representative. Prices, availability and specifications are indicative and are confirmed in writing at booking. No payments are accepted on this website.
          </p>
        </div>
      </footer>
    </>
  );
}
