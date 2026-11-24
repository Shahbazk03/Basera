'use client';

import * as React from 'react';
import { BrandMark } from '@estate/ui';
import { useBrandName } from '@/lib/brand';

/** Split layout for sign-in / recovery pages. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  const brand = useBrandName();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <section className="relative hidden overflow-hidden bg-ink-950 lg:block">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.35) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
            maskImage: 'radial-gradient(ellipse at 30% 40%, black 30%, transparent 75%)',
          }}
        />
        <div aria-hidden className="absolute -left-24 bottom-[-120px] size-[520px] rounded-full bg-brand/30 blur-3xl" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <BrandMark className="size-9 text-brand" />
            <span className="leading-tight">
              <span className="block font-display text-lg font-semibold">{brand}</span>
              <span className="block text-xs font-medium uppercase tracking-[0.14em] text-white/55">Business console</span>
            </span>
          </div>
          <div className="max-w-md">
            <h2 className="font-display text-[34px] font-semibold leading-tight tracking-tight text-white">Listings, projects, leads and people — run from one place.</h2>
            <ul className="mt-8 space-y-3 text-[15px] text-white/75">
              <li>Review and publish listings with a full audit trail.</li>
              <li>Live project inventory and microsites with custom domains.</li>
              <li>Lead routing, follow-ups, site visits, payroll and commissions.</li>
            </ul>
          </div>
          <p className="text-xs text-white/45">Access is restricted to authorised staff and verified partners.</p>
        </div>
      </section>
      <section className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <BrandMark className="size-9 text-brand" />
            <span className="font-display text-lg font-semibold text-ink-900">{brand}</span>
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight text-ink-900">{title}</h1>
          {subtitle ? <p className="mt-2 text-sm text-ink-500">{subtitle}</p> : null}
          <div className="mt-8">{children}</div>
          {footer ? <div className="mt-8 border-t border-line pt-6 text-sm text-ink-500">{footer}</div> : null}
        </div>
      </section>
    </div>
  );
}
