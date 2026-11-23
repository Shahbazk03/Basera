import Image from 'next/image';
import Link from 'next/link';
import { BadgeCheck, Bath, BedDouble, Camera, MapPin, Ruler, Sofa } from 'lucide-react';
import { enumLabel, formatArea, formatNumber, formatPriceCompact, formatRelative, type PropertyCard as Card } from '@estate/shared';
import { Badge, cn } from '@estate/ui';
import { FavouriteButton } from '@/components/common/favourite-button';
import { ContactListerButton } from '@/components/enquiry/contact-lister-button';

export function propertyHref(p: Pick<Card, 'slug'>): string {
  return `/property/${p.slug}`;
}

function priceLine(p: Card) {
  return (
    <>
      {formatPriceCompact(p.price)}
      {p.listingType === 'RENT' ? <span className="text-sm font-medium text-ink-500">/month</span> : null}
    </>
  );
}

/** Key facts that make sense for the listing's category. */
export function propertyFacts(p: Card): { icon: React.ReactNode; label: string }[] {
  const facts: { icon: React.ReactNode; label: string }[] = [];
  if (p.bedrooms != null) facts.push({ icon: <BedDouble />, label: `${p.bedrooms} ${p.bedrooms === 1 ? 'Bed' : 'Beds'}` });
  if (p.bathrooms != null) facts.push({ icon: <Bath />, label: `${p.bathrooms} ${p.bathrooms === 1 ? 'Bath' : 'Baths'}` });
  facts.push({ icon: <Ruler />, label: formatArea(p.area, p.areaUnit) });
  if (p.furnishing && facts.length < 4) facts.push({ icon: <Sofa />, label: enumLabel(p.furnishing) });
  return facts;
}

function MediaBadges({ p }: { p: Card }) {
  return (
    <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
      {p.isFeatured ? <Badge tone="dark" size="sm">Featured</Badge> : null}
      {p.isVerified ? (
        <Badge tone="onImage" size="sm">
          <BadgeCheck className="text-success" /> Verified
        </Badge>
      ) : null}
      {p.isDemo ? <Badge tone="onImage" size="sm">Demo</Badge> : null}
    </div>
  );
}

function Cover({ p, sizes, className }: { p: Card; sizes: string; className?: string }) {
  return (
    <div className={cn('relative overflow-hidden bg-ink-100', className)}>
      {p.coverImageUrl ? (
        <Image src={p.coverImageUrl} alt={p.title} fill sizes={sizes} className="object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
      ) : (
        <div className="grid size-full place-items-center text-xs text-ink-400">Photos coming soon</div>
      )}
      <MediaBadges p={p} />
      {p.imageCount > 1 ? (
        <span className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-md bg-ink-950/65 px-1.5 py-0.5 text-[11px] font-medium text-white">
          <Camera className="size-3" /> {p.imageCount}
        </span>
      ) : null}
    </div>
  );
}

