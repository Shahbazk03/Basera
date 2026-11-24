'use client';

import * as React from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { errorMessage } from '@estate/api-client';
import { Button, toast } from '@estate/ui';
import { api } from '@/lib/api';

/** Uploads one image (server-validated and re-encoded) and reports its public URL. */
export function SingleImageField({
  value,
  onChange,
  organizationId,
  disabled,
  aspect = 'aspect-[16/9]',
  label = 'Upload image',
}: {
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  organizationId?: string | null;
  disabled?: boolean;
  aspect?: string;
  label?: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className={`relative w-full max-w-md overflow-hidden rounded-lg border border-line bg-ink-50 ${aspect}`}>
        {value ? <img src={value} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-xs text-ink-400">No image</div>}
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" loading={busy} disabled={disabled} onClick={() => ref.current?.click()}>
          <ImagePlus /> {value ? 'Replace' : label}
        </Button>
        {value ? (
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>
            <Trash2 /> Remove
          </Button>
        ) : null}
      </div>
      <input
        ref={ref}
        type="file"
        hidden
        accept="image/jpeg,image/png,image/webp,image/avif"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          try {
            const res = await api.upload(file, 'project-media', organizationId ?? undefined);
            onChange(res.url);
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setBusy(false);
            if (ref.current) ref.current.value = '';
          }
        }}
      />
    </div>
  );
}
