'use client';

import * as React from 'react';
import Link from 'next/link';
import { CalendarClock, Phone } from 'lucide-react';
import { enumLabel, formatDateTime, formatRelative, type Paginated } from '@estate/shared';
import { Button, Card, cn, PageHeader, Pagination, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@estate/ui';
import { useApi, useListParams } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { FilterSelect, StatusTabs, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';
import { CompleteFollowUpDialog } from '@/components/crm/dialogs';
import { useAssignees } from '@/components/crm/pickers';

interface FollowUpRow {
  id: string;
  type: string;
  dueAt: string;
  status: string;
  notes: string | null;
  outcome: string | null;
  completedAt: string | null;
  assignedTo: { id: string; fullName: string };
  lead: { id: string; leadNo: string; name: string; phone: string; status: string; priority: string; project: { name: string } | null; property: { title: string } | null };
}

export default function FollowUpsPage() {
  const { can, workspace, activeOrgId } = useSession();
  const canSeeTeam = can('lead.view_all');
  const partnerOrg = ['broker', 'developer', 'owner'].includes(workspace) ? activeOrgId : null;
  const { values, set, page, setPage } = useListParams<{ view?: string; assignee?: string }>({ view: 'today' });
  const view = values.view ?? 'today';
  const assignee = canSeeTeam ? values.assignee : 'me';
  const query = useApi<Paginated<FollowUpRow> & { counts: { overdue: number; today: number; upcoming: number } }>('/crm/follow-ups', { view, assignee, page, pageSize: 25 });
  const assignees = useAssignees(partnerOrg, canSeeTeam);
  const [closing, setClosing] = React.useState<{ id: string; type: string } | null>(null);
  const c = query.data?.counts;

  return (
    <>
      <PageHeader title="Follow-ups" description="Calls and meetings promised to customers. Assignees are reminded before each one is due; missed follow-ups are flagged after 24 hours." />
      <Card>
        <StatusTabs
          tabs={[
            { value: 'overdue', label: `Overdue${c ? ` (${c.overdue})` : ''}` },
            { value: 'today', label: `Today${c ? ` (${c.today})` : ''}` },
            { value: 'upcoming', label: `Upcoming${c ? ` (${c.upcoming})` : ''}` },
            { value: 'done', label: 'Closed' },
          ]}
          value={view}
          onChange={(v) => set({ view: v })}
        />
        {canSeeTeam ? (
          <Toolbar>
            <FilterSelect value={values.assignee} onChange={(v) => set({ assignee: v })} placeholder="Whole team" label="Assignee" options={[{ value: 'me', label: 'Mine' }, ...(assignees.data ?? []).map((u) => ({ value: u.id, label: u.fullName }))]} />
          </Toolbar>
        ) : null}
        <QueryState
          query={query}
          isEmpty={(d) => d.data.length === 0}
          empty={{ icon: <CalendarClock />, title: view === 'overdue' ? 'Nothing overdue' : view === 'today' ? 'No follow-ups due today' : view === 'upcoming' ? 'No upcoming follow-ups' : 'No closed follow-ups yet', description: 'Schedule follow-ups from a lead’s page.' }}
        >
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    <TH>Due</TH>
                    <TH>Lead</TH>
                    <TH className="hidden md:table-cell">Type</TH>
                    <TH className="hidden lg:table-cell">Notes</TH>
                    <TH className="hidden sm:table-cell">Assignee</TH>
                    <TH align="right">Action</TH>
                  </tr>
                </THead>
                <TBody>
                  {d.data.map((f) => {
                    const overdue = ['PENDING', 'MISSED'].includes(f.status) && new Date(f.dueAt).getTime() < Date.now();
                    return (
                      <TR key={f.id}>
                        <TD className="whitespace-nowrap">
                          <div className={cn('font-medium', overdue ? 'text-danger' : 'text-ink-900')}>{formatDateTime(f.dueAt)}</div>
                          <div className="text-xs text-ink-500">{view === 'done' && f.completedAt ? `closed ${formatRelative(f.completedAt)}` : formatRelative(f.dueAt)}</div>
                        </TD>
                        <TD>
                          <Link href={`/crm/leads/${f.lead.id}`} className="font-medium text-ink-900 hover:underline">
                            {f.lead.name}
                          </Link>
                          <div className="flex items-center gap-1.5 text-xs text-ink-500">
                            <span className="tabular">{f.lead.leadNo}</span>
                            <StatusBadge status={f.lead.status} size="sm" />
                          </div>
                        </TD>
                        <TD className="hidden md:table-cell">{enumLabel(f.type)}</TD>
                        <TD className="hidden max-w-72 truncate text-xs text-ink-600 lg:table-cell">{f.outcome ?? f.notes ?? (f.lead.project?.name ?? f.lead.property?.title ?? '—')}</TD>
                        <TD className="hidden sm:table-cell">{f.assignedTo.fullName}</TD>
                        <TD align="right">
                          {['PENDING', 'MISSED'].includes(f.status) ? (
                            <div className="flex justify-end gap-1.5">
                              <Button asChild size="xs" variant="ghost">
                                <a href={`tel:${f.lead.phone}`} aria-label={`Call ${f.lead.name}`}>
                                  <Phone />
                                </a>
                              </Button>
                              <Button size="xs" variant="outline" onClick={() => setClosing({ id: f.id, type: f.type })}>
                                Close
                              </Button>
                            </div>
                          ) : (
                            <StatusBadge status={f.status} size="sm" />
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
              <div className="border-t border-line px-4 py-3">
                <Pagination page={page} totalPages={d.meta.totalPages} total={d.meta.total} pageSize={d.meta.pageSize} onPageChange={setPage} />
              </div>
            </>
          )}
        </QueryState>
      </Card>
      <CompleteFollowUpDialog followUp={closing} onOpenChange={(o) => !o && setClosing(null)} onDone={() => void query.refetch()} />
    </>
  );
}
