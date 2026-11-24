'use client';

import * as React from 'react';
import { ChevronDown, ChevronRight, ScrollText } from 'lucide-react';
import { formatDateTime, type Paginated } from '@estate/shared';
import { Badge, Button, Card, Input, PageHeader, Pagination } from '@estate/ui';
import { useApi, useListParams } from '@/lib/hooks';
import { SearchBox, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  organizationId: string | null;
  actorIp: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  createdAt: string;
  actor: { id: string; fullName: string; email: string | null } | null;
}

export default function AuditPage() {
  const { values, set, page, setPage } = useListParams<{ action?: string; entityType?: string; entityId?: string; actorId?: string }>();
  const q = useApi<Paginated<AuditRow>>('/admin/audit-logs', { ...values, page, pageSize: 50 });
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const filtered = Boolean(values.action || values.entityType || values.entityId || values.actorId);
  return (
    <>
      <PageHeader title="Audit log" description="Who changed what and when. Entries are written by every workflow and cannot be edited; secrets such as passwords and tokens are redacted." />
      <Card>
        <Toolbar>
          <SearchBox value={values.action} onChange={(v) => set({ action: v })} placeholder="Action starts with… (e.g. finance., auth.login)" />
          <CommitInput label="Entity type" className="w-44" placeholder="Entity type (e.g. Lead)" value={values.entityType} onCommit={(v) => set({ entityType: v })} />
          <CommitInput label="Entity id" className="w-72 font-mono text-xs" placeholder="Entity id" value={values.entityId} onCommit={(v) => set({ entityId: v })} />
          {filtered ? (
            <Button variant="ghost" size="sm" onClick={() => set({ action: undefined, entityType: undefined, entityId: undefined, actorId: undefined })}>
              Clear filters
            </Button>
          ) : null}
        </Toolbar>
        <QueryState query={q} isEmpty={(d) => d.data.length === 0} empty={{ icon: <ScrollText />, title: 'No entries', description: filtered ? 'Nothing matches these filters.' : 'Audit entries appear as people use the system.' }}>
          {(d) => (
            <>
              <ul className="divide-y divide-line">
                {d.data.map((r) => {
                  const isOpen = open.has(r.id);
                  const hasDetail = r.before != null || r.after != null || r.metadata != null;
                  return (
                    <li key={r.id} className="px-4 py-2.5">
                      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                        <button type="button" disabled={!hasDetail} onClick={() => toggle(r.id)} className="mt-0.5 text-ink-400 disabled:opacity-30" aria-expanded={isOpen} aria-label={isOpen ? 'Hide details' : 'Show details'}>
                          {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <button type="button" className="font-mono text-[13px] font-medium text-ink-900 hover:underline" onClick={() => set({ action: r.action })}>
                              {r.action}
                            </button>
                            <button type="button" onClick={() => set({ entityType: r.entityType, entityId: r.entityId ?? undefined })} className="hover:underline">
                              <Badge size="sm">
                                {r.entityType}
                                {r.entityId ? ` · ${r.entityId.slice(0, 8)}` : ''}
                              </Badge>
                            </button>
                          </div>
                          <div className="text-xs text-ink-500">
                            {r.actor ? (
                              <button type="button" className="hover:underline" onClick={() => set({ actorId: r.actor!.id })}>
                                {r.actor.fullName}
                              </button>
                            ) : (
                              'System'
                            )}
                            {r.actorIp ? ` · ${r.actorIp}` : ''}
                          </div>
                        </div>
                        <time className="text-xs whitespace-nowrap text-ink-500" dateTime={r.createdAt}>
                          {formatDateTime(r.createdAt)}
                        </time>
                      </div>
                      {isOpen ? (
                        <div className="mt-2 ml-7 grid gap-2 md:grid-cols-3">
                          {(['before', 'after', 'metadata'] as const).map((k) =>
                            r[k] != null ? (
                              <div key={k} className="min-w-0">
                                <p className="mb-1 text-[11px] font-semibold tracking-wide text-ink-500 uppercase">{k}</p>
                                <pre className="max-h-64 overflow-auto rounded-md bg-ink-50 p-2 text-[11.5px] leading-relaxed text-ink-800">{JSON.stringify(r[k], null, 2)}</pre>
                              </div>
                            ) : null,
                          )}
                        </div>
                      ) : null}
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

/** Applies the filter on Enter or blur rather than on every keystroke. */
function CommitInput({ label, value, onCommit, className, placeholder }: { label: string; value?: string; onCommit: (v: string | undefined) => void; className?: string; placeholder?: string }) {
  const [v, setV] = React.useState(value ?? '');
  React.useEffect(() => setV(value ?? ''), [value]);
  const commit = () => {
    const next = v.trim() || undefined;
    if (next !== value) onCommit(next);
  };
  return <Input aria-label={label} className={className} placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}
