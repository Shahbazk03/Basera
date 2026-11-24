'use client';

import * as React from 'react';
import Image from 'next/image';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { ChevronLeft, ChevronRight, Grid2x2, X } from 'lucide-react';
import { cn } from '@estate/ui';

export interface GalleryImage {
  id: string;
  url: string;
  caption: string | null;
}

export function Gallery({ images, title }: { images: GalleryImage[]; title: string }) {
  const [open, setOpen] = React.useState(false);
  const [index, setIndex] = React.useState(0);
  const show = (i: number) => {
    setIndex(i);
    setOpen(true);
  };
  const go = React.useCallback((d: number) => setIndex((i) => (i + d + images.length) % images.length), [images.length]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, go]);

  if (!images.length) {
    return <div className="grid aspect-[16/9] place-items-center rounded-xl bg-ink-100 text-sm text-ink-500">Photos will be added soon</div>;
  }

  const thumbs = images.slice(1, 5);
  // Fill the side panel whatever the photo count: 4 → 2×2, 3 → two on top + one wide, 2 → stacked, 1 → full height.
  const thumbGrid = thumbs.length >= 3 ? 'grid-cols-2 grid-rows-2' : thumbs.length === 2 ? 'grid-cols-1 grid-rows-2' : 'grid-cols-1 grid-rows-1';
  const isWide = (i: number) => (thumbs.length === 3 && i === 2) || thumbs.length <= 2;
  return (
    <>
      <div className={cn('grid gap-2 overflow-hidden rounded-xl', thumbs.length ? 'md:grid-cols-[2fr_1fr]' : '')}>
        <button type="button" onClick={() => show(0)} className="group relative aspect-[16/10] overflow-hidden bg-ink-100 md:aspect-auto md:h-[440px]" aria-label="Open photo gallery">
          <Image src={images[0].url} alt={images[0].caption ?? title} fill priority sizes="(max-width: 768px) 100vw, 66vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
        </button>
        {thumbs.length ? (
          <div className={cn('hidden gap-2 md:grid md:h-[440px]', thumbGrid)}>
            {thumbs.map((img, i) => (
              <button key={img.id} type="button" onClick={() => show(i + 1)} className={cn('group relative overflow-hidden bg-ink-100', thumbs.length === 3 && i === 2 && 'col-span-2')} aria-label={`Open photo ${i + 2}`}>
                <Image src={img.url} alt={img.caption ?? `${title} — photo ${i + 2}`} fill sizes={isWide(i) ? '33vw' : '17vw'} className="object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                {i === thumbs.length - 1 && images.length > 5 ? (
                  <span className="absolute inset-0 grid place-items-center bg-ink-950/55 text-sm font-semibold text-white">+{images.length - 5} more</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {images.length > 1 ? (
        <button type="button" onClick={() => show(0)} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-700 hover:text-ink-900">
          <Grid2x2 className="size-4" /> View all {images.length} photos
        </button>
      ) : null}

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink-950/95" />
          <DialogPrimitive.Content className="fixed inset-0 z-50 flex flex-col focus:outline-none">
            <DialogPrimitive.Title className="sr-only">{title} photos</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Use the arrow keys to move between photos</DialogPrimitive.Description>
            <div className="flex items-center justify-between px-4 py-3 text-white/80">
              <span className="tabular text-sm">
                {index + 1} / {images.length}
              </span>
              <DialogPrimitive.Close className="rounded-md p-2 hover:bg-white/10" aria-label="Close gallery">
                <X className="size-5" />
              </DialogPrimitive.Close>
            </div>
            <div className="relative min-h-0 flex-1">
              <Image src={images[index].url} alt={images[index].caption ?? title} fill sizes="100vw" className="object-contain" />
              {images.length > 1 ? (
                <>
                  <button type="button" onClick={() => go(-1)} className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20" aria-label="Previous photo">
                    <ChevronLeft className="size-5" />
                  </button>
                  <button type="button" onClick={() => go(1)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20" aria-label="Next photo">
                    <ChevronRight className="size-5" />
                  </button>
                </>
              ) : null}
            </div>
            {images[index].caption ? <p className="px-4 py-3 text-center text-sm text-white/75">{images[index].caption}</p> : <div className="h-6" />}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
