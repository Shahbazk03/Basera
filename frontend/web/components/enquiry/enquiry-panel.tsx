'use client';

import * as React from 'react';
import { CalendarDays, MessageCircle, Phone, Send } from 'lucide-react';
import type { EnquiryType } from '@estate/shared';
import { Button, cn } from '@estate/ui';
import { EnquiryForm, type EnquiryTarget } from './enquiry-form';
import { EnquiryDialog } from './enquiry-dialog';

const TABS: { type: EnquiryType; label: string; icon: React.ReactNode; submit: string }[] = [
  { type: 'GENERAL', label: 'Get details', icon: <Send />, submit: 'Send enquiry' },
  { type: 'CALLBACK', label: 'Callback', icon: <Phone />, submit: 'Request callback' },
  { type: 'SITE_VISIT', label: 'Site visit', icon: <CalendarDays />, submit: 'Request site visit' },
];

/** Sidebar enquiry panel for property and project pages. */
export function EnquiryPanel({ heading, whatsappAvailable, disabledReason, ...target }: EnquiryTarget & { heading?: string; whatsappAvailable?: boolean; disabledReason?: string | null }) {
  const [type, setType] = React.useState<EnquiryType>('GENERAL');
  const current = TABS.find((t) => t.type === type)!;
  return (
    <section aria-label="Enquire" className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <h2 className="text-[17px] font-semibold text-ink-900">{heading ?? 'Interested in this property?'}</h2>
      {disabledReason ? (
        <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2.5 text-sm text-ink-600">{disabledReason}</p>
      ) : (
        <>
          <div role="tablist" className="mt-4 grid grid-cols-3 gap-1 rounded-lg bg-ink-100 p-1">
            {TABS.map((t) => (
              <button
                key={t.type}
                type="button"
                role="tab"
                aria-selected={type === t.type}
                onClick={() => setType(t.type)}
                className={cn('inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[12.5px] font-medium transition-colors [&_svg]:size-3.5', type === t.type ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-600 hover:text-ink-900')}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
          <EnquiryForm key={type} type={type} submitLabel={current.submit} compact={type === 'CALLBACK'} className="mt-4" {...target} />
          {whatsappAvailable ? (
            <EnquiryDialog
              type="WHATSAPP"
              {...target}
              trigger={
                <Button variant="whatsapp" className="mt-3 w-full">
                  <MessageCircle /> Chat on WhatsApp
                </Button>
              }
            />
          ) : null}
        </>
      )}
    </section>
  );
}
