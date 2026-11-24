'use client';

import * as React from 'react';
import type { EnquiryType } from '@estate/shared';
import { Dialog, DialogContent, DialogTrigger } from '@estate/ui';
import { EnquiryForm, type EnquiryTarget } from './enquiry-form';

const COPY: Partial<Record<EnquiryType, { title: string; description: string; submit: string }>> = {
  GENERAL: { title: 'Send an enquiry', description: 'Share your requirement and our team will get back to you.', submit: 'Send enquiry' },
  CALLBACK: { title: 'Request a callback', description: 'Leave your number and we will call you back.', submit: 'Request callback' },
  SITE_VISIT: { title: 'Schedule a site visit', description: 'Pick a date that suits you — we will confirm the visit by phone.', submit: 'Request site visit' },
  UNIT_ENQUIRY: { title: 'Enquire about this unit', description: 'Get the latest price, availability and booking steps for this unit.', submit: 'Send unit enquiry' },
  PRICE_REQUEST: { title: 'Get price details', description: 'Receive the current price breakup and offers.', submit: 'Get price details' },
  WHATSAPP: { title: 'Chat on WhatsApp', description: 'Share your details so our team can respond to you on WhatsApp.', submit: 'Continue to WhatsApp' },
  DOCUMENT_REQUEST: { title: 'Request documents', description: 'Approved documents are shared after verifying your interest.', submit: 'Request documents' },
  BROKER_CONTACT: { title: 'Contact the agent', description: 'The listing agent will contact you shortly.', submit: 'Contact agent' },
};

export function EnquiryDialog({
  type,
  subject,
  trigger,
  open,
  onOpenChange,
  ...target
}: EnquiryTarget & { type: EnquiryType; subject?: string; trigger?: React.ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const copy = COPY[type] ?? COPY.GENERAL!;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent title={copy.title} description={subject ? `${copy.description} — ${subject}` : copy.description}>
        <EnquiryForm type={type} submitLabel={copy.submit} compact={type === 'CALLBACK' || type === 'WHATSAPP'} {...target} />
      </DialogContent>
    </Dialog>
  );
}
