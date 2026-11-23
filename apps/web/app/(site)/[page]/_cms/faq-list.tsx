import { ChevronDown } from 'lucide-react';

export interface PublicFaq {
  id: string;
  category: string;
  question: string;
  answer: string;
}

/** Accessible accordion using native <details> — works without JavaScript. Text only, never HTML. */
export function FaqList({ faqs }: { faqs: PublicFaq[] }) {
  return (
    <div className="divide-y divide-line rounded-xl border border-line bg-surface">
      {faqs.map((f) => (
        <details key={f.id} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-[15px] font-semibold text-ink-900">
            {f.question}
            <ChevronDown className="mt-0.5 size-4 shrink-0 text-ink-400 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <p className="mt-3 text-[14.5px] leading-relaxed whitespace-pre-line text-ink-600">{f.answer}</p>
        </details>
      ))}
    </div>
  );
}

/** schema.org FAQPage data for search engines (escaped so it cannot break out of the script tag). */
export function faqJsonLd(faqs: PublicFaq[]): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
  }).replace(/</g, '\\u003c');
}
