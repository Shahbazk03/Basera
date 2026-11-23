import { Info, TriangleAlert } from 'lucide-react';
import { cmsBlockSchema, type CmsBlock, type PublicSettings } from '@estate/shared';
import { apiGetOptional } from '@/lib/api-server';
import { ContactCard } from './contact-card';
import { FaqList, type PublicFaq } from './faq-list';

/** Re-validates stored blocks; anything malformed is skipped rather than rendered. */
export function parseBlocks(raw: unknown): CmsBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((b) => {
    const r = cmsBlockSchema.safeParse(b);
    return r.success ? [r.data] : [];
  });
}

/**
 * Renders CMS page blocks as plain text. No block type accepts HTML, so page content cannot inject
 * markup or scripts into the website.
 */
export async function CmsBlocks({ blocks, settings }: { blocks: CmsBlock[]; settings: PublicSettings }) {
  const categories = Array.from(new Set(blocks.flatMap((b) => (b.type === 'FAQ_GROUP' ? [b.category] : []))));
  const faqGroups = new Map<string, PublicFaq[]>(
    await Promise.all(categories.map(async (c) => [c, (await apiGetOptional<PublicFaq[]>('/public/faqs', { category: c }, 60)) ?? []] as const)),
  );
  return (
    <div className="grid gap-5">
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'HEADING':
            return b.level === 2 ? (
              <h2 key={i} className="mt-4 text-[22px] font-bold leading-snug text-ink-900 md:text-[24px]">
                {b.text}
              </h2>
            ) : (
              <h3 key={i} className="mt-2 text-[17px] font-semibold text-ink-900">
                {b.text}
              </h3>
            );
          case 'PARAGRAPH':
            return (
              <p key={i} className="text-[15.5px] leading-[1.75] whitespace-pre-line text-ink-700">
                {b.text}
              </p>
            );
          case 'LIST': {
            const Tag = b.ordered ? 'ol' : 'ul';
            return (
              <Tag key={i} className={`ml-5 grid gap-2 text-[15.5px] leading-relaxed text-ink-700 ${b.ordered ? 'list-decimal' : 'list-disc'} marker:text-ink-400`}>
                {b.items.map((it, j) => (
                  <li key={j} className="pl-1">
                    {it}
                  </li>
                ))}
              </Tag>
            );
          }
          case 'CALLOUT':
            return (
              <div key={i} role="note" className={`flex gap-3 rounded-xl border px-4 py-3.5 text-[15px] leading-relaxed ${b.tone === 'warning' ? 'border-warning/30 bg-warning-soft text-ink-800' : 'border-brand/20 bg-brand-soft text-ink-800'}`}>
                {b.tone === 'warning' ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> : <Info className="mt-0.5 size-4 shrink-0 text-brand-strong" aria-hidden />}
                <p className="whitespace-pre-line">{b.text}</p>
              </div>
            );
          case 'IMAGE':
            return (
              <figure key={i} className="my-2">
                {/* Plain <img>: CMS images may be uploads or external addresses not known to the image optimiser. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={b.url} alt={b.alt} loading="lazy" decoding="async" className="w-full rounded-xl border border-line object-cover" />
                {b.caption ? <figcaption className="mt-2 text-center text-[13px] text-ink-500">{b.caption}</figcaption> : null}
              </figure>
            );
          case 'FAQ_GROUP': {
            const faqs = faqGroups.get(b.category) ?? [];
            return faqs.length ? <FaqList key={i} faqs={faqs} /> : null;
          }
          case 'CONTACT_CARD':
            return <ContactCard key={i} settings={settings} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
