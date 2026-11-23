import * as React from 'react';

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="bg-canvas">
      <div className="container-page flex justify-center py-14 md:py-20">
        <div className="w-full max-w-[440px]">
          <div className="rounded-2xl border border-line bg-surface p-7 shadow-card md:p-9">
            <h1 className="text-[24px] font-bold tracking-tight text-ink-900">{title}</h1>
            {subtitle ? <p className="mt-2 text-sm text-ink-500">{subtitle}</p> : null}
            <div className="mt-7">{children}</div>
          </div>
          {footer ? <div className="mt-6 text-center text-sm text-ink-500">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function safeNext(next: string | null | undefined, fallback = '/'): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : fallback;
}
