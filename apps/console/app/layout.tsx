import type { Metadata } from 'next';
import { Inter, Plus_Jakarta_Sans } from 'next/font/google';
import { getBrandName } from '@/lib/brand-server';
import { Providers } from './providers';
import './globals.css';

const body = Inter({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const heading = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-heading', weight: ['500', '600', '700'], display: 'swap' });

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrandName();
  return {
    title: { default: `${brand} · Business console`, template: `%s · ${brand}` },
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBrandName();
  return (
    <html lang="en-IN" className={`${body.variable} ${heading.variable}`}>
      <body className="min-h-dvh">
        <Providers brandName={brand}>{children}</Providers>
      </body>
    </html>
  );
}
