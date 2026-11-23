import Image from 'next/image';
import Link from 'next/link';
import type { ProjectCard as ProjectCardData, PropertyCard as PropertyCardData } from '@estate/shared';
import { pluralize } from '@estate/shared';
import { apiGet, getSettings, siteUrl } from '@/lib/api-server';
import { HeroSearch, type HeroPropertyType } from '@/components/home/hero-search';
import { BrokerTiles, LocalityTiles, ProjectGrid, PropertyGrid, RecentList, Section, SectionHeader, WhyChooseUs, type BrokerTile } from '@/components/home/sections';
import { CategoryTabs, type CategoryTab } from '@/components/home/category-tabs';
import { EnquiryForm } from '@/components/enquiry/enquiry-form';

export const revalidate = 60;

interface HomeSection {
  type: string;
  title: string | null;
  subtitle: string | null;
  config: { points?: { title: string; text: string }[] } & Record<string, unknown>;
  data: unknown;
}

interface HeroData {
  banners: { id: string; title: string; subtitle: string | null; imageUrl: string; linkUrl: string | null }[];
  quickLocalities: { name: string; slug: string }[];
  counts: { liveListings: number; liveProjects: number; verifiedPartners: number };
}

export default async function HomePage() {
  const [home, settings, types] = await Promise.all([
    apiGet<{ city: { name: string; slug: string } | null; sections: HomeSection[] }>('/public/home'),
    getSettings(),
    apiGet<HeroPropertyType[]>('/public/property-types', undefined, { revalidate: 600 }),
  ]);
  const citySlug = home.city?.slug ?? settings.marketplace.defaultCitySlug;
  const cityName = home.city?.name ?? 'Lucknow';
  let tabsRendered = false;
  const base = siteUrl();
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: settings.brand.name,
      url: base,
      potentialAction: { '@type': 'SearchAction', target: `${base}/buy/${citySlug}?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'RealEstateAgent',
      name: settings.company.legalName || settings.brand.name,
      url: base,
      areaServed: cityName,
      ...(settings.contact.phone ? { telephone: settings.contact.phone } : {}),
      ...(settings.contact.email ? { email: settings.contact.email } : {}),
      ...(settings.contact.address ? { address: settings.contact.address } : {}),
    },
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      {home.sections.map((s) => {
        switch (s.type) {
          case 'HERO_SEARCH': {
            const d = s.data as HeroData;
            const banner = d.banners[0];
            const { liveListings, liveProjects, verifiedPartners } = d.counts;
            return (
              <section key={s.type} className="relative isolate overflow-hidden bg-ink-950">
                <Image src={banner?.imageUrl ?? '/images/hero-home.jpg'} alt="" fill priority sizes="100vw" className="-z-10 object-cover" />
                <div className="absolute inset-0 -z-10 bg-gradient-to-r from-ink-950/90 via-ink-950/60 to-ink-950/15" />
                <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-ink-950/60 to-transparent" />
                <div className="container-page py-16 md:py-24">
                  <div className="max-w-2xl">
                    <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-white/70">{cityName} · Uttar Pradesh</p>
                    <h1 className="mt-3 text-[34px] font-extrabold leading-[1.08] tracking-tight text-white sm:text-[44px] lg:text-[52px]">{banner?.title ?? s.title ?? `Property in ${cityName}`}</h1>
                    {banner?.subtitle ?? s.subtitle ? <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-white/80 md:text-[17px]">{banner?.subtitle ?? s.subtitle}</p> : null}
                  </div>
                  <div className="mt-8 md:mt-10">
                    <HeroSearch citySlug={citySlug} propertyTypes={types} />
                  </div>
                  {d.quickLocalities.length ? (
                    <div className="mt-5 flex flex-wrap items-center gap-2 text-sm text-white/70">
                      <span className="mr-1">Popular:</span>
                      {d.quickLocalities.map((l) => (
                        <Link key={l.slug} href={`/buy/${citySlug}/${l.slug}`} className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-white/85 backdrop-blur transition-colors hover:bg-white/15">
                          {l.name}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                  {liveListings + liveProjects > 0 ? (
                    <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-3 border-t border-white/15 pt-6 text-white">
                      <div>
                        <dt className="text-xs text-white/60">Live listings</dt>
                        <dd className="tabular font-display text-2xl font-bold">{liveListings.toLocaleString('en-IN')}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-white/60">Projects</dt>
                        <dd className="tabular font-display text-2xl font-bold">{liveProjects.toLocaleString('en-IN')}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-white/60">Verified partners</dt>
                        <dd className="tabular font-display text-2xl font-bold">{verifiedPartners.toLocaleString('en-IN')}</dd>
                      </div>
                    </dl>
                  ) : null}
                </div>
              </section>
            );
          }
          case 'FEATURED_PROPERTIES': {
            const items = s.data as PropertyCardData[];
            if (!items.length) return null;
            return (
              <Section key={s.type}>
                <SectionHeader title={s.title ?? 'Featured properties'} subtitle={s.subtitle} href={`/buy/${citySlug}`} />
                <PropertyGrid items={items.slice(0, items.length >= 8 ? 8 : 4)} />
              </Section>
            );
          }
          case 'POPULAR_LOCALITIES': {
            const items = s.data as { name: string; slug: string; listings: number; projects: number }[];
            if (!items.length) return null;
            return (
              <Section key={s.type} tone="canvas">
                <SectionHeader title={s.title ?? 'Popular localities'} subtitle={s.subtitle} />
                <LocalityTiles items={items} citySlug={citySlug} />
              </Section>
            );
          }
          case 'FEATURED_PROJECTS': {
            const items = s.data as ProjectCardData[];
            if (!items.length) return null;
            return (
              <Section key={s.type}>
                <SectionHeader title={s.title ?? 'New projects'} subtitle={s.subtitle} href="/projects" linkLabel="All projects" />
                <ProjectGrid items={items} />
              </Section>
            );
          }
          case 'RESIDENTIAL_PLOTS':
          case 'COMMERCIAL': {
            if (tabsRendered) return null;
            tabsRendered = true;
            const plots = home.sections.find((x) => x.type === 'RESIDENTIAL_PLOTS');
            const commercial = home.sections.find((x) => x.type === 'COMMERCIAL');
            const tabs: CategoryTab[] = [];
            if (plots) tabs.push({ key: 'plots', label: 'Plots', title: plots.title ?? 'Residential plots', subtitle: plots.subtitle, href: `/buy/${citySlug}?type=residential-plot`, items: plots.data as PropertyCardData[] });
            if (commercial) tabs.push({ key: 'commercial', label: 'Commercial', title: commercial.title ?? 'Commercial spaces', subtitle: commercial.subtitle, href: `/buy/${citySlug}?segment=COMMERCIAL`, items: commercial.data as PropertyCardData[] });
            return (
              <Section key="categories" tone="canvas">
                <CategoryTabs tabs={tabs} />
              </Section>
            );
          }
          case 'RECENT_LISTINGS': {
            const items = s.data as PropertyCardData[];
            if (!items.length) return null;
            return (
              <Section key={s.type}>
                <SectionHeader title={s.title ?? 'Recently added'} subtitle={s.subtitle} href={`/buy/${citySlug}?sort=newest`} />
                <RecentList items={items} />
              </Section>
            );
          }
          case 'VERIFIED_BROKERS': {
            const items = s.data as BrokerTile[];
            if (!items.length) return null;
            return (
              <Section key={s.type} tone="canvas">
                <SectionHeader title={s.title ?? 'Verified brokers'} subtitle={s.subtitle} href="/partners/register" linkLabel="Become a partner" />
                <BrokerTiles items={items} />
              </Section>
            );
          }
          case 'WHY_CHOOSE_US': {
            const points = s.config.points ?? [];
            if (!points.length) return null;
            return (
              <Section key={s.type}>
                <WhyChooseUs title={s.title ?? 'Why buyers use us'} points={points} />
              </Section>
            );
          }
          case 'ENQUIRY_CTA':
            return (
              <section key={s.type} className="bg-ink-950 py-16 md:py-20">
                <div className="container-page grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
                  <div>
                    <h2 className="text-[28px] font-bold leading-tight text-white md:text-[34px]">{s.title ?? 'Tell us what you are looking for'}</h2>
                    {s.subtitle ? <p className="mt-3 max-w-lg text-[16px] leading-relaxed text-white/70">{s.subtitle}</p> : null}
                    <ul className="mt-6 space-y-2 text-sm text-white/70">
                      <li>You receive a reference number for every request.</li>
                      <li>A relationship manager contacts you — usually the same working day.</li>
                      <li>Your number is shared only with the seller or agent you choose.</li>
                    </ul>
                    {(home.sections.find((x) => x.type === 'HERO_SEARCH')?.data as HeroData | undefined)?.counts ? (
                      <p className="mt-6 text-xs text-white/45">
                        Currently {pluralize((home.sections.find((x) => x.type === 'HERO_SEARCH')!.data as HeroData).counts.liveListings, 'live listing')} in {cityName}.
                      </p>
                    ) : null}
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                    <EnquiryForm type="GENERAL" tone="dark" submitLabel="Send my requirement" messagePlaceholder="e.g. 3 BHK in Gomti Nagar under ₹1.2 Cr" />
                  </div>
                </div>
              </section>
            );
          default:
            return null;
        }
      })}
    </>
  );
}
