import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, CheckCircle2, Info, LoaderCircle, XCircle } from 'lucide-react';
import { enumLabel, initials } from '@estate/shared';
import { cn } from '../lib/cn';

// ───────────── Badge ─────────────

export const badgeVariants = cva('inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium [&_svg]:size-3', {
  variants: {
    tone: {
      neutral: 'bg-ink-100 text-ink-700',
      brand: 'bg-brand-soft text-brand-strong',
      success: 'bg-success-soft text-success',
      warning: 'bg-warning-soft text-warning',
      danger: 'bg-danger-soft text-danger',
      info: 'bg-info-soft text-info',
      dark: 'bg-ink-900 text-white',
      outline: 'border border-line-strong text-ink-700',
      onImage: 'bg-white/92 text-ink-900 shadow-sm backdrop-blur',
    },
    size: { sm: 'px-2 py-0.5 text-[11px]', md: 'px-2.5 py-0.5 text-xs' },
  },
  defaultVariants: { tone: 'neutral', size: 'md' },
});

export function Badge({ className, tone, size, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}

type Tone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

/** Consistent colour for every workflow status across the product. */
const STATUS_TONES: Record<string, Tone> = {
  // generic
  ACTIVE: 'success', INACTIVE: 'neutral', PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', CANCELLED: 'neutral', SUSPENDED: 'danger', DRAFT: 'neutral', ARCHIVED: 'neutral', PUBLISHED: 'success',
  // property
  PENDING_REVIEW: 'warning', SOLD: 'dark', RENTED: 'dark', EXPIRED: 'neutral', VERIFIED: 'success', UNVERIFIED: 'neutral', AVAILABLE: 'success', ON_HOLD: 'warning', UNDER_OFFER: 'info',
  // project
  UPCOMING: 'info', PRE_LAUNCH: 'info', BOOKING_OPEN: 'success', CLOSING_SOON: 'warning', SOLD_OUT: 'dark', CLOSED: 'neutral', COMPLETED: 'brand', NOT_SUBMITTED: 'neutral',
  // units
  NOT_RELEASED: 'neutral', RESERVED: 'warning', BOOKED: 'info', BLOCKED: 'danger',
  // domains
  PENDING_VERIFICATION: 'warning', FAILED: 'danger', DISABLED: 'neutral', MANAGED_EXTERNALLY: 'info', NOT_REQUESTED: 'neutral',
  // CRM
  NEW: 'info', ASSIGNED: 'brand', CONTACTED: 'brand', NOT_REACHABLE: 'warning', INTERESTED: 'success', SITE_VISIT_SCHEDULED: 'info', SITE_VISIT_COMPLETED: 'info', NEGOTIATION: 'warning', BOOKING_PENDING: 'warning', CONVERTED: 'success', LOST: 'neutral', FOLLOW_UP: 'warning',
  HOT: 'danger', HIGH: 'warning', MEDIUM: 'neutral', LOW: 'neutral', ACCEPTED: 'success', DUPLICATE: 'warning',
  REQUESTED: 'warning', SCHEDULED: 'info', CONFIRMED: 'brand', NO_SHOW: 'danger', MISSED: 'danger', PROCESSED: 'success', SPAM: 'danger',
  OPEN: 'info', AGREEMENT_SIGNED: 'brand', CLOSED_WON: 'success',
  // HR / finance
  PRESENT: 'success', ABSENT: 'danger', HALF_DAY: 'warning', ON_LEAVE: 'info', HOLIDAY: 'neutral', WEEKLY_OFF: 'neutral', PROBATION: 'info', ON_NOTICE: 'warning', EXITED: 'neutral',
  CALCULATED: 'info', PAID: 'success', PENDING_APPROVAL: 'warning', PAYABLE: 'info', ISSUED: 'info', PARTIALLY_PAID: 'warning', SUBMITTED: 'warning',
  TODO: 'neutral', IN_PROGRESS: 'info', DONE: 'success', URGENT: 'danger',
  QUEUED: 'info', SENT: 'success', NOT_CONFIGURED: 'warning', SKIPPED: 'neutral',
  RESOLVED: 'success', DISMISSED: 'neutral',
};

export function StatusBadge({ status, label, size, className }: { status: string | null | undefined; label?: string; size?: 'sm' | 'md'; className?: string }) {
  if (!status) return null;
  return (
    <Badge tone={STATUS_TONES[status] ?? 'neutral'} size={size} className={className}>
      {label ?? enumLabel(status)}
    </Badge>
  );
}

// ───────────── Card ─────────────

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border border-line bg-surface shadow-card', className)} {...props} />;
}

