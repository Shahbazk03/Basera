'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn, Spinner } from '@estate/ui';
import { useCurrentUser } from '@/lib/session';

const TABS = [
  { href: '/account', label: 'Overview' },
  { href: '/account/saved', label: 'Saved properties' },
  { href: '/account/enquiries', label: 'My enquiries' },
  { href: '/account/security', label: 'Password & security' },
];

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useCurrentUser();
  const router = useRouter();
  const pathname = usePathname();
  React.useEffect(() => {
    if (!isLoading && !user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [isLoading, user, router, pathname]);

  if (isLoading || !user) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <Spinner label="Loading your account" />
      </div>
    );
  }
  return (
    <div className="bg-canvas">
      <div className="border-b border-line bg-surface">
        <div className="container-page pt-8">
          <h1 className="text-[26px] font-bold text-ink-900">Hello, {user.fullName.split(' ')[0]}</h1>
          <nav className="scrollbar-none -mb-px mt-5 flex gap-1 overflow-x-auto" aria-label="Account">
            {TABS.map((t) => {
              const active = t.href === '/account' ? pathname === '/account' : pathname.startsWith(t.href);
              return (
                <Link key={t.href} href={t.href} className={cn('whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium', active ? 'border-brand text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-900')}>
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      <div className="container-page py-8">{children}</div>
    </div>
  );
}
