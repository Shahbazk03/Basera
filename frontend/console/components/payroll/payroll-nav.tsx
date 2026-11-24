'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@estate/ui';
import { useSession } from '@/lib/session';

const LINKS = [
  { href: '/payroll', label: 'Payroll runs', exact: true },
  { href: '/payroll/structures', label: 'Salary structures' },
  { href: '/payroll/components', label: 'Salary components' },
  { href: '/payroll/adjustments', label: 'Adjustments' },
];

/** Secondary navigation shared by the payroll pages. */
export function PayrollNav() {
  const pathname = usePathname();
  const { can } = useSession();
  if (!can('payroll.view') && !can('payroll.manage')) return null;
  return (
    <nav aria-label="Payroll" className="scrollbar-none -mt-2 mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {LINKS.map((l) => {
        const active = l.exact ? pathname === l.href || (pathname.startsWith('/payroll/') && !LINKS.slice(1).some((x) => pathname.startsWith(x.href)) && !pathname.startsWith('/payroll/payslips')) : pathname.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} aria-current={active ? 'page' : undefined} className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[13.5px] font-medium transition-colors', active ? 'border-brand text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-900')}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