export function CardHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4', className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-ink-900">{title}</h3>
        {description ? <p className="mt-0.5 text-[13px] text-ink-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

// ───────────── Feedback ─────────────

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-sm text-ink-500', className)}>
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-ink-100', className)} {...props} />;
}

export function Alert({ tone = 'info', title, children, className, action }: { tone?: 'info' | 'success' | 'warning' | 'danger'; title?: React.ReactNode; children?: React.ReactNode; className?: string; action?: React.ReactNode }) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'warning' ? AlertTriangle : tone === 'danger' ? XCircle : Info;
  const styles = {
    info: 'border-info/20 bg-info-soft text-info',
    success: 'border-success/20 bg-success-soft text-success',
    warning: 'border-warning/25 bg-warning-soft text-warning',
    danger: 'border-danger/20 bg-danger-soft text-danger',
  }[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-lg border px-4 py-3', styles, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        {title ? <p className="font-medium text-ink-900">{title}</p> : null}
        {children ? <div className={cn('text-ink-700', title && 'mt-0.5')}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon ? <div className="mb-4 grid size-12 place-items-center rounded-full bg-ink-100 text-ink-500 [&_svg]:size-5">{icon}</div> : null}
      <p className="text-[15px] font-semibold text-ink-900">{title}</p>
      {description ? <p className="mt-1.5 max-w-sm text-sm text-ink-500">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', description, onRetry }: { title?: string; description?: React.ReactNode; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 grid size-11 place-items-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle className="size-5" />
      </div>
      <p className="font-semibold text-ink-900">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p> : null}
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-4 text-sm font-medium text-brand hover:underline">
          Try again
        </button>
      ) : null}
    </div>
  );
}

// ───────────── Identity ─────────────

export function Avatar({ name, src, size = 32, className }: { name?: string | null; src?: string | null; size?: number; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) };
  if (src) return <img src={src} alt={name ?? ''} style={style} className={cn('shrink-0 rounded-full object-cover', className)} />;
  return (
    <span aria-hidden style={style} className={cn('inline-grid shrink-0 place-items-center rounded-full bg-brand-soft font-semibold text-brand-strong', className)}>
      {initials(name)}
    </span>
  );
}

export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return <div role="separator" className={cn(vertical ? 'h-full w-px' : 'h-px w-full', 'bg-line', className)} />;
}

/** Key/value list used on detail pages. */
export function DescriptionList({ items, columns = 2, className }: { items: { label: React.ReactNode; value: React.ReactNode }[]; columns?: 1 | 2 | 3; className?: string }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-4', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-2 lg:grid-cols-3', className)}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[12.5px] text-ink-500">{it.label}</dt>
          <dd className="mt-0.5 break-words text-sm font-medium text-ink-900">{it.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Metric tile — always fed from real data; shows "—" rather than inventing a value. */
export function Stat({ label, value, hint, icon, href, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode; href?: string; tone?: 'default' | 'warning' | 'danger' | 'success' }) {
  const body = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-ink-500">{label}</p>
        <p className={cn('tabular mt-1.5 font-display text-[26px] font-semibold leading-none text-ink-900', tone === 'warning' && 'text-warning', tone === 'danger' && 'text-danger', tone === 'success' && 'text-success')}>{value ?? '—'}</p>
        {hint ? <p className="mt-2 text-xs text-ink-500">{hint}</p> : null}
      </div>
      {icon ? <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-ink-50 text-ink-500 [&_svg]:size-[18px]">{icon}</div> : null}
    </div>
  );
  const cls = 'block rounded-xl border border-line bg-surface p-4 shadow-card';
  return href ? (
    <a href={href} className={cn(cls, 'transition-colors hover:border-ink-300')}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function PageHeader({ title, description, actions, breadcrumbs, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; breadcrumbs?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between', className)}>
      <div className="min-w-0 flex-1">
        {breadcrumbs ? <div className="mb-2">{breadcrumbs}</div> : null}
        <h1 className="text-[22px] font-semibold leading-tight text-ink-900 md:text-2xl">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-ink-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
