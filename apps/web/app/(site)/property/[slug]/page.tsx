import type { Metadata } from 'next';
import Link from 'next/link';
import { BadgeCheck, Building2, CalendarDays, ChevronRight, FileText, MapPin, ShieldCheck } from 'lucide-react';
import {
  enumLabel,
  formatArea,
  formatDate,
  formatINR,
  formatNumber,
  formatPriceCompact,
  FORM_PROFILES,
  type FormProfileKey,
  type PropertyCard as CardData,
  type PropertyDetail,
} from '@estate/shared';
import { Alert, AmenityIcon, Badge, DescriptionList } from '@estate/ui';
import { apiGet, apiGetOptional, siteUrl } from '@/lib/api-server';
import { Gallery } from '@/components/property/gallery';
import { LocationMap } from '@/components/property/location-map';
import { ReportListing } from '@/components/property/report-listing';
import { FavouriteButton } from '@/components/common/favourite-button';
import { ShareButton } from '@/components/common/share-button';
import { EnquiryPanel } from '@/components/enquiry/enquiry-panel';
import { PropertyCard } from '@/components/cards/property-card';

export const revalidate = 60;

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  return apiGet<PropertyDetail & { isPreview?: boolean }>(`/public/properties/${encodeURIComponent(slug)}`, undefined, { revalidate: 60 });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const p = await load(slug);
  const price = p.listingType === 'RENT' ? `${formatPriceCompact(p.price)}/month` : formatPriceCompact(p.price);
  const description = `${p.title} — ${price}, ${formatArea(p.area, p.areaUnit)} in ${p.locality.name}, ${p.city.name}. ${p.description.slice(0, 120)}`;
  return {
    title: `${p.title} — ${price}`,
    description: description.slice(0, 170),
    alternates: { canonical: `${siteUrl()}/property/${p.slug}` },
    openGraph: { title: p.title, description: description.slice(0, 200), images: p.coverImageUrl ? [{ url: p.coverImageUrl }] : undefined, type: 'website' },
    robots: p.status === 'PUBLISHED' && !p.isDemo ? undefined : { index: false, follow: true },
  };
}

function detailItems(p: PropertyDetail): { label: string; value: React.ReactNode }[] {
  const items: { label: string; value: React.ReactNode }[] = [
    { label: 'Property type', value: p.propertyType.name },
    { label: p.listingType === 'RENT' ? 'Monthly rent' : 'Price', value: formatINR(p.price) },
  ];
  const push = (label: string, v: unknown, fmt?: (v: never) => React.ReactNode) => {
    if (v === null || v === undefined || v === '') return;
    items.push({ label, value: fmt ? fmt(v as never) : String(v) });
  };
  push('Price per sq.ft', p.listingType === 'SALE' ? p.pricePerSqft : null, (v: number) => `₹${formatNumber(v)}`);
  push('Area', p.area, () => formatArea(p.area, p.areaUnit));
  push('Carpet area', p.carpetAreaSqft, (v: number) => formatArea(v, 'SQFT'));
  push('Built-up area', p.builtUpAreaSqft, (v: number) => formatArea(v, 'SQFT'));
  push('Super built-up area', p.superAreaSqft, (v: number) => formatArea(v, 'SQFT'));
  push('Plot area', p.plotAreaSqft, (v: number) => formatArea(v, 'SQFT'));
  push('Bedrooms', p.bedrooms);
  push('Bathrooms', p.bathrooms);
  push('Balconies', p.balconies);
  push('Furnishing', p.furnishing, enumLabel);
  push('Floor', p.floorNumber, (v: number) => (p.totalFloors ? `${v === 0 ? 'Ground' : v} of ${p.totalFloors}` : v === 0 ? 'Ground' : String(v)));
  if (p.floorNumber == null) push('Total floors', p.totalFloors);
  push('Facing', p.facing, enumLabel);
  push('Possession', p.possessionStatus, enumLabel);
  push('Available from', p.availableFrom, (v: string) => formatDate(v));
  push('Age of property', p.ageYears, (v: number) => (v === 0 ? 'New' : `${v} ${v === 1 ? 'year' : 'years'}`));
  push('Plot dimensions', p.plotLengthFt && p.plotWidthFt ? `${p.plotWidthFt} × ${p.plotLengthFt} ft` : null);
  push('Road width', p.roadWidthFt, (v: number) => `${v} ft`);
  push('Corner plot', p.isCornerPlot, (v: boolean) => (v ? 'Yes' : 'No'));
  push('Ownership', p.ownershipType, enumLabel);
  push('Approved by', p.approvalAuthority);
  push('RERA registration', p.reraNumber);
  push('Covered parking', p.coveredParking);
  push('Open parking', p.openParking);
  push('Maintenance', p.maintenanceMonthly, (v: number) => `${formatINR(v)}/month`);
  push('Security deposit', p.securityDeposit, (v: number) => formatINR(v));
  push('Booking amount', p.bookingAmount, (v: number) => formatINR(v));
  const profile = FORM_PROFILES[p.formProfile as FormProfileKey];
  for (const def of profile?.attributes ?? []) {
    const v = p.attributes[def.key];
    if (v === undefined || v === null || v === '') continue;
    items.push({ label: def.label, value: typeof v === 'boolean' ? (v ? 'Yes' : 'No') : def.kind === 'number' && def.unit ? `${v} ${def.unit}` : String(v) });
  }
  return items;
}

