'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, LayoutDashboard, Plus, RefreshCw } from 'lucide-react';
import { formatDateTime, formatPriceCompact, formatRelative, type DashboardMetric, type DashboardResponse } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Button, Card, CardBody, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, Stat, StatusBadge } from '@estate/ui';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { WORKSPACE_LABELS } from '@/lib/nav';
import { BarList } from '@/components/reports/charts';

function formatMetric(m: DashboardMetric): string {
  return m.format === 'currency' ? formatPriceCompact(m.value) : m.value.toLocaleString('en-IN');
}

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/**
 * Workspace home. Every figure comes from GET /reports/dashboard, which computes it from live
 * records the user is allowed to see; sections the user has no access to are simply absent.
 */
export function DashboardHome() {
  const { user, workspace, can, activeOrg, activeOrgId } = useSession();
  const orgScoped = workspace !== 'admin' && workspace !== 'staff';
  const q = useApi<DashboardResponse>('/reports/dashboard', { workspace, organizationId: orgScoped ? (activeOrgId ?? undefined) : undefined }, { refetchInterval: 120_000 });
  const subtitle = activeOrg && activeOrg.organizationType !== 'PLATFORM' ? `${activeOrg.organizationName} · ${WORKSPACE_LABELS[workspace]}` : WORKSPACE_LABELS[workspace];
  const d = q.data;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${user.fullName.split(' ')[0]}`}
        description={
          <span>
            {subtitle}
            {d ? <span className="text-ink-400"> · updated {formatRelative(d.generatedAt)}</span> : null}
          </span>
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void q.refetch()} loading={q.isFetching && !q.isLoading} aria-label="Refresh dashboard">
              <RefreshCw /> Refresh
            </Button>
            {can('property.create') && workspace !== 'staff' && workspace !== 'lead-provider' ? (
              <Button asChild size="sm">
                <Link href="/listings/new">
                  <Plus /> New listing
                </Link>
              </Button>
            ) : null}
            {workspace === 'lead-provider' ? (
              <Button asChild size="sm">
                <Link href="/provider/submit">
                  <Plus /> Submit a lead
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {q.isLoading ? (
        <div className="space-y-6">
          {[0, 1].map((s) => (
            <div key={s}>
              <Skeleton className="mb-3 h-4 w-40" />
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-[104px]" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : q.isError ? (
        <Card>
          <ErrorState description={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        </Card>
      ) : d && d.sections.length === 0 && d.lists.length === 0 ? (
        <Card>
          <EmptyState icon={<LayoutDashboard />} title="Nothing to show yet" description="Your dashboard fills in as listings, enquiries and leads are added to your workspace." />
        </Card>
      ) : d ? (
        <div className="space-y-8">
          {d.sections.map((s) => (
            <section key={s.key} aria-labelledby={`sec-${s.key}`}>
              <h2 id={`sec-${s.key}`} className="mb-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-500">
                {s.title}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {s.metrics.map((m) => (
                  <Stat key={m.key} label={m.label} value={formatMetric(m)} hint={m.hint} href={m.href} tone={m.tone} />
                ))}
              </div>
            </section>
          ))}

          {d.breakdowns.length || d.lists.length ? (
            <div className="grid gap-5 lg:grid-cols-2">
              {d.breakdowns.map((b) => (
                <Card key={b.key}>
                  <CardHeader
                    title={b.title}
                    actions={
                      b.href ? (
                        <Link href={b.href} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
                          View <ArrowRight className="size-3.5" />
                        </Link>
                      ) : null
                    }
                  />
                  <CardBody>
                    <BarList items={b.items} ariaLabel={b.title} emptyText="No open items." />
                  </CardBody>
                </Card>
              ))}
              {d.lists.map((l) => (
                <Card key={l.key}>
                  <CardHeader
                    title={l.title}
                    actions={
                      l.href ? (
                        <Link href={l.href} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
                          View all <ArrowRight className="size-3.5" />
                        </Link>
                      ) : null
                    }
                  />
                  {l.items.length ? (
                    <ul className="divide-y divide-line">
                      {l.items.map((it) => {
                        const body = (
                          <div className="flex items-start justify-between gap-3 px-5 py-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-ink-900">{it.title}</p>
                              {it.subtitle ? <p className="truncate text-xs text-ink-500">{it.subtitle}</p> : null}
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              {it.status ? <StatusBadge status={it.status} size="sm" /> : null}
                              {it.meta ? <span className="whitespace-nowrap text-[11.5px] text-ink-500">{/^\d{4}-\d{2}-\d{2}T/.test(it.meta) ? formatDateTime(it.meta) : it.meta}</span> : null}
                            </div>
                          </div>
                        );
                        return (
                          <li key={it.id} className="transition-colors hover:bg-ink-50/70">
                            {it.href ? <Link href={it.href}>{body}</Link> : body}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="px-5 py-8 text-center text-sm text-ink-500">{l.emptyText}</p>
                  )}
                </Card>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
