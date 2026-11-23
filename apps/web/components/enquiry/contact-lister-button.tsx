'use client';

import { Phone } from 'lucide-react';
import { Button } from '@estate/ui';
import { EnquiryDialog } from './enquiry-dialog';

export function ContactListerButton({ propertyId, title }: { propertyId: string; title: string }) {
  return (
    <EnquiryDialog
      type="CALLBACK"
      propertyId={propertyId}
      subject={title}
      trigger={
        <Button size="sm">
          <Phone /> Contact
        </Button>
      }
    />
  );
}
