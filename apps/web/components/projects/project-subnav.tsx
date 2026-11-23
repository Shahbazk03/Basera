'use client';

import * as React from 'react';
import { cn } from '@estate/ui';
import { ProjectCta } from './project-cta';

/** Sticky in-page navigation for a project page, highlighting the section in view. */
export function ProjectSubnav({
  items,
  projectId,
  projectName,
  whatsappAvailable,
  enquireLabel = 'Enquire now',
  top = 'top-0',
}: {
  items: { id: string; label: string }[];
  projectId: string;
  projectName: string;
  whatsappAvailable: boolean;
  enquireLabel?: string;
  top?: string;
}) {
  const [active, setActive] = React.useState<string | null>(items[0]?.id ?? null);
  React.useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((e): e is HTMLElement => Boolean(e));
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-120px 0px -60% 0px', threshold: 0 },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [items]);

  if (!items.length) return null;
  return (
    <div className={cn('sticky z-30 border-b border-line bg-surface/95 backdrop-blur', top)}>
      <div className="container-page flex items-center gap-4">
        <nav aria-label="Project sections" className="scrollbar-none -mb-px flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {items.map((i) => (
            <a
              key={i.id}
              href={`#${i.id}`}
              className={cn(
                'whitespace-nowrap border-b-2 px-3 py-3.5 text-[13.5px] font-medium transition-colors',
                active === i.id ? 'border-brand text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-900',
              )}
            >
              {i.label}
            </a>
          ))}
        </nav>
        <div className="hidden shrink-0 sm:block">
          <ProjectCta action="ENQUIRE" label={enquireLabel} projectId={projectId} projectName={projectName} whatsappAvailable={whatsappAvailable} size="sm" />
        </div>
      </div>
    </div>
  );
}