/** Grid card used on the homepage and in carousels. */
export function PropertyCard({ p, priority }: { p: Card; priority?: boolean }) {
  void priority;
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface transition-shadow duration-200 hover:shadow-raised">
      <Cover p={p} sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw" className="aspect-[4/3]" />
      <div className="absolute right-3 top-3 z-10">
        <FavouriteButton propertyId={p.id} />
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="tabular font-display text-[19px] font-bold leading-none text-ink-900">{priceLine(p)}</p>
          {p.pricePerSqft && p.listingType === 'SALE' ? <span className="tabular text-xs text-ink-500">₹{formatNumber(p.pricePerSqft)}/sq.ft</span> : null}
        </div>
        <h3 className="mt-2 line-clamp-1 text-[14.5px] font-medium text-ink-800">
          <Link href={propertyHref(p)} className="after:absolute after:inset-0">
            {p.title}
          </Link>
        </h3>
        <p className="mt-1 flex items-center gap-1 text-[13px] text-ink-500">
          <MapPin className="size-3.5 shrink-0" />
          <span className="truncate">
            {p.locality.name}, {p.city.name}
          </span>
        </p>
        <ul className="mt-auto flex flex-wrap gap-x-3.5 gap-y-1 border-t border-line pt-3 text-[12.5px] text-ink-600 [&_svg]:size-3.5 [&_svg]:text-ink-400" style={{ marginTop: '0.875rem' }}>
          {propertyFacts(p).map((f) => (
            <li key={f.label} className="inline-flex items-center gap-1">
              {f.icon}
              {f.label}
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

/** Horizontal result row used on search pages. */
export function PropertyRow({ p }: { p: Card }) {
  const sourceLabel = p.sourceType === 'OWNER' ? 'Owner' : p.sourceType === 'COMPANY' ? 'Listed by us' : p.sourceType === 'DEVELOPER' ? 'Developer' : 'Broker';
  return (
    <article className="group relative grid overflow-hidden rounded-xl border border-line bg-surface transition-shadow duration-200 hover:shadow-raised sm:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
      <Cover p={p} sizes="(max-width: 640px) 100vw, 300px" className="aspect-[4/3] sm:aspect-auto sm:min-h-[220px]" />
      <div className="absolute right-3 top-3 z-10 sm:left-[252px] sm:right-auto">
        <FavouriteButton propertyId={p.id} />
      </div>
      <div className="flex min-w-0 flex-col p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="tabular font-display text-[21px] font-bold leading-none text-ink-900">{priceLine(p)}</p>
          {p.pricePerSqft && p.listingType === 'SALE' ? <span className="tabular text-[13px] text-ink-500">₹{formatNumber(p.pricePerSqft)}/sq.ft</span> : null}
          {p.priceNegotiable ? <span className="text-[12px] text-ink-500">Negotiable</span> : null}
          {p.distanceKm != null ? <span className="text-[12px] text-ink-500">{p.distanceKm} km away</span> : null}
        </div>
        <h3 className="mt-2 text-[16px] font-semibold leading-snug text-ink-900">
          <Link href={propertyHref(p)} className="after:absolute after:inset-0 hover:text-brand-strong">
            {p.title}
          </Link>
        </h3>
        <p className="mt-1 flex items-center gap-1 text-[13.5px] text-ink-500">
          <MapPin className="size-3.5 shrink-0" />
          {p.locality.name}, {p.city.name}
          {p.project ? <span className="truncate"> · {p.project.name}</span> : null}
        </p>
        <ul className="mt-4 flex flex-wrap gap-2">
          <li className="rounded-md bg-ink-50 px-2.5 py-1 text-[12.5px] font-medium text-ink-700">{p.propertyType.name}</li>
          {propertyFacts(p).map((f) => (
            <li key={f.label} className="inline-flex items-center gap-1.5 rounded-md bg-ink-50 px-2.5 py-1 text-[12.5px] text-ink-700 [&_svg]:size-3.5 [&_svg]:text-ink-400">
              {f.icon}
              {f.label}
            </li>
          ))}
          {p.possessionStatus ? <li className="rounded-md bg-ink-50 px-2.5 py-1 text-[12.5px] text-ink-700">{enumLabel(p.possessionStatus)}</li> : null}
        </ul>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4" style={{ marginTop: '1.25rem' }}>
          <div className="min-w-0 text-[12.5px] text-ink-500">
            <span className="font-medium text-ink-700">{p.organization.name}</span>
            {p.organization.isVerified ? <BadgeCheck className="ml-1 inline size-3.5 text-success" aria-label="Verified partner" /> : null}
            <span> · {sourceLabel}</span>
            {p.publishedAt ? <span> · {formatRelative(p.publishedAt)}</span> : null}
          </div>
          <div className="relative z-10">
            <ContactListerButton propertyId={p.id} title={p.title} />
          </div>
        </div>
      </div>
    </article>
  );
}
