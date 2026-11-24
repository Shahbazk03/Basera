import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { formatDate } from '@estate/shared';
import { apiGet, getSettings } from '@/lib/api-server';
import { CmsBlocks, parseBlocks } from './_cms/blocks';
import { buildMetadata, getSeoOverride } from './_cms/seo';

export const revalidate = 60;

interface PublicPage {
  slug: string;
  title: string;
  blocks: unknown;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  ogImageUrl: string | null;
  noIndex: boolean;
  publishedAt: string | null;
  updatedAt: string;
}

type Props = { params: Promise<{ page: string }> };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Published CMS page or 404 (drafts, archived pages and malformed addresses are never served). */
async function loadPage(slug: string): Promise<PublicPage> {
  if (!SLUG.test(slug) || slug.length > 80) notFound();
  return apiGet<PublicPage>(`/public/pages/${slug}`, undefined, { revalidate: 60 });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { page: slug } = await params;
  const [page, override] = await Promise.all([loadPage(slug), getSeoOverride(`/${slug}`)]);
  return buildMetadata(`/${slug}`, { title: page.title, description: page.seoDescription, seoTitle: page.seoTitle, canonicalUrl: page.canonicalUrl, ogImageUrl: page.ogImageUrl, noIndex: page.noIndex }, override);
}

export default async function CmsPage({ params }: Props) {
  const { page: slug } = await params;
  const [page, settings] = await Promise.all([loadPage(slug), getSettings()]);
  const blocks = parseBlocks(page.blocks);
  return (
    <article>
      <header className="border-b border-line bg-canvas">
        <div className="container-page py-10 md:py-14">
          <nav aria-label="Breadcrumb" className="text-[13px] text-ink-500">
            <Link href="/" className="hover:text-ink-900">
              Home
            </Link>
            <span className="mx-1.5" aria-hidden>
              /
            </span>
            <span className="text-ink-700">{page.title}</span>
          </nav>
          <h1 className="mt-3 max-w-3xl text-[30px] leading-tight font-extrabold text-ink-900 md:text-[38px]">{page.title}</h1>
          <p className="mt-2 text-[13px] text-ink-500">Last updated {formatDate(page.updatedAt)}</p>
        </div>
      </header>
      <div className="container-page py-10 md:py-14">
        <div className="max-w-3xl">
          {blocks.length ? <CmsBlocks blocks={blocks} settings={settings} /> : <p className="text-ink-500">This page has no content yet.</p>}
        </div>
      </div>
    </article>
  );
}
