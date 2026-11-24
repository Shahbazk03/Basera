'use client';

import * as React from 'react';
import { Download } from 'lucide-react';
import { errorMessage } from '@estate/api-client';
import { Button, toast } from '@estate/ui';
import { api } from '@/lib/api';

/**
 * Downloads an export as this tab's account. A plain link cannot send the tab's account (tabs may be
 * signed in to different accounts), so the file is fetched through the API client and saved.
 */
export function DownloadButton({
  href,
  fileName,
  disabled,
  size,
  children,
}: {
  /** API path, e.g. `/api/v1/crm/leads/export?status=NEW` */
  href: string;
  fileName: string;
  disabled?: boolean;
  size?: 'sm';
  children: React.ReactNode;
}) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      variant="outline"
      size={size}
      loading={busy}
      disabled={disabled}
      onClick={async () => {
        setBusy(true);
        try {
          await api.download(href, fileName);
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Download /> {children}
    </Button>
  );
}
