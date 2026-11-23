'use client';

import * as React from 'react';
import Link from 'next/link';
import { Bell, CheckCheck } from 'lucide-react';
import { formatRelative, type Paginated } from '@estate/shared';
import { Button, Card, cn, PageHeader, Pagination } from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation, useListParams } from '@/lib/hooks';
import { StatusTabs } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';

interface NotificationRow {
  id: string;
  eventKey: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export default function NotificationsPage() {
  const { values, set, page, setPage } = useListParams<{ unread?: string }>();
  const query = useApi<Paginated<NotificationRow> & { unread: number }>('/notifications', { unread: values.unread, page, pageSize: 25 });
  const readAll = useApiMutation(() => api.post('/notifications/read-all'), { success: 'All notifications marked as read', invalidate: ['/notifications'] });
  const markRead = useApiMutation((id: string) => api.post(`/notifications/${id}/read`), { invalidate: ['/notifications'], silent: true });

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Assignments, approvals and reminders that need your attention."
        actions={
          <Button variant="outline" size="sm" disabled={!query.data?.unread} loading={readAll.isPending} onClick={() => readAll.mutate(undefined)}>
            <CheckCheck /> Mark all as read
          </Button>
        }
      />
      <Card>
        <StatusTabs
          tabs={[
            { value: undefined, label: 'All' },
            { value: 'true', label: `Unread${query.data ? ` (${query.data.unread})` : ''}` },
          ]}
          value={values.unread}
          onChange={(v) => set({ unread: v })}
        />
        <QueryState query={query} isEmpty={(d) => d.data.length === 0} empty={{ icon: <Bell />, title: 'You are all caught up', description: 'New assignments, approvals and reminders will appear here.' }}>
          {(d) => (
            <>
              <ul className="divide-y divide-line">
                {d.data.map((n) => {
                  const content = (
                    <div className="flex items-start gap-3 px-5 py-4">
                      <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand')} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className={cn('text-sm', n.readAt ? 'text-ink-700' : 'font-semibold text-ink-900')}>{n.title}</p>
                        <p className="mt-0.5 text-sm text-ink-500">{n.body}</p>
                        <p className="mt-1 text-xs text-ink-400">{formatRelative(n.createdAt)}</p>
                      </div>
                    </div>
                  );
                  const href = n.link && n.link.startsWith('/') ? n.link : null;
                  return (
                    <li key={n.id} className="transition-colors hover:bg-ink-50/70">
                      {href ? (
                        <Link href={href} onClick={() => !n.readAt && markRead.mutate(n.id)}>
                          {content}
                        </Link>
                      ) : (
                        <button type="button" className="w-full text-left" onClick={() => !n.readAt && markRead.mutate(n.id)}>
                          {content}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="border-t border-line px-4 py-3">
                <Pagination page={page} totalPages={d.meta.totalPages} total={d.meta.total} pageSize={d.meta.pageSize} onPageChange={setPage} />
              </div>
            </>
          )}
        </QueryState>
      </Card>
    </>
  );
}
