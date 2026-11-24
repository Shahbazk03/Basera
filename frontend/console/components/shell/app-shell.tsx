'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Bell, Building2, Check, ChevronsUpDown, LogOut, Menu, UserCircle, X } from 'lucide-react';
import {
  Avatar,
  Badge,
  BrandMark,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from '@estate/ui';
import { enumLabel, type WorkspaceKey } from '@estate/shared';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/hooks';
import { visibleNav, WORKSPACE_DESCRIPTIONS, WORKSPACE_LABELS, type NavGroup } from '@/lib/nav';
import { useBrandName } from '@/lib/brand';

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarNav({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  // Most specific match wins (e.g. /listings/reviews over /listings)
  const allHrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  const activeHref = allHrefs.filter((h) => isActive(pathname, h)).sort((a, b) => b.length - a.length)[0];
  return (
    <nav className="flex flex-col gap-5 px-3 pb-6" aria-label="Main">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">{g.label}</p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((it) => {
              const active = it.href === activeHref;
              const Icon = it.icon;
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13.5px] font-medium transition-colors',
                      active ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
                    )}
                  >
                    <Icon className={cn('size-4 shrink-0', active ? 'text-white/85' : 'text-ink-400')} aria-hidden />
                    <span className="truncate">{it.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function WorkspaceSwitcher() {
  const { user, workspace, setWorkspace, activeOrg } = useSession();
  const brandName = useBrandName();
  const router = useRouter();
  const switchTo = (ws: WorkspaceKey) => {
    if (ws === workspace) return;
    setWorkspace(ws);
    router.push('/');
    toast.success(`Switched to ${WORKSPACE_LABELS[ws]}`);
  };
  const label = activeOrg && activeOrg.organizationType !== 'PLATFORM' ? activeOrg.organizationName : WORKSPACE_LABELS[workspace];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-surface px-2.5 py-2 text-left shadow-xs transition-colors hover:border-ink-300">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-ink-900 text-white">
          <Building2 className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ink-900">{label}</span>
          {/* Partner workspaces show the organisation above the workspace type; company workspaces show the company. */}
          <span className="block truncate text-[11.5px] text-ink-500">{label === WORKSPACE_LABELS[workspace] ? brandName : WORKSPACE_LABELS[workspace]}</span>
        </span>
        {user.workspaces.length > 1 ? <ChevronsUpDown className="size-4 text-ink-400" /> : null}
      </DropdownMenuTrigger>
      {user.workspaces.length > 1 ? (
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
          {user.workspaces.map((ws: WorkspaceKey) => (
            <DropdownMenuItem key={ws} onSelect={() => switchTo(ws)} className="items-start">
              <span className="flex-1">
                <span className="block font-medium text-ink-900">{WORKSPACE_LABELS[ws]}</span>
                <span className="block text-[11.5px] leading-snug text-ink-500">{WORKSPACE_DESCRIPTIONS[ws]}</span>
              </span>
              {ws === workspace ? <Check className="mt-0.5 !text-brand" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      ) : null}
    </DropdownMenu>
  );
}

function NotificationBell() {
  const { data } = useApi<{ unread: number }>('/notifications/unread-count', undefined, { refetchInterval: 60_000 });
  const unread = data?.unread ?? 0;
  return (
    <Link href="/notifications" className="relative grid size-9 place-items-center rounded-md text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900" aria-label={unread ? `${unread} unread notifications` : 'Notifications'}>
      <Bell className="size-[18px]" />
      {unread > 0 ? <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white">{unread > 99 ? '99+' : unread}</span> : null}
    </Link>
  );
}

function UserMenu() {
  const { user, logout } = useSession();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 transition-colors hover:bg-ink-100">
        <Avatar name={user.fullName} src={user.avatarUrl} size={30} />
        <span className="hidden text-left sm:block">
          <span className="block max-w-40 truncate text-[13px] font-medium text-ink-900">{user.fullName}</span>
          <span className="block max-w-40 truncate text-[11.5px] text-ink-500">{user.roles[0]?.name ?? enumLabel(user.accountType)}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuLabel>
          <span className="block truncate text-ink-900">{user.fullName}</span>
          <span className="block truncate font-normal">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account">
            <UserCircle /> Account & security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem tone="danger" onSelect={() => void logout()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { workspace, canAny, user, activeOrg } = useSession();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const groups = React.useMemo(() => visibleNav({ workspace, workspaces: user.workspaces, canAny, isEmployee: Boolean(user.employeeId) }), [workspace, user.workspaces, canAny, user.employeeId]);
  const pendingOrg = activeOrg && activeOrg.organizationType !== 'PLATFORM' && activeOrg.organizationStatus !== 'ACTIVE';

  const brandName = useBrandName();
  const brand = (
    <Link href="/" className="flex items-center gap-2.5 px-2" aria-label={`${brandName} business console — dashboard`}>
      <BrandMark className="size-7 text-brand" />
      <span className="font-display text-[15px] font-bold tracking-tight text-ink-900">{brandName}</span>
      <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-500">Console</span>
    </Link>
  );

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-14 items-center border-b border-line px-3">{brand}</div>
        <div className="px-3 py-3">
          <WorkspaceSwitcher />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pt-1">
          <SidebarNav groups={groups} />
        </div>
      </aside>

      {/* Mobile sidebar */}
      <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink-950/40 lg:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-surface shadow-overlay lg:hidden">
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Console navigation</DialogPrimitive.Description>
            <div className="flex h-14 items-center justify-between border-b border-line px-3">
              {brand}
              <DialogPrimitive.Close className="rounded-md p-2 text-ink-500 hover:bg-ink-100" aria-label="Close navigation">
                <X className="size-4" />
              </DialogPrimitive.Close>
            </div>
            <div className="px-3 py-3">
              <WorkspaceSwitcher />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SidebarNav groups={groups} onNavigate={() => setMobileOpen(false)} />
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur lg:px-6">
          <button type="button" onClick={() => setMobileOpen(true)} className="rounded-md p-2 text-ink-600 hover:bg-ink-100 lg:hidden" aria-label="Open navigation">
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            {pendingOrg ? (
              <Badge tone="warning" className="max-w-full truncate">
                {activeOrg.organizationName}: {activeOrg.organizationStatus === 'PENDING' ? 'verification pending — listings cannot go live yet' : enumLabel(activeOrg.organizationStatus)}
              </Badge>
            ) : null}
          </div>
          <NotificationBell />
          <UserMenu />
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1320px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

export { Bell };
