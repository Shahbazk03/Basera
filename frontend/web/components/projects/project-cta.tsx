'use client';

import * as React from 'react';
import { CalendarDays, MessageCircle, Phone, Send } from 'lucide-react';
import type { CtaAction, EnquiryType } from '@estate/shared';
import { Button, type ButtonProps } from '@estate/ui';
import { EnquiryDialog } from '@/components/enquiry/enquiry-dialog';

const ACTION_TYPE: Record<Exclude<CtaAction, 'VIEW_INVENTORY'>, EnquiryType> = {
  ENQUIRE: 'GENERAL',
  SITE_VISIT: 'SITE_VISIT',
  CALLBACK: 'CALLBACK',
  WHATSAPP: 'WHATSAPP',
};

const ICONS: Record<CtaAction, React.ReactNode> = {
  ENQUIRE: <Send />,
  SITE_VISIT: <CalendarDays />,
  CALLBACK: <Phone />,
  WHATSAPP: <MessageCircle />,
  VIEW_INVENTORY: null,
};

/**
 * A project call-to-action. Enquiry actions open the shared enquiry dialog (every submission becomes
 * a CRM lead); WhatsApp falls back to a normal enquiry when no WhatsApp number is configured, and
 * “view inventory” scrolls to the inventory section.
 */
export function ProjectCta({
  action,
  label,
  projectId,
  projectName,
  whatsappAvailable,
  variant = 'primary',
  size = 'lg',
  className,
}: {
  action: CtaAction;
  label: string;
  projectId: string;
  projectName: string;
  whatsappAvailable: boolean;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
}) {
  if (action === 'VIEW_INVENTORY') {
    return (
      <Button asChild variant={variant} size={size} className={className}>
        <a href="#inventory">{label}</a>
      </Button>
    );
  }
  const effective: Exclude<CtaAction, 'VIEW_INVENTORY'> = action === 'WHATSAPP' && !whatsappAvailable ? 'ENQUIRE' : action;
  return (
    <EnquiryDialog
      type={ACTION_TYPE[effective]}
      projectId={projectId}
      subject={projectName}
      trigger={
        <Button variant={effective === 'WHATSAPP' ? 'whatsapp' : variant} size={size} className={className}>
          {ICONS[effective]}
          {label}
        </Button>
      }
    />
  );
}
