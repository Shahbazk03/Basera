import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, ArrowUpRight, BadgeCheck, Boxes, Lock, ShieldCheck, UserCheck } from 'lucide-react';
import { formatPriceCompact, formatRelative, pluralize, type ProjectCard as ProjectCardData, type PropertyCard as PropertyCardData } from '@estate/shared';
import { Avatar, Badge, cn } from '@estate/ui';
import { PropertyCard, propertyHref } from '@/components/cards/property-card';
import { ProjectCard } from '@/components/cards/project-card';

export function SectionHeader({ title, subtitle, href, linkLabel = 'View all' }: { title: string; subtitle?: string | null; href?: string; linkLabel?: string }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h2 className="text-[26px] font-bold leading-tight text-ink-900 md:text-[30px]">{title}</h2>
        {subtitle ? <p className="mt-2 text-[15px] text-ink-500">{subtitle}</p> : null}
      </div>
      {href ? (
        <Link href={href} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-strong hover:underline">
          {linkLabel} <ArrowRight className="size-4" />
        </Link>
      ) : null}
    </div>
  );
}

export function Section({ children, tone = 'white', className, id }: { children: React.ReactNode; tone?: 'white' | 'canvas'; className?: string; id?: string }) {
  return (
    <section id={id} className={cn('py-14 md:py-20', tone === 'canvas' && 'bg-canvas', className)}>
      <div className="container-page">{children}</div>
    </section>
  );
}

export function PropertyGrid({ items }: { items: PropertyCardData[] }) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((p) => (
        <PropertyCard key={p.id} p={p} />
      ))}
    </div>
  );
}

export function ProjectGrid({ items }: { items: ProjectCardData[] }) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {items.map((p) => (
        <ProjectCard key={p.id} p={p} />
      ))}
    </div>
  );
}

export function LocalityTiles({ items, citySlug }: { items: { name: string; slug: string; listings: number; projects: number }[]; citySlug: string }) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
      {items.map((l) => (
        <li key={l.slug}>
          <Link href={`/buy/${citySlug}/${l.slug}`} className="group flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 transition-colors hover:border-ink-300 hover:shadow-card">
            <span className="min-w-0">
              <span className="block truncate text-[14.5px] font-semibold text-ink-900">{l.name}</span>
              <span className="mt-0.5 block text-[12.5px] text-ink-500">
                {l.listings > 0 ? pluralize(l.listings, 'property', 'properties') : 'No listings yet'}
                {l.projects > 0 ? ` · ${pluralize(l.projects, 'project')}` : ''}
              </span>
            </span>
            <ArrowUpRight className="size-4 shrink-0 text-ink-300 transition-colors group-hover:text-brand" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function RecentList({ items }: { items: PropertyCardData[] }) {
  return (
    <ul className="grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2">
      {items.map((p) => (
        <li key={p.id} className="border-b border-line last:border-b-0 md:[&:nth-last-child(2)]:border-b-0">
          <Link href={propertyHref(p)} className="group flex items-center gap-4 py-3.5">
            <span className="relative h-[72px] w-24 shrink-0 overflow-hidden rounded-lg bg-ink-100">
              {p.coverImageUrl ? <Image src={p.coverImageUrl} alt="" fill sizes="96px" className="object-cover" /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="tabular font-display text-[16px] font-bold text-ink-900">
                  {formatPriceCompact(p.price)}
                  {p.listingType === 'RENT' ? <span className="text-xs font-medium text-ink-500">/mo</span> : null}
                </span>
                {p.isDemo ? <Badge tone="outline" size="sm">Demo</Badge> : null}
              </span>
              <span className="mt-0.5 block truncate text-[14px] font-medium text-ink-800 group-hover:text-brand-strong">{p.title}</span>
              <span className="mt-0.5 block truncate text-[12.5px] text-ink-500">
                {p.locality.name} · {p.publishedAt ? formatRelative(p.publishedAt) : ''}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export interface BrokerTile {
  id: string;
  name: string;
  city: string | null;
  liveListings: number;
  experienceYears: number | null;
  reraRegistered: boolean;
  logoUrl: string | null;
  isDemo: boolean;
}

export function BrokerTiles({ items }: { items: BrokerTile[] }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((b) => (
        <li key={b.id} className="flex items-center gap-4 rounded-xl border border-line bg-surface p-5">
          <Avatar name={b.name} src={b.logoUrl} size={52} />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-[15px] font-semibold text-ink-900">
              <span className="truncate">{b.name}</span>
              <BadgeCheck className="size-4 shrink-0 text-success" aria-label="Verified" />
            </p>
            <p className="mt-0.5 text-[13px] text-ink-500">
              {[b.city, b.experienceYears ? `${b.experienceYears} yrs experience` : null, b.reraRegistered ? 'RERA registered' : null].filter(Boolean).join(' · ')}
            </p>
            <p className="mt-1.5 text-[13px] font-medium text-ink-700">
              {pluralize(b.liveListings, 'live listing')}
              {b.isDemo ? (
                <Badge tone="outline" size="sm" className="ml-2">
                  Demo
                </Badge>
              ) : null}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

const WHY_ICONS = [ShieldCheck, Boxes, UserCheck, Lock];

export function WhyChooseUs({ title, points }: { title: string; points: { title: string; text: string }[] }) {
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)] lg:gap-16">
      <div>
        <h2 className="text-[26px] font-bold leading-tight text-ink-900 md:text-[30px]">{title}</h2>
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ink-500">A marketplace built around verified information, live availability and accountable follow-up — not just listings.</p>
      </div>
      <ul className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
        {points.map((p, i) => {
          const Icon = WHY_ICONS[i % WHY_ICONS.length];
          return (
            <li key={p.title}>
              <span className="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand-strong">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-4 text-[16px] font-semibold text-ink-900">{p.title}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-ink-500">{p.text}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
