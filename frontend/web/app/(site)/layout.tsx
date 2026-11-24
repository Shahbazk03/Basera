import { apiGetOptional, getSettings } from '@/lib/api-server';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter, type FooterPageLink } from '@/components/layout/site-footer';

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings();
  const citySlug = settings.marketplace.defaultCitySlug || 'lucknow';
  const [cities, localities, pages] = await Promise.all([
    apiGetOptional<{ name: string; slug: string }[]>('/public/cities', undefined, 600),
    apiGetOptional<{ name: string; slug: string }[]>(`/public/cities/${citySlug}/localities`, { popular: true }, 600),
    apiGetOptional<(FooterPageLink | { group: string; links: { slug: string; title: string }[] })[]>('/public/pages', { footer: true }, 300),
  ]);
  const cityName = cities?.find((c) => c.slug === citySlug)?.name ?? 'Lucknow';
  // The CMS returns footer links grouped by footer column; flatten into page links.
  const pageList: FooterPageLink[] = (pages ?? []).flatMap((p) =>
    'links' in p ? p.links.map((l) => ({ slug: l.slug, title: l.title, footerGroup: p.group })) : 'slug' in p && p.slug ? [p] : [],
  );
  const nav = [
    { label: 'Buy', href: `/buy/${citySlug}` },
    { label: 'Rent', href: `/rent/${citySlug}` },
    { label: 'New projects', href: '/projects' },
    { label: 'Plots', href: `/buy/${citySlug}?type=residential-plot` },
    { label: 'Commercial', href: `/buy/${citySlug}?segment=COMMERCIAL` },
  ];
  return (
    <>
      {settings.environment !== 'production' ? (
        <div className="bg-ink-950 text-center text-[12px] text-white/70">
          <p className="container-page py-1.5">Development environment — listings, projects and partners marked “Demo” are sample data, not real properties.</p>
        </div>
      ) : null}
      <SiteHeader brandName={settings.brand.name} logoUrl={settings.brand.logoUrl} nav={nav} />
      <main id="main">{children}</main>
      <SiteFooter settings={settings} cityName={cityName} citySlug={citySlug} localities={localities ?? []} pages={pageList} />
    </>
  );
}