export default async function PropertyPage({ params }: Props) {
  const { slug } = await params;
  const p = await load(slug);
  const similar = (await apiGetOptional<CardData[]>(`/public/properties/${encodeURIComponent(p.slug)}/similar`)) ?? [];
  const closed = p.status !== 'PUBLISHED';
  const images = p.media.filter((m) => m.type === 'IMAGE' || m.type === 'FLOOR_PLAN');
  const keyFacts = [
    p.bedrooms != null ? { label: 'Bedrooms', value: String(p.bedrooms) } : null,
    p.bathrooms != null ? { label: 'Bathrooms', value: String(p.bathrooms) } : null,
    { label: 'Area', value: formatArea(p.area, p.areaUnit) },
    p.furnishing ? { label: 'Furnishing', value: enumLabel(p.furnishing) } : null,
    p.possessionStatus ? { label: 'Possession', value: enumLabel(p.possessionStatus) } : null,
    p.facing ? { label: 'Facing', value: enumLabel(p.facing) } : null,
  ].filter(Boolean) as { label: string; value: string }[];
  const searchBase = `/${p.listingType === 'RENT' ? 'rent' : 'buy'}/${p.city.slug}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: p.title,
    url: `${siteUrl()}/property/${p.slug}`,
    datePosted: p.publishedAt ?? undefined,
    image: images.slice(0, 5).map((i) => i.url),
    description: p.description.slice(0, 500),
    offers: { '@type': 'Offer', price: p.price, priceCurrency: 'INR', availability: closed ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock' },
    address: { '@type': 'PostalAddress', addressLocality: p.locality.name, addressRegion: p.state.name, addressCountry: 'IN', postalCode: p.pincode ?? undefined },
  };

  return (
    <div className="bg-surface pb-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <div className="container-page pt-6">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[13px] text-ink-500">
          <Link href="/" className="hover:text-ink-900">
            Home
          </Link>
          <ChevronRight className="size-3.5" />
          <Link href={searchBase} className="hover:text-ink-900">
            {p.listingType === 'RENT' ? 'Rent' : 'Buy'} in {p.city.name}
          </Link>
          <ChevronRight className="size-3.5" />
          <Link href={`${searchBase}/${p.locality.slug}`} className="hover:text-ink-900">
            {p.locality.name}
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="line-clamp-1 text-ink-700">{p.title}</span>
        </nav>

        {p.isDemo ? (
          <Alert tone="warning" className="mt-4">
            This is a demonstration listing created for development and testing. It is not a real property.
          </Alert>
        ) : null}
        {closed ? (
          <Alert tone="info" title={`This property is ${p.status === 'SOLD' ? 'sold' : p.status === 'RENTED' ? 'rented out' : 'no longer listed'}`} className="mt-4">
            Browse similar properties below, or{' '}
            <Link href={`${searchBase}/${p.locality.slug}`} className="font-medium text-brand-strong underline">
              see what is available in {p.locality.name}
            </Link>
            .
          </Alert>
        ) : null}

        <div className="mt-5">
          <Gallery images={images} title={p.title} />
        </div>

        <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{p.listingType === 'RENT' ? 'For rent' : 'For sale'}</Badge>
                  {p.isVerified ? (
                    <Badge tone="success">
                      <BadgeCheck /> Verified
                    </Badge>
                  ) : null}
                  {p.isFeatured ? <Badge tone="dark">Featured</Badge> : null}
                  <span className="tabular text-xs text-ink-500">Ref. {p.referenceCode}</span>
                </div>
                <h1 className="mt-3 text-[26px] font-bold leading-tight text-ink-900 md:text-[32px]">{p.title}</h1>
                <p className="mt-2 flex items-center gap-1.5 text-[15px] text-ink-600">
                  <MapPin className="size-4 text-ink-400" />
                  {p.addressLine ?? `${p.locality.name}, ${p.city.name}`}
                  {p.project ? (
                    <>
                      <span className="text-ink-300">·</span>
                      <Link href={`/projects/${p.project.slug}`} className="inline-flex items-center gap-1 font-medium text-brand-strong hover:underline">
                        <Building2 className="size-3.5" /> {p.project.name}
                      </Link>
                    </>
                  ) : null}
                </p>
              </div>
              <div className="text-left sm:text-right">
                <p className="tabular font-display text-[30px] font-bold leading-none text-ink-900">
                  {formatPriceCompact(p.price)}
                  {p.listingType === 'RENT' ? <span className="text-base font-medium text-ink-500">/month</span> : null}
                </p>
                <p className="mt-1.5 text-[13px] text-ink-500">
                  {p.listingType === 'SALE' && p.pricePerSqft ? `₹${formatNumber(p.pricePerSqft)} per sq.ft` : null}
                  {p.priceNegotiable ? `${p.pricePerSqft ? ' · ' : ''}Negotiable` : null}
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <FavouriteButton propertyId={p.id} variant="outline" />
              <ShareButton title={p.title} />
              <ReportListing propertyId={p.id} />
            </div>

            <dl className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
              {keyFacts.map((f) => (
                <div key={f.label} className="bg-surface px-4 py-3.5">
                  <dt className="text-xs text-ink-500">{f.label}</dt>
                  <dd className="mt-0.5 text-[15px] font-semibold text-ink-900">{f.value}</dd>
                </div>
              ))}
            </dl>

            <section className="mt-10" aria-labelledby="about">
              <h2 id="about" className="text-xl font-semibold text-ink-900">
                About this property
              </h2>
              <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-ink-700">
                {p.description.split(/\n{2,}/).map((para, i) => (
                  <p key={i} className="whitespace-pre-line">
                    {para}
                  </p>
                ))}
              </div>
              {p.highlights.length ? (
                <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
                  {p.highlights.map((h) => (
                    <li key={h} className="flex items-start gap-2.5 text-[14.5px] text-ink-800">
                      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" />
                      {h}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            <section className="mt-10 border-t border-line pt-10" aria-labelledby="details">
              <h2 id="details" className="text-xl font-semibold text-ink-900">
                Property details
              </h2>
              <DescriptionList className="mt-5" columns={3} items={detailItems(p)} />
            </section>

            {p.amenities.length ? (
              <section className="mt-10 border-t border-line pt-10" aria-labelledby="amenities">
                <h2 id="amenities" className="text-xl font-semibold text-ink-900">
                  Amenities
                </h2>
                <ul className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3.5 sm:grid-cols-3">
                  {p.amenities.map((a) => (
                    <li key={a.id} className="flex items-center gap-2.5 text-[14.5px] text-ink-800">
                      <span className="grid size-8 place-items-center rounded-lg bg-ink-50 text-ink-600">
                        <AmenityIcon name={a.icon} className="size-4" />
                      </span>
                      {a.name}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {p.latitude != null && p.longitude != null ? (
              <section className="mt-10 border-t border-line pt-10" aria-labelledby="location">
                <h2 id="location" className="text-xl font-semibold text-ink-900">
                  Location
                </h2>
                <p className="mt-1.5 text-sm text-ink-500">
                  {p.locality.name}, {p.city.name}
                  {p.landmark ? ` · near ${p.landmark}` : ''}
                </p>
                <div className="mt-4">
                  <LocationMap lat={p.latitude} lng={p.longitude} approximate={p.locationIsApproximate} label={`${p.locality.name}, ${p.city.name}`} />
                </div>
              </section>
            ) : null}

            {p.documents.length ? (
              <section className="mt-10 border-t border-line pt-10" aria-labelledby="documents">
                <h2 id="documents" className="text-xl font-semibold text-ink-900">
                  Documents
                </h2>
                <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
                  {p.documents.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <span className="flex items-center gap-2.5 text-ink-800">
                        <FileText className="size-4 text-ink-400" /> {d.title}
                      </span>
                      <span className="text-xs text-ink-500">{d.visibility === 'PUBLIC' ? enumLabel(d.docType) : 'Shared on request'}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="flex flex-col gap-4">
              <EnquiryPanel propertyId={p.id} whatsappAvailable={p.whatsappAvailable} disabledReason={closed ? 'This property is no longer available for enquiries.' : null} />
              <section className="rounded-xl border border-line bg-surface p-5" aria-label="Listed by">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Listed by</p>
                <p className="mt-2 flex items-center gap-1.5 text-[15px] font-semibold text-ink-900">
                  {p.lister.name}
                  {p.lister.verificationStatus === 'VERIFIED' ? <BadgeCheck className="size-4 text-success" aria-label="Verified" /> : null}
                </p>
                <p className="mt-0.5 text-[13px] text-ink-500">
                  {p.sourceType === 'OWNER' ? 'Property owner' : p.sourceType === 'COMPANY' ? 'Listed directly by us' : p.sourceType === 'DEVELOPER' ? 'Developer' : 'Broker'}
                  {p.lister.broker?.displayName ? ` · ${p.lister.broker.displayName}` : ''}
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
                  <div>
                    <dt className="text-ink-500">Live listings</dt>
                    <dd className="font-medium text-ink-900">{p.lister.activeListings}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Member since</dt>
                    <dd className="font-medium text-ink-900">{formatDate(p.lister.memberSince)}</dd>
                  </div>
                  {p.lister.broker?.experienceYears ? (
                    <div>
                      <dt className="text-ink-500">Experience</dt>
                      <dd className="font-medium text-ink-900">{p.lister.broker.experienceYears} years</dd>
                    </div>
                  ) : null}
                  {p.lister.broker?.reraAgentNumber ? (
                    <div>
                      <dt className="text-ink-500">RERA</dt>
                      <dd className="truncate font-medium text-ink-900">{p.lister.broker.reraAgentNumber}</dd>
                    </div>
                  ) : null}
                </dl>
                <p className="mt-4 flex items-center gap-1.5 border-t border-line pt-3 text-xs text-ink-500">
                  <CalendarDays className="size-3.5" /> Updated {formatDate(p.updatedAt)}
                </p>
              </section>
            </div>
          </aside>
        </div>

        {similar.length ? (
          <section className="mt-16 border-t border-line pt-12" aria-labelledby="similar">
            <h2 id="similar" className="text-[24px] font-bold text-ink-900">
              Similar properties
            </h2>
            <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {similar.slice(0, 4).map((s) => (
                <PropertyCard key={s.id} p={s} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
