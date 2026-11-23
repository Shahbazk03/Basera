'use client';

import * as React from 'react';
import { ImagePlus, LoaderCircle, X } from 'lucide-react';
import { errorMessage } from '@estate/api-client';
import { Button, Input, toast } from '@estate/ui';
import { api } from '@/lib/api';

/**
 * A single public website image: upload (re-encoded by the API, purpose "cms-media") or paste an
 * https:// URL or a site-relative path.
 */
export function ImageInput({ id, value, onChange, invalid }: { id?: string; value: string; onChange: (url: string) => void; invalid?: boolean }) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="grid gap-2">
      {value ? (
        <div className="relative w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" className="h-24 max-w-full rounded-lg border border-line object-cover" />
          <button type="button" onClick={() => onChange('')} className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-ink-900 text-white shadow" aria-label="Remove image">
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      <div className="flex gap-2">
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://… or /uploads/…" aria-invalid={invalid} />
        <Button type="button" variant="outline" disabled={busy} onClick={() => ref.current?.click()}>
          {busy ? <LoaderCircle className="animate-spin" /> : <ImagePlus />} Upload
        </Button>
      </div>
      <input
        ref={ref}
        type="file"
        hidden
        accept="image/jpeg,image/png,image/webp,image/avif"
        onChange={async (ev) => {
          const file = ev.target.files?.[0];
          ev.target.value = '';
          if (!file) return;
          setBusy(true);
          try {
            const res = await api.upload(file, 'cms-media');
            if (!res.url) throw new Error('The upload did not return a public address');
            onChange(res.url);
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
