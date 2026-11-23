import Link from 'next/link';
import { Mail, MapPin, Phone } from 'lucide-react';
import type { PublicSettings } from '@estate/shared';
import { Logo } from '@estate/ui';

export interface FooterPageLink {
  slug: string;
  title: string;
  footerGroup: string | null;
}

export function SiteFooter({
  settings,
  cityName,
  citySlug,
  localities,
  pages,
}: {
  settings: PublicSettings;
  cityName: string;
  citySlug: string;
  localities: { name: string; slug: string }[];
  pages: FooterPageLink[];
}) {
  const group = (g: string) => pages.filter((p) => (p.footerGroup ?? 'Company') === g);
  const company = group('Company');
  const legal = group('Legal');
  const partnersPages = group('Partners');
  const consoleUrl = process.env.CONSOLE_PUBLIC_URL ?? process.env.NEXT_PUBLIC_CONSOLE_URL ?? '';
  const year = new Date().getFullYear();
  const c = settings.contact;

  return (
    <footer className="bg-ink-950 text-white/70">
      <div className="container-page grid gap-10 py-14 md:grid-cols-2 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div className="max-w-sm">
          <Logo name={settings.brand.name} logoUrl={settings.brand.logoUrl} inverted />
          {settings.brand.tagline ? <p className="mt-4 text-sm leading-relaxed text-white/60">{settings.brand.tagline}</p> : null}
          <ul className="mt-6 space-y-2.5 text-sm">
            {c.phone ? (
              <li className="flex items-center gap-2.5">
                <Phone className="size-4 text-white/40" />
                <a href={`tel:${c.phone.replace(/\s/g, '')}`} className="hover:text-white">
                  {c.phone}
                </a>
              </li>
            ) : null}
            {c.email ? (
              <li className="flex items-center gap-2.5">
                <Mail className="size-4 text-white/40" />
                <a href={`mailto:${c.email}`} className="hover:text-white">
                  {c.email}
                </a>
              </li>
            ) : null}
            {c.address ? (
              <li className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 size-4 shrink-0 text-white/40" />
                <span>{c.address}</span>
              </li>
            ) : null}
          </ul>
        </div>

        <FooterColumn title="Explore">
          <FooterLink href={`/buy/${citySlug}`}>Property for sale in {cityName}</FooterLink>
          <FooterLink href={`/rent/${citySlug}`}>Property for rent in {cityName}</FooterLink>
          <FooterLink href="/projects">New projects</FooterLink>
          <FooterLink href={`/buy/${citySlug}?type=residential-plot`}>Residential plots</FooterLink>
          <FooterLink href={`/buy/${citySlug}?segment=COMMERCIAL`}>Commercial spaces</FooterLink>
        </FooterColumn>

        <FooterColumn title={`Popular in ${cityName}`}>
          {localities.slice(0, 6).map((l) => (
            <FooterLink key={l.slug} href={`/buy/${citySlug}/${l.slug}`}>
              {l.name}
            </FooterLink>
          ))}
        </FooterColumn>

        <FooterColumn title="Company">
          {company.map((p) => (
            <FooterLink key={p.slug} href={`/${p.slug}`}>
              {p.title}
            </FooterLink>
          ))}
          <FooterLink href="/faqs">FAQs</FooterLink>
          <FooterLink href="/contact">Contact us</FooterLink>
        </FooterColumn>

        <FooterColumn title="Partners">
          <FooterLink href="/sell">List your property</FooterLink>
          <FooterLink href="/partners/register">Register as broker or builder</FooterLink>
          {consoleUrl ? <FooterLink href={`${consoleUrl}/login`}>Partner & staff login</FooterLink> : null}
          {partnersPages.map((p) => (
            <FooterLink key={p.slug} href={`/${p.slug}`}>
              {p.title}
            </FooterLink>
          ))}
        </FooterColumn>
      </div>
      <div className="border-t border-white/10">
        <div className="container-page flex flex-col gap-3 py-6 text-xs text-white/45 md:flex-row md:items-center md:justify-between">
          <p>
            © {year} {settings.company.legalName || settings.brand.name}
            {settings.company.reraAgentNumber ? ` · RERA agent registration ${settings.company.reraAgentNumber}` : ''}
          </p>
          <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Legal">
            {legal.map((p) => (
              <Link key={p.slug} href={`/${p.slug}`} className="hover:text-white">
                {p.title}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-display text-sm font-semibold text-white">{title}</h2>
      <ul className="mt-4 space-y-2.5 text-sm">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="transition-colors hover:text-white">
        {children}
      </Link>
    </li>
  );
}
