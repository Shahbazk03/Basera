import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGetOptional, getSettings } from '@/lib/api-server';
import { FaqList, faqJsonLd, type PublicFaq } from '../[page]/_cms/faq-list';
import { buildMetadata, getSeoOverride } from '../[page]/_cms/seo';

export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const [settings, override] = await Promise.all([getSettings(), getSeoOverride('/faqs')]);
  return buildMetadata('/faqs', { title: 'Frequently asked questions', description: `Answers about buying, renting, listing and site visits with ${settings.brand.name}.` }, override);
}

const anchor = (c: string) => `faq-${c.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

export default async function FaqsPage() {
  const faqs = (await apiGetOptional<PublicFaq[]>('/public/faqs', undefined, 60)) ?? [];
  const categories = Array.from(new Set(faqs.map((f) => f.category)));
  return (
    <>
      {faqs.length ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLd(faqs) }} /> : null}
      <header className="border-b border-line bg-canvas">
        <div className="container-page py-10 md:py-14">
          <h1 className="text-[30px] leading-tight font-extrabold text-ink-900 md:text-[38px]">Frequently asked questions</h1>
          <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-ink-600">
            Can&apos;t find what you need?{' '}
            <Link href="/contact" className="font-medium text-brand-strong hover:underline">
              Contact us
            </Link>{' '}
            and our team will get back to you.
          </p>
          {categories.length > 1 ? (
            <nav aria-label="FAQ topics" className="mt-6 flex flex-wrap gap-2">
              {categories.map((c) => (
                <a key={c} href={`#${anchor(c)}`} className="rounded-full border border-line-strong bg-surface px-3.5 py-1.5 text-[13px] font-medium text-ink-700 hover:border-ink-300 hover:text-ink-900">
                  {c}
                </a>
              ))}
            </nav>
          ) : null}
        </div>
      </header>
      <div className="container-page py-10 md:py-14">
        {faqs.length === 0 ? (
          <p className="text-ink-500">No questions have been published yet.</p>
        ) : (
          <div className="grid max-w-3xl gap-10">
            {categories.map((c) => (
              <section key={c} id={anchor(c)} className="scroll-mt-24">
                <h2 className="mb-4 text-[20px] font-bold text-ink-900">{c}</h2>
                <FaqList faqs={faqs.filter((f) => f.category === c)} />
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
