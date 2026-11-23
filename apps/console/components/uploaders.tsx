'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, FileText, ImagePlus, LoaderCircle, Star, Trash2, Upload } from 'lucide-react';
import { errorMessage } from '@estate/api-client';
import { Badge, Button, cn, toast } from '@estate/ui';
import { api } from '@/lib/api';

export interface MediaItem {
  key: string;
  url: string;
  fileId?: string;
  caption?: string | null;
  isCover?: boolean;
  type?: 'IMAGE' | 'VIDEO' | 'FLOOR_PLAN' | 'MASTER_PLAN';
}

const ACCEPT_IMAGES = 'image/jpeg,image/png,image/webp,image/avif';

/**
 * Multi-image uploader: uploads immediately (server validates + re-encodes), supports ordering,
 * cover selection and removal. The parent persists the ordered list.
 */
export function ImageUploader({
  items,
  onChange,
  purpose,
  organizationId,
  max = 30,
  disabled,
}: {
  items: MediaItem[];
  onChange: (items: MediaItem[]) => void;
  purpose: 'property-media' | 'project-media' | 'cms-media';
  organizationId?: string | null;
  max?: number;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const itemsRef = React.useRef(items);
  itemsRef.current = items;

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const slots = Math.max(0, max - itemsRef.current.length);
    const list = Array.from(files).slice(0, slots);
    if (files.length > slots) toast.warning(`Only ${slots} more photo(s) can be added (maximum ${max}).`);
    setUploading((n) => n + list.length);
    for (const file of list) {
      try {
        const res = await api.upload(file, purpose, organizationId ?? undefined);
        const next = [...itemsRef.current, { key: res.id, url: res.url!, fileId: res.id, type: 'IMAGE' as const, isCover: itemsRef.current.length === 0 }];
        itemsRef.current = next;
        onChange(next);
      } catch (err) {
        toast.error(`${file.name}: ${errorMessage(err)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (inputRef.current) inputRef.current.value = '';
  }

  const move = (i: number, dir: -1 | 1) => {
    const next = [...items];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!disabled) void handleFiles(e.dataTransfer.files);
        }}
        className={cn('flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-ink-50/60 px-6 py-8 text-center', disabled && 'opacity-60')}
      >
        <div className="grid size-11 place-items-center rounded-full bg-surface text-ink-500 shadow-card">
          <ImagePlus className="size-5" />
        </div>
        <p className="mt-3 text-sm font-medium text-ink-900">Drag photos here or browse</p>
        <p className="mt-1 text-xs text-ink-500">JPEG, PNG, WebP or AVIF up to 10 MB each. Location metadata is removed automatically.</p>
        <Button type="button" variant="outline" size="sm" className="mt-4" disabled={disabled || items.length >= max} onClick={() => inputRef.current?.click()}>
          <Upload /> Choose photos
        </Button>
        <input ref={inputRef} type="file" accept={ACCEPT_IMAGES} multiple hidden onChange={(e) => void handleFiles(e.target.files)} />
      </div>

      {items.length || uploading ? (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((m, i) => (
            <li key={m.key} className="group relative overflow-hidden rounded-lg border border-line bg-surface">
              <div className="aspect-[4/3] bg-ink-100">
                <img src={m.url} alt="" className="size-full object-cover" />
              </div>
              {m.isCover ? (
                <Badge tone="dark" size="sm" className="absolute left-2 top-2">
                  Cover
                </Badge>
              ) : null}
              <div className="flex items-center justify-between gap-1 border-t border-line px-1.5 py-1">
                <div className="flex">
                  <IconBtn label="Move earlier" onClick={() => move(i, -1)} disabled={disabled || i === 0}>
                    <ArrowUp />
                  </IconBtn>
                  <IconBtn label="Move later" onClick={() => move(i, 1)} disabled={disabled || i === items.length - 1}>
                    <ArrowDown />
                  </IconBtn>
                </div>
                <div className="flex">
                  <IconBtn label="Set as cover" onClick={() => onChange(items.map((x, j) => ({ ...x, isCover: j === i })))} disabled={disabled || m.isCover}>
                    <Star />
                  </IconBtn>
                  <IconBtn
                    label="Remove"
                    tone="danger"
                    disabled={disabled}
                    onClick={() => {
                      const next = items.filter((_, j) => j !== i);
                      if (m.isCover && next[0]) next[0] = { ...next[0], isCover: true };
                      onChange(next);
                    }}
                  >
                    <Trash2 />
                  </IconBtn>
                </div>
              </div>
            </li>
          ))}
          {Array.from({ length: uploading }).map((_, i) => (
            <li key={`up-${i}`} className="grid aspect-[4/3] place-items-center rounded-lg border border-line bg-ink-50 text-ink-500">
              <LoaderCircle className="size-5 animate-spin" />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function IconBtn({ children, label, onClick, disabled, tone }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; tone?: 'danger' }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn('grid size-7 place-items-center rounded-md text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900 disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-3.5', tone === 'danger' && 'hover:bg-danger-soft hover:text-danger')}
    >
      {children}
    </button>
  );
}

/** Single private document upload → returns the stored file id. */
export function DocumentUpload({
  purpose,
  organizationId,
  onUploaded,
  label = 'Upload document',
  disabled,
}: {
  purpose: 'property-document' | 'project-document' | 'org-document' | 'employee-document' | 'receipt';
  organizationId?: string | null;
  onUploaded: (file: { id: string; fileName: string }) => void;
  label?: string;
  disabled?: boolean;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [name, setName] = React.useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      <Button type="button" variant="outline" size="sm" loading={busy} disabled={disabled} onClick={() => ref.current?.click()}>
        <FileText /> {label}
      </Button>
      {name ? <span className="truncate text-xs text-ink-500">{name}</span> : <span className="text-xs text-ink-500">PDF or image, up to 15 MB</span>}
      <input
        ref={ref}
        type="file"
        hidden
        accept="application/pdf,image/jpeg,image/png,image/webp"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          try {
            const res = await api.upload(file, purpose, organizationId ?? undefined);
            setName(res.fileName);
            onUploaded({ id: res.id, fileName: res.fileName });
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

/** Opens a private document through a short-lived signed URL. */
export async function openDocument(fileId: string) {
  try {
    const res = await api.get<{ url: string }>(`/files/${fileId}/url`);
    window.open(res.url, '_blank', 'noopener,noreferrer');
  } catch (err) {
    toast.error(errorMessage(err));
  }
}
