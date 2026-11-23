'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Spinner } from '@estate/ui';
import { SessionProvider, useSessionQuery } from '@/lib/session';
import { AppShell } from '@/components/shell/app-shell';
import { ForcePasswordChange, NoConsoleAccess } from '@/components/auth/session-gates';

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useSessionQuery();

  React.useEffect(() => {
    if (session.isError) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [session.isError, pathname, router]);

  if (!session.data) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner label="Loading your workspace" />
      </div>
    );
  }

  // A temporary (administrator-set) password must be replaced first; accounts without a console workspace
  // (customers) get an explanation instead of a dashboard they cannot use.
  if (session.data.mustChangePassword) return <ForcePasswordChange user={session.data} />;
  if (!session.data.workspaces.length) return <NoConsoleAccess user={session.data} />;

  return (
    <SessionProvider user={session.data}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
