import Image from 'next/image';
import Link from 'next/link';
import { BadgeCheck, Building2, ChevronRight, ExternalLink, Landmark, MapPin, Quote, ShieldCheck } from 'lucide-react';
import {
  CTA_ACTIONS,
  enumLabel,
  formatDate,
  formatPriceRange,
  type CtaAction,
  type NearbyCategory,
  type PageSection,
  type ProjectDetail,
  type SectionType,
} from '@estate/shared';
import { Alert, AmenityIcon, Badge, StatusBadge } from '@estate/ui';
import { Gallery } from '@/components/property/gallery';
import { LocationMap } from '@/components/property/location-map';
import { EnquiryPanel } from '@/components/enquiry/enquiry-panel';
import { BookingStatus } from './booking-status';
import { DocumentsList } from './documents-list';
import { InventorySection } from './inventory-section';
import { ProjectCta } from './project-cta';
import { ProjectSubnav } from './project-subnav';

type D = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const cta = (v: unknown): CtaAction => ((CTA_ACTIONS as readonly string[]).includes(str(v)) ? (v as CtaAction) : 'ENQUIRE');

/** Postal address without repeating parts the free-text address line already contains (e.g. "Sultanpur Road, Lucknow"). */
export function projectAddress(p: Pick<ProjectDetail, 'addressLine' | 'locality' | 'city' | 'pincode'>): string {
  const line = p.addressLine?.trim() ?? '';
  const rest = [p.locality.name, p.city.name, p.pincode].filter((x): x is string => Boolean(x) && !line.toLowerCase().includes(String(x).toLowerCase()));
  return [line, ...rest].filter(Boolean).join(', ');
}

export const STATUS_COPY: Record<string, string> = {
  UPCOMING: 'Upcoming',
  PRE_LAUNCH: 'Pre-launch',
  BOOKING_OPEN: 'Booking open',
  CLOSING_SOON: 'Closing soon',
  SOLD_OUT: 'Sold out',
  CLOSED: 'Booking closed',
  COMPLETED: 'Completed',
  DRAFT: 'Draft',
  ARCHIVED: 'Archived',
};

const SECTION_ANCHOR: Record<SectionType, string> = {
  HERO: 'top',
  OVERVIEW: 'overview',
  STATS: 'facts',
  GALLERY: 'gallery',
  MASTER_PLAN: 'master-plan',
  INVENTORY: 'inventory',
  AMENITIES: 'amenities',
  MAP: 'location',
  NEARBY: 'nearby',
  DEVELOPER: 'developer',
  DOCUMENTS: 'documents',
  CONSTRUCTION_UPDATES: 'updates',
  FAQ: 'faqs',
  TESTIMONIALS: 'testimonials',
  CONTACT: 'contact',
  CTA: 'cta',
};

const NAV_LABELS: Partial<Record<SectionType, string>> = {
  OVERVIEW: 'Overview',
  GALLERY: 'Gallery',
  INVENTORY: 'Inventory',
  MASTER_PLAN: 'Master plan',
  AMENITIES: 'Amenities',
  MAP: 'Location',
  DEVELOPER: 'Developer',
  FAQ: 'FAQs',
  CONTACT: 'Contact',
};

const NEARBY_ORDER: NearbyCategory[] = ['METRO', 'RAILWAY', 'AIRPORT', 'BUS_STAND', 'HIGHWAY', 'SCHOOL', 'COLLEGE', 'HOSPITAL', 'MALL', 'MARKET', 'OFFICE_HUB', 'PARK', 'RELIGIOUS', 'OTHER'];

export function videoEmbedUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = u.pathname.slice(1);
    else if (host.endsWith('youtube.com')) id = u.searchParams.get('v') ?? (u.pathname.startsWith('/embed/') || u.pathname.startsWith('/shorts/') ? u.pathname.split('/')[2] : null);
    if (id && /^[\w-]{6,20}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
    if (host.endsWith('vimeo.com')) {
      const vid = u.pathname.split('/').filter(Boolean).pop();
      if (vid && /^\d{5,12}$/.test(vid)) return `https://player.vimeo.com/video/${vid}`;
    }
  } catch {
    /* invalid URL */
  }
  return null;
}

