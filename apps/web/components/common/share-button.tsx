'use client';

import * as React from 'react';
import { Check, Share2 } from 'lucide-react';
import { Button, toast } from '@estate/ui';

export function ShareButton({ title, text }: { title: string; text?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        const url = window.location.href.split('#')[0];
        try {
          if (navigator.share) {
            await navigator.share({ title, text, url });
            return;
          }
          await navigator.clipboard.writeText(url);
          setCopied(true);
          toast.success('Link copied');
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* user cancelled */
        }
      }}
    >
      {copied ? <Check /> : <Share2 />} Share
    </Button>
  );
}
