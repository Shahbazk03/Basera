'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Heart, LayoutDashboard, LogOut, Menu, UserRound, X } from 'lucide-react';
import {
  Avatar,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Logo,
} from '@estate/ui';
import { consoleUrl, useCurrentUser, useSignOut } from '@/lib/session';

export interface NavLink {
  label: string;
  href: string;
}

function AccountMenu() {
  const { data: user, isLoading } = useCurrentUser();
  const signOut = useSignOut();
  const router = useRouter();
  const pathname = usePathname();
  // An administrator-set (temporary) password must be replaced before the account can be used.
  React.useEffect(() => {
    if (user?.mustChangePassword && pathname !== '/account/security') router.replace('/account/security?required=1');
  }, [user?.mustChangePassword, pathname, router]);
  if (isLoading) return <div className="h-9 w-20" aria-hidden />;
  if (!user)
    return (
      <Button asChild variant="dark" size="sm">
        <Link href="/login">Log in</Link>
      </Button>
    );
  const hasConsole = user.workspaces.length > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-full py-1 pl-1 pr-1 transition-colors hover:bg-ink-100 sm:pr-3" aria-label="Account menu">
        <Avatar name={user.fullName} src={user.avatarUrl} size={30} />
        <span className="hidden max-w-28 truncate text-sm font-medium text-ink-800 sm:block">{user.fullName.split(' ')[0]}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuLabel>
          <span className="block truncate text-ink-900">{user.fullName}</span>
          <span className="block truncate font-normal">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account">
            <UserRound /> My account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/saved">
            <Heart /> Saved properties
          </Link>
        </DropdownMenuItem>
        {hasConsole ? (
          <DropdownMenuItem asChild>
            <a href={consoleUrl('/')}>
              <LayoutDashboard /> Open console
            </a>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          tone="danger"
          onSelect={async () => {
            await signOut();
            router.refresh();
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SiteHeader({ brandName, logoUrl, nav }: { brandName: string; logoUrl: string | null; nav: NavLink[] }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => setOpen(false), [pathname]);
  const isActive = (href: string) => pathname === href.split('?')[0] || (href !== '/' && pathname.startsWith(href.split('?')[0]));

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
      <div className="container-page flex h-16 items-center gap-6">
        <Link href="/" className="shrink-0" aria-label={`${brandName} home`}>
          <Logo name={brandName} logoUrl={logoUrl} />
        </Link>
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn('rounded-md px-3 py-2 text-[14.5px] font-medium transition-colors', isActive(n.href) ? 'text-ink-900' : 'text-ink-600 hover:text-ink-900')}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="hidden md:inline-flex">
            <Link href="/sell">List your property</Link>
          </Button>
          <AccountMenu />
          <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
            <DialogPrimitive.Trigger className="rounded-md p-2 text-ink-700 hover:bg-ink-100 lg:hidden" aria-label="Open menu">
              <Menu className="size-5" />
            </DialogPrimitive.Trigger>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink-950/40 data-[state=open]:animate-fade-in" />
              <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[86vw] max-w-sm flex-col bg-surface shadow-overlay data-[state=open]:animate-slide-in-right">
                <DialogPrimitive.Title className="sr-only">Menu</DialogPrimitive.Title>
                <DialogPrimitive.Description className="sr-only">Site navigation</DialogPrimitive.Description>
                <div className="flex h-16 items-center justify-between border-b border-line px-5">
                  <Logo name={brandName} logoUrl={logoUrl} />
                  <DialogPrimitive.Close className="rounded-md p-2 text-ink-500 hover:bg-ink-100" aria-label="Close menu">
                    <X className="size-5" />
                  </DialogPrimitive.Close>
                </div>
                <nav className="flex flex-col p-3" aria-label="Mobile">
                  {nav.map((n) => (
                    <Link key={n.href} href={n.href} className="rounded-md px-3 py-3 text-[15px] font-medium text-ink-800 hover:bg-ink-50">
                      {n.label}
                    </Link>
                  ))}
                  <Link href="/sell" className="rounded-md px-3 py-3 text-[15px] font-medium text-ink-800 hover:bg-ink-50">
                    List your property
                  </Link>
                </nav>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
        </div>
      </div>
    </header>
  );
}