function SectionShell({ id, heading, intro, children, muted }: { id: string; heading?: string; intro?: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <section id={id} aria-labelledby={heading ? `${id}-h` : undefined} className={muted ? 'scroll-mt-32 bg-canvas py-14 md:py-16' : 'scroll-mt-32 py-14 md:py-16'}>
      <div className="container-page">
        {heading ? (
          <h2 id={`${id}-h`} className="text-[24px] font-bold tracking-tight text-ink-900 md:text-[28px]">
            {heading}
          </h2>
        ) : null}
        {intro ? <p className="mt-2 max-w-2xl text-[15px] text-ink-600">{intro}</p> : null}
        <div className={heading ? 'mt-7' : ''}>{children}</div>
      </div>
    </section>
  );
}

function paragraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p, i) => (
      <p key={i} className="whitespace-pre-line">
        {p}
      </p>
    ));
}

interface Ctx {
  p: ProjectDetail;
  variant: 'marketplace' | 'microsite';
  enquiriesOpen: boolean;
}

function Hero({ s, ctx }: { s: PageSection; ctx: Ctx }) {
  const { p } = ctx;
  const d = s.data as D;
  const image = str(d.imageUrl) || p.heroImageUrl;
  const title = str(d.headline) || p.name;
  const sub = str(d.subheadline) || p.tagline || '';
  const action = cta(d.ctaAction);
  return (
    <section id="top" className="relative isolate overflow-hidden bg-ink-950">
      {image ? <Image src={image} alt="" fill priority sizes="100vw" className="-z-20 object-cover" /> : null}
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-ink-950 via-ink-950/70 to-ink-950/25" />
      <div className="container-page flex min-h-[460px] flex-col justify-end pb-10 pt-16 md:min-h-[540px] md:pb-14">
        {ctx.variant === 'marketplace' ? (
          <nav aria-label="Breadcrumb" className="mb-auto flex flex-wrap items-center gap-1 text-[13px] text-white/70">
            <Link href="/" className="hover:text-white">
              Home
            </Link>
            <ChevronRight className="size-3.5" />
            <Link href="/projects" className="hover:text-white">
              New projects
            </Link>
            <ChevronRight className="size-3.5" />
            <span className="text-white/90">{p.name}</span>
          </nav>
        ) : null}
        <div className="mt-10 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            {bool(d.showStatus, true) ? <StatusBadge status={p.status} label={STATUS_COPY[p.status]} /> : null}
            {p.reraNumber ? (
              <Badge tone="onImage" size="md">
                <ShieldCheck /> RERA {p.reraNumber}
              </Badge>
            ) : null}
            {p.isDemo ? <Badge tone="onImage">Demo project</Badge> : null}
          </div>
          <h1 className="mt-4 text-[34px] font-bold leading-[1.08] tracking-tight text-white md:text-[52px]">{title}</h1>
          {sub ? <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-white/80 md:text-[18px]">{sub}</p> : null}
          <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14.5px] text-white/80">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-4" /> {p.locality.name}, {p.city.name}
            </span>
            {p.developer ? (
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="size-4" /> by {p.developer.name}
                {p.developer.isVerified ? <BadgeCheck className="size-4 text-emerald-300" aria-label="Verified developer" /> : null}
              </span>
            ) : null}
          </p>
          <div className="mt-6 flex flex-wrap items-end gap-x-8 gap-y-3">
            {bool(d.showPrice, true) ? (
              <div>
                <p className="text-[12px] font-medium uppercase tracking-wide text-white/60">{p.units.length ? 'Price' : 'Expected price'}</p>
                <p className="tabular font-display text-[26px] font-bold text-white md:text-[30px]">{formatPriceRange(p.priceMin, p.priceMax)}</p>
              </div>
            ) : null}
            {p.totalUnits > 0 ? (
              <div>
                <p className="text-[12px] font-medium uppercase tracking-wide text-white/60">Available</p>
                <p className="tabular font-display text-[26px] font-bold text-white md:text-[30px]">
                  {p.availableUnits}
                  <span className="text-[16px] font-medium text-white/60"> / {p.units.length} units</span>
                </p>
              </div>
            ) : null}
          </div>
          {bool(d.showStatus, true) ? <BookingStatus className="mt-4" status={p.status} bookingOpensAt={p.bookingOpensAt} bookingClosesAt={p.bookingClosesAt} serverTime={p.serverTime} /> : null}
          <div className="mt-7 flex flex-wrap gap-3">
            <ProjectCta action={action} label={str(d.ctaLabel) || 'Enquire now'} projectId={p.id} projectName={p.name} whatsappAvailable={p.whatsappAvailable} />
            {action !== 'SITE_VISIT' ? <ProjectCta action="SITE_VISIT" label="Book a site visit" projectId={p.id} projectName={p.name} whatsappAvailable={p.whatsappAvailable} variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20" /> : null}
            {p.whatsappAvailable && action !== 'WHATSAPP' ? <ProjectCta action="WHATSAPP" label="WhatsApp" projectId={p.id} projectName={p.name} whatsappAvailable /> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function Overview({ s, id, ctx }: { s: PageSection; id: string; ctx: Ctx }) {
  const { p } = ctx;
  const d = s.data as D;
  const highlights = ((d.highlights as string[]) ?? []).filter(Boolean);
  const facts = [
    { label: 'Project type', value: enumLabel(p.projectType) },
    p.totalAreaAcres ? { label: 'Land area', value: `${p.totalAreaAcres} acres` } : null,
    p.totalUnitsPlanned ? { label: 'Total units', value: String(p.totalUnitsPlanned) } : null,
    p.unitTypes.length ? { label: 'Configurations', value: p.unitTypes.join(', ') } : null,
    p.launchDate ? { label: 'Launched', value: formatDate(p.launchDate) } : null,
    p.possessionDate ? { label: 'Possession', value: formatDate(p.possessionDate) } : null,
    p.reraNumber ? { label: 'RERA registration', value: `${p.reraNumber}${p.reraValidUntil ? ` (valid till ${formatDate(p.reraValidUntil)})` : ''}` } : null,
    p.approvalDetails ? { label: 'Approvals', value: p.approvalDetails } : null,
  ].filter(Boolean) as { label: string; value: string }[];
  return (
    <SectionShell id={id} heading={str(d.heading) || 'Project overview'}>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          <div className="space-y-4 text-[15.5px] leading-relaxed text-ink-700">{paragraphs(str(d.body) || p.description)}</div>
          {highlights.length ? (
            <ul className="mt-7 grid gap-3 sm:grid-cols-2">
              {highlights.map((h) => (
                <li key={h} className="flex items-start gap-2.5 text-[14.5px] text-ink-800">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" /> {h}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <dl className="h-fit divide-y divide-line rounded-xl border border-line bg-surface">
          {facts.map((f) => (
            <div key={f.label} className="flex items-start justify-between gap-4 px-5 py-3.5">
              <dt className="text-[13.5px] text-ink-500">{f.label}</dt>
              <dd className="text-right text-[14px] font-medium text-ink-900">{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </SectionShell>
  );
}

function Stats({ s, id }: { s: PageSection; id: string }) {
  const d = s.data as D;
  const items = ((d.items as { label: string; value: string }[]) ?? []).filter((i) => i.label && i.value);
  if (!items.length) return null;
  return (
    <section id={id} className="scroll-mt-32 border-y border-line bg-canvas">
      <div className="container-page py-8">
        {str(d.heading) ? <h2 className="sr-only">{str(d.heading)}</h2> : null}
        <dl className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {items.map((i) => (
            <div key={i.label}>
              <dt className="text-[12.5px] font-medium uppercase tracking-wide text-ink-500">{i.label}</dt>
              <dd className="mt-1 font-display text-[22px] font-bold tracking-tight text-ink-900 md:text-[26px]">{i.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function GallerySection({ s, id, ctx }: { s: PageSection; id: string; ctx: Ctx }) {
  const { p } = ctx;
  const d = s.data as D;
  const limit = typeof d.limit === 'number' ? d.limit : 24;
  const images = p.media.filter((m) => m.type === 'IMAGE').slice(0, limit);
  const plans = p.media.filter((m) => m.type === 'FLOOR_PLAN');
  const videos = [...p.videoUrls, ...p.media.filter((m) => m.type === 'VIDEO').map((m) => m.url)].map(videoEmbedUrl).filter((v): v is string => Boolean(v));
  if (!images.length && !videos.length && !plans.length) return null;
  return (
    <SectionShell id={id} heading={str(d.heading) || 'Gallery'}>
      {images.length ? <Gallery images={images} title={p.name} /> : null}
      {plans.length ? (
        <div className="mt-10">
          <h3 className="text-lg font-semibold text-ink-900">Floor plans</h3>
          <div className="mt-4">
            <Gallery images={plans} title={`${p.name} floor plans`} />
          </div>
        </div>
      ) : null}
      {videos.length ? (
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {videos.slice(0, 4).map((v) => (
            <div key={v} className="aspect-video overflow-hidden rounded-xl border border-line bg-ink-100">
              <iframe src={v} title={`${p.name} video`} loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" className="size-full border-0" />
            </div>
          ))}
        </div>
      ) : null}
    </SectionShell>
  );
}

function MasterPlan({ s, id, ctx }: { s: PageSection; id: string; ctx: Ctx }) {
  const { p } = ctx;
  const d = s.data as D;
  const image = p.masterPlanUrl ?? p.media.find((m) => m.type === 'MASTER_PLAN')?.url ?? null;
  if (!image) return null;
  return (
    <SectionShell id={id} heading={str(d.heading) || 'Master plan'} intro={str(d.description) || undefined} muted>
      <a href={image} target="_blank" rel="noopener noreferrer" className="group relative block overflow-hidden rounded-xl border border-line bg-surface">
        <div className="relative aspect-[16/9]">
          <Image src={image} alt={`${p.name} master plan`} fill sizes="(max-width: 1240px) 100vw, 1240px" className="object-contain p-2" />
        </div>
        <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-md bg-ink-900/80 px-2.5 py-1 text-xs font-medium text-white">
          <ExternalLink className="size-3.5" /> Open full size
        </span>
      </a>
    </SectionShell>
  );
}

function Inventory({ s, id, ctx }: { s: PageSection; id: string; ctx: Ctx }) {
  const { p } = ctx;
  const d = s.data as D;
  return (
    <SectionShell id={id} heading={str(d.heading) || 'Available inventory'} intro="Live availability from the sales system — booked and sold units are never shown as available." muted>
      <InventorySection units={p.units} projectId={p.id} projectName={p.name} showPrices={bool(d.showPrices, true)} showUnavailable={bool(d.showUnavailable, true)} enquiriesOpen={ctx.enquiriesOpen} />
    </SectionShell>
  );
}

function Amenities({ s, id, ctx }: { s: PageSection; id: string; ctx: Ctx }) {
  const { p } = ctx;
  if (!p.amenities.length) return null;
  return (
    <SectionShell id={id} heading={str((s.data as D).heading) || 'Amenities'}>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
        {p.amenities.map((a) => (
          <li key={a.id} className="flex items-center gap-3 text-[14.5px] text-ink-800">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong">
              <AmenityIcon name={a.icon} className="size-[18px]" />
            </span>
            {a.name}
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}

function MapSection({ s, id, ctx }: { s: PageSection; id: string; ctx: Ctx }) {
  const { p } = ctx;
  if (p.latitude == null || p.longitude == null) return null;
  const d = s.data as D;
  const label = projectAddress(p);
  return (
    <SectionShell id={id} heading={str(d.heading) || 'Location'} intro={label}>
      <LocationMap lat={p.latitude} lng={p.longitude} approximate={false} label={label} zoom={typeof d.zoom === 'number' ? d.zoom : 14} />
    </SectionShell>
  );
}

function Nearby({ s, id, ctx }: { s: PageSection; id: string; ctx: Ctx }) {
  const { p } = ctx;
  if (!p.nearbyPlaces.length) return null;
  const sorted = [...p.nearbyPlaces].sort((a, b) => NEARBY_ORDER.indexOf(a.category) - NEARBY_ORDER.indexOf(b.category) || a.distanceKm - b.distanceKm);
  return (
    <SectionShell id={id} heading={str((s.data as D).heading) || 'Nearby'} intro="Approximate road distances." muted>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((n) => (
          <li key={n.id} className="flex items-start justify-between gap-4 rounded-xl border border-line bg-surface px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-[14.5px] font-medium text-ink-900">{n.name}</p>
              <p className="text-xs text-ink-500">{enumLabel(n.category)}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="tabular text-[14.5px] font-semibold text-ink-900">{n.distanceKm} km</p>
              {n.travelMinutes ? <p className="text-xs text-ink-500">~{n.travelMinutes} min</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}

function Developer({ s, id, ctx }: { s: PageSection; id: string; ctx: Ctx }) {
  const dev = ctx.p.developerProfile;
  if (!dev) return null;
  return (
    <SectionShell id={id} heading={str((s.data as D).heading) || 'About the developer'}>
      <div className="flex flex-col gap-6 rounded-xl border border-line p-6 md:flex-row md:items-start">
        <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-ink-50 text-ink-400">
          {dev.logoUrl ? <Image src={dev.logoUrl} alt={dev.name} width={64} height={64} className="object-contain" /> : <Landmark className="size-7" />}
        </div>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-lg font-semibold text-ink-900">
            {dev.name}
            {dev.isVerified ? (
              <Badge tone="success">
                <BadgeCheck /> Verified developer
              </Badge>
            ) : null}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            {[dev.establishedYear ? `Established ${dev.establishedYear}` : null, dev.projectsDelivered ? `${dev.projectsDelivered} projects delivered (as declared by the developer)` : null].filter(Boolean).join(' · ')}
          </p>
          {dev.description ? <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-ink-700">{paragraphs(dev.description)}</div> : null}
          {dev.website ? (
            <a href={dev.website} target="_blank" rel="noopener noreferrer nofollow" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-strong hover:underline">
              Developer website <ExternalLink className="size-3.5" />
            </a>
          ) : null}
        </div>
      </div>
    </SectionShell>
  );
}

function Documents({ s, id, ctx }: { s: PageSection; id: string; ctx: Ctx }) {
  const { p } = ctx;
  if (!p.documents.length && !p.legalInformation) return null;
  return (
    <SectionShell id={id} heading={str((s.data as D).heading) || 'Approvals & documents'} muted>
      {p.documents.length ? <DocumentsList slug={p.slug} projectId={p.id} projectName={p.name} documents={p.documents} /> : null}
      {p.legalInformation ? <div className="mt-6 space-y-3 text-sm leading-relaxed text-ink-600">{paragraphs(p.legalInformation)}</div> : null}
    </SectionShell>
  );
}

function Updates({ s, id, ctx }: { s: PageSection; id: string; ctx: Ctx }) {
  const updates = ctx.p.constructionUpdates;
  if (!updates.length) return null;
  return (
    <SectionShell id={id} heading={str((s.data as D).heading) || 'Construction updates'}>
      <ol className="relative grid gap-6 border-l border-line pl-6">
        {updates.map((u) => (
          <li key={u.id} className="relative">
            <span className="absolute -left-[31px] top-1.5 size-3 rounded-full border-2 border-surface bg-brand" aria-hidden />
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{formatDate(u.updateDate)}</p>
            <p className="mt-1 text-[16px] font-semibold text-ink-900">{u.title}</p>
            {u.description ? <p className="mt-1 max-w-3xl text-[14.5px] leading-relaxed text-ink-700">{u.description}</p> : null}
            {u.progressPercent != null ? (
              <div className="mt-3 max-w-md">
                <div className="flex justify-between text-xs text-ink-500">
                  <span>Overall progress</span>
                  <span className="tabular font-medium text-ink-800">{u.progressPercent}%</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={u.progressPercent} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-brand" style={{ width: `${u.progressPercent}%` }} />
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </SectionShell>
  );
}

function Faqs({ s, id, ctx }: { s: PageSection; id: string; ctx: Ctx }) {
  const faqs = ctx.p.faqs;
  if (!faqs.length) return null;
  return (
    <SectionShell id={id} heading={str((s.data as D).heading) || 'Frequently asked questions'} muted>
      <div className="max-w-3xl divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {faqs.map((f) => (
          <details key={f.id} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[15px] font-medium text-ink-900 hover:bg-ink-50/60 [&::-webkit-details-marker]:hidden">
              {f.question}
              <ChevronRight className="size-4 shrink-0 text-ink-400 transition-transform group-open:rotate-90" />
            </summary>
            <div className="px-5 pb-5 text-[14.5px] leading-relaxed text-ink-700">{paragraphs(f.answer)}</div>
          </details>
        ))}
      </div>
    </SectionShell>
  );
}

function Testimonials({ s, id }: { s: PageSection; id: string }) {
  const d = s.data as D;
  const items = ((d.items as { name: string; text: string; detail?: string }[]) ?? []).filter((i) => i.name && i.text);
  if (!items.length) return null;
  return (
    <SectionShell id={id} heading={str(d.heading) || 'What buyers say'}>
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {items.map((t, i) => (
          <figure key={i} className="flex h-full flex-col rounded-xl border border-line p-6">
            <Quote className="size-6 text-brand-muted" aria-hidden />
            <blockquote className="mt-3 flex-1 text-[15px] leading-relaxed text-ink-700">{t.text}</blockquote>
            <figcaption className="mt-4 text-sm">
              <span className="font-semibold text-ink-900">{t.name}</span>
              {t.detail ? <span className="block text-ink-500">{t.detail}</span> : null}
            </figcaption>
          </figure>
        ))}
      </div>
    </SectionShell>
  );
}

function Contact({ s, id, ctx }: { s: PageSection; id: string; ctx: Ctx }) {
  const { p } = ctx;
  const d = s.data as D;
  return (
    <section id={id} className="scroll-mt-32 bg-ink-950 py-14 text-white md:py-20">
      <div className="container-page grid gap-10 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center">
        <div className="max-w-xl">
          <h2 className="text-[26px] font-bold tracking-tight text-white md:text-[32px]">{str(d.heading) || 'Talk to our sales team'}</h2>
          <p className="mt-3 text-[16px] leading-relaxed text-white/75">
            {str(d.body) || `Get the latest price list, unit availability and payment plans for ${p.name}. A relationship manager will contact you — usually within a few working hours.`}
          </p>
          <ul className="mt-6 grid gap-2.5 text-[14.5px] text-white/80">
            <li className="flex items-center gap-2.5">
              <ShieldCheck className="size-4 text-emerald-300" /> Every enquiry gets a reference number and a dedicated contact
            </li>
            <li className="flex items-center gap-2.5">
              <ShieldCheck className="size-4 text-emerald-300" /> No payments are taken on this website — bookings are completed with written confirmation
            </li>
            <li className="flex items-center gap-2.5">
              <ShieldCheck className="size-4 text-emerald-300" /> Your number is shared only with this project&apos;s sales team
            </li>
          </ul>
          {!ctx.enquiriesOpen ? <p className="mt-6 text-sm text-white/60">Booking for this project is {STATUS_COPY[p.status]?.toLowerCase() ?? 'closed'} — you can still enquire about future phases and similar projects.</p> : null}
        </div>
        <div className="text-ink-900">
          <EnquiryPanel heading={`Enquire about ${p.name}`} projectId={p.id} whatsappAvailable={p.whatsappAvailable} />
        </div>
      </div>
    </section>
  );
}

function CtaBand({ s, id, ctx }: { s: PageSection; id: string; ctx: Ctx }) {
  const { p } = ctx;
  const d = s.data as D;
  return (
    <section id={id} className="scroll-mt-32 py-12">
      <div className="container-page">
        <div className="flex flex-col items-start justify-between gap-6 rounded-2xl bg-brand-soft px-6 py-8 md:flex-row md:items-center md:px-10">
          <div className="max-w-2xl">
            <h2 className="text-[22px] font-bold tracking-tight text-ink-900 md:text-[26px]">{str(d.heading)}</h2>
            {str(d.body) ? <p className="mt-2 text-[15px] text-ink-700">{str(d.body)}</p> : null}
          </div>
          <ProjectCta action={cta(d.action)} label={str(d.buttonLabel) || 'Enquire now'} projectId={p.id} projectName={p.name} whatsappAvailable={p.whatsappAvailable} />
        </div>
      </div>
    </section>
  );
}

function renderSection(s: PageSection, id: string, ctx: Ctx): React.ReactNode {
  switch (s.type) {
    case 'HERO':
      return <Hero key={s.id} s={s} ctx={ctx} />;
    case 'OVERVIEW':
      return <Overview key={s.id} s={s} id={id} ctx={ctx} />;
    case 'STATS':
      return <Stats key={s.id} s={s} id={id} />;
    case 'GALLERY':
      return <GallerySection key={s.id} s={s} id={id} ctx={ctx} />;
    case 'MASTER_PLAN':
      return <MasterPlan key={s.id} s={s} id={id} ctx={ctx} />;
    case 'INVENTORY':
      return <Inventory key={s.id} s={s} id={id} ctx={ctx} />;
    case 'AMENITIES':
      return <Amenities key={s.id} s={s} id={id} ctx={ctx} />;
    case 'MAP':
      return <MapSection key={s.id} s={s} id={id} ctx={ctx} />;
    case 'NEARBY':
      return <Nearby key={s.id} s={s} id={id} ctx={ctx} />;
    case 'DEVELOPER':
      return <Developer key={s.id} s={s} id={id} ctx={ctx} />;
    case 'DOCUMENTS':
      return <Documents key={s.id} s={s} id={id} ctx={ctx} />;
    case 'CONSTRUCTION_UPDATES':
      return <Updates key={s.id} s={s} id={id} ctx={ctx} />;
    case 'FAQ':
      return <Faqs key={s.id} s={s} id={id} ctx={ctx} />;
    case 'TESTIMONIALS':
      return <Testimonials key={s.id} s={s} id={id} />;
    case 'CONTACT':
      return <Contact key={s.id} s={s} id={id} ctx={ctx} />;
    case 'CTA':
      return <CtaBand key={s.id} s={s} id={id} ctx={ctx} />;
    default:
      return null;
  }
}

/** True when a section would render content for this project (used for navigation). */
function hasContent(s: PageSection, p: ProjectDetail): boolean {
  switch (s.type) {
    case 'GALLERY':
      return p.media.some((m) => m.type === 'IMAGE' || m.type === 'FLOOR_PLAN') || p.videoUrls.length > 0;
    case 'MASTER_PLAN':
      return Boolean(p.masterPlanUrl || p.media.some((m) => m.type === 'MASTER_PLAN'));
    case 'AMENITIES':
      return p.amenities.length > 0;
    case 'MAP':
      return p.latitude != null && p.longitude != null;
    case 'NEARBY':
      return p.nearbyPlaces.length > 0;
    case 'DEVELOPER':
      return Boolean(p.developerProfile);
    case 'DOCUMENTS':
      return p.documents.length > 0 || Boolean(p.legalInformation);
    case 'CONSTRUCTION_UPDATES':
      return p.constructionUpdates.length > 0;
    case 'FAQ':
      return p.faqs.length > 0;
    default:
      return true;
  }
}

/**
 * Renders a project page from its validated page-builder sections and live project data.
 * Shared by the marketplace route (/projects/[slug]) and domain-mapped microsites (/site/[slug]).
 */
export function ProjectPage({ p, variant }: { p: ProjectDetail; variant: 'marketplace' | 'microsite' }) {
  const ctx: Ctx = { p, variant, enquiriesOpen: !['SOLD_OUT', 'CLOSED', 'COMPLETED', 'ARCHIVED'].includes(p.status) };
  const visible = p.sections.filter((s) => s.visible);
  const sections = visible.some((s) => s.type === 'HERO') ? visible : [{ id: 'auto-hero', type: 'HERO', visible: true, data: {} } as PageSection, ...visible];
  const used = new Map<string, number>();
  const withIds = sections.map((s) => {
    const base = SECTION_ANCHOR[s.type];
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return { s, id: n === 0 ? base : `${base}-${n + 1}` };
  });
  const nav = withIds.filter(({ s }) => NAV_LABELS[s.type] && hasContent(s, p)).map(({ s, id }) => ({ id, label: NAV_LABELS[s.type]! }));
  const hero = withIds.find(({ s }) => s.type === 'HERO');
  const rest = withIds.filter(({ s }) => s.type !== 'HERO');

  return (
    <div>
      {p.isPreview ? (
        <div role="status" className="sticky top-0 z-50 bg-warning px-4 py-2 text-center text-[13px] font-medium text-white">
          Preview — this draft has not been published and is not visible to the public.
        </div>
      ) : null}
      {hero ? renderSection(hero.s, hero.id, ctx) : null}
      <ProjectSubnav items={nav} projectId={p.id} projectName={p.name} whatsappAvailable={p.whatsappAvailable} top="top-16" />
      {p.isDemo ? (
        <div className="container-page pt-6">
          <Alert tone="warning">This is a demonstration project created for development and testing. It is not a real development and cannot be booked.</Alert>
        </div>
      ) : null}
      {rest.map(({ s, id }) => renderSection(s, id, ctx))}
    </div>
  );
}
