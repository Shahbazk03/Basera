import type { Metadata, Viewport } from 'next';
import { Inter, Plus_Jakarta_Sans } from 'next/font/google';
import { getSettings, siteUrl } from '@/lib/api-server';
import { Providers } from './providers';
import './globals.css';

const body = Inter({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const heading = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-heading', weight: ['500', '600', '700', '800'], display: 'swap' });

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: s.seo.defaultTitle || s.brand.name, template: `%s | ${s.brand.name}` },
    description: s.seo.defaultDescription || undefined,
    applicationName: s.brand.name,
    openGraph: { siteName: s.brand.name, type: 'website', locale: 'en_IN' },
    robots: s.seo.robotsAllowIndexing ? { index: true, follow: true } : { index: false, follow: false },
  };
}

export const viewport: Viewport = { themeColor: '#0c1c2e', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings();
  const brand = /^#[0-9a-fA-F]{6}$/.test(settings.brand.primaryColor) ? settings.brand.primaryColor : '#0f766e';
  return (
    <html lang="en-IN" className={`${body.variable} ${heading.variable}`} style={{ ['--brand' as string]: brand }}>
      <body className="min-h-dvh bg-surface">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
