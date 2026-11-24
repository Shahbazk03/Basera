'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Target, Upload, UserPlus } from 'lucide-react';
import { formatPriceRange, formatRelative, LEAD_IMPORT_COLUMNS, LEAD_PRIORITIES, enumLabel, type Paginated } from '@estate/shared';
import { Badge, Button, Card, Checkbox, cn, PageHeader, Pagination, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@estate/ui';
import { useApi, useListParams } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { FilterSelect, SearchBox, StatusTabs, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';
import { AssignDialog, CreateLeadDialog, CsvImportDialog } from '@/components/crm/dialogs';
import { useAssignees, useLeadSources } from '@/components/crm/pickers';
import type { LeadRow } from '@/components/crm/types';
import { DownloadButton } from '@/components/download-button';

const TABS = [
  { value: undefined, label: 'All open' },
  { value: 'NEW', label: 'New' },
  { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'CONTACTED', label: 'Contacted' },
  { value: 'INTERESTED', label: 'Interested' },
  { value: 'FOLLOW_UP', label: 'Follow-up' },
  { value: 'SITE_VISIT_SCHEDULED', label: 'Visit scheduled' },
  { value: 'SITE_VISIT_COMPLETED', label: 'Visited' },
  { value: 'NEGOTIATION', label: 'Negotiation' },
  { value: 'BOOKING_PENDING', label: 'Booking pending' },
  { value: 'NOT_REACHABLE', label: 'Not reachable' },
  { value: 'CONVERTED', label: 'Converted' },
  { value: 'LOST', label: 'Lost' },
];

function interest(l: LeadRow): string {
  if (l.property) return l.property.title;
  if (l.project) return l.unit ? `${l.project.name} · ${l.unit.code}` : l.project.name;
  return 'General requirement';
}

export default function LeadsPage() {
  const router = useRouter();
  const { can, workspace, activeOrgId } = useSession();
  const partnerOrg = ['broker', 'developer', 'owner'].includes(workspace) ? activeOrgId : null;
  const { values, set, page, setPage } = useListParams<{ status?: string; q?: string; priority?: string; assignee?: string; source?: string; followUp?: string; intake?: string; sort?: string }>();
  const query = useApi<Paginated<LeadRow> & { statusCounts: Record<string, number> }>('/crm/leads', { ...values, ...(partnerOrg ? { organizationId: partnerOrg } : {}), page, pageSize: 25 });
  const sources = useLeadSources();
  const canAssign = can('lead.assign');
  const assignees = useAssignees(partnerOrg, canAssign);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = React.useState(false);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  React.useEffect(() => setSelected(new Set()), [values.status, values.q, page]);

  const rows = query.data?.data ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const exportHref = `/api/v1/crm/leads/export?${new URLSearchParams(Object.entries({ ...values, ...(partnerOrg ? { organizationId: partnerOrg } : {}) }).filter(([, v]) => v) as [string, string][]).toString()}`;
  const counts = query.data?.statusCounts;
  const openCounts = counts ? Object.fromEntries(Object.entries(counts)) : undefined;

  return (
    <>
      <PageHeader
        title="Leads"
        description="Every enquiry and lead in your scope, with its owner, stage and next follow-up."
        actions={
          <>
            {can('lead.import') ? (
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Upload /> Import
              </Button>
            ) : null}
            {can('lead.export') ? (
              <DownloadButton size="sm" href={exportHref} fileName="leads.csv">
                Export
              </DownloadButton>
            ) : null}
            {can('lead.create') ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus /> Add lead
              </Button>
            ) : null}
          </>
        }
      />
      <Card>
        <StatusTabs tabs={TABS} value={values.status} onChange={(v) => set({ status: v })} counts={openCounts} />
        <Toolbar>
          <SearchBox value={values.q} onChange={(q) => set({ q })} placeholder="Name, phone, email or lead no." />
          <FilterSelect value={values.priority} onChange={(v) => set({ priority: v })} placeholder="Any priority" options={LEAD_PRIORITIES.map((p) => ({ value: p, label: enumLabel(p) }))} />
          <FilterSelect
            value={values.assignee}
            onChange={(v) => set({ assignee: v })}
            placeholder="Anyone"
            label="Assignee"
            options={[{ value: 'me', label: 'Assigned to me' }, ...(canAssign ? [{ value: 'unassigned', label: 'Unassigned' }, ...(assignees.data ?? []).map((u) => ({ value: u.id, label: u.fullName }))] : [])]}
          />
          <FilterSelect value={values.source} onChange={(v) => set({ source: v })} placeholder="Any source" options={(sources.data ?? []).map((s) => ({ value: s.key, label: s.name }))} />
          <FilterSelect value={values.followUp} onChange={(v) => set({ followUp: v })} placeholder="Any follow-up" options={[{ value: 'today', label: 'Follow-up due today' }, { value: 'overdue', label: 'Follow-up overdue' }]} />
          <FilterSelect
            value={values.sort}
            onChange={(v) => set({ sort: v })}
            placeholder="Newest first"
            label="Sort"
            options={[
              { value: 'oldest', label: 'Oldest first' },
              { value: 'followup', label: 'Next follow-up' },
              { value: 'priority', label: 'Priority' },
              { value: 'updated', label: 'Recently updated' },
            ]}
          />
          {canAssign ? (
            <FilterSelect value={values.intake} onChange={(v) => set({ intake: v })} placeholder="Accepted leads" label="Intake" options={[{ value: 'all', label: 'All intake states' }, { value: 'duplicates', label: 'Duplicates only' }]} />
          ) : null}
        </Toolbar>
        {selected.size > 0 && canAssign ? (
          <div className="flex items-center justify-between gap-3 border-b border-line bg-brand-soft/60 px-4 py-2.5 text-sm">
            <span className="font-medium text-ink-900">{selected.size} selected</span>
            <div className="flex gap-2">
              <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
              <Button size="xs" onClick={() => setAssignOpen(true)}>
                <UserPlus /> Assign selected
              </Button>
            </div>
          </div>
        ) : null}
        <QueryState
          query={query}
          isEmpty={(d) => d.data.length === 0}
          empty={{
            icon: <Target />,
            title: values.q || values.status || values.assignee ? 'No leads match these filters' : 'No leads yet',
            description: values.q || values.status ? 'Try another stage or search term.' : 'Website enquiries, partner submissions and manual entries appear here.',
            action: can('lead.create') ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus /> Add lead
              </Button>
            ) : undefined,
          }}
        >
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    {canAssign ? (
                      <TH className="w-10">
                        <Checkbox
                          aria-label="Select all leads on this page"
                          checked={allSelected}
                          onCheckedChange={(v) => setSelected(v ? new Set(d.data.map((r) => r.id)) : new Set())}
                        />
                      </TH>
                    ) : null}
                    <TH>Lead</TH>
                    <TH className="hidden lg:table-cell">Interested in</TH>
                    <TH className="hidden md:table-cell">Source</TH>
                    <TH>Stage</TH>
                    <TH className="hidden md:table-cell">Owner</TH>
                    <TH className="hidden 2xl:table-cell">Next follow-up</TH>
                    <TH className="hidden sm:table-cell">Created</TH>
                  </tr>
                </THead>
                <TBody>
                  {d.data.map((l) => {
                    const overdue = l.nextFollowUpAt && new Date(l.nextFollowUpAt).getTime() < Date.now() && !['CONVERTED', 'LOST'].includes(l.status);
                    return (
                      <TR key={l.id} onClick={() => router.push(`/crm/leads/${l.id}`)} selected={selected.has(l.id)}>
                        {canAssign ? (
                          <TD onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              aria-label={`Select ${l.name}`}
                              checked={selected.has(l.id)}
                              onCheckedChange={(v) => {
                                const next = new Set(selected);
                                if (v) next.add(l.id);
                                else next.delete(l.id);
                                setSelected(next);
                              }}
                            />
                          </TD>
                        ) : null}
                        <TD>
                          <Link href={`/crm/leads/${l.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-ink-900 hover:underline">
                            {l.name}
                          </Link>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-500 sm:flex-nowrap sm:whitespace-nowrap">
                            <span className="tabular">{l.leadNo}</span>
                            <span>·</span>
                            <span className="tabular">{l.phone}</span>
                            {l.isDemo ? <Badge tone="outline" size="sm">Demo</Badge> : null}
                            {l.isDuplicate ? <Badge tone="warning" size="sm">Duplicate</Badge> : null}
                          </div>
                        </TD>
                        <TD className="hidden max-w-64 lg:table-cell">
                          <div className="truncate text-ink-800">{interest(l)}</div>
                          {l.budgetMin || l.budgetMax ? <div className="text-xs text-ink-500">Budget {formatPriceRange(l.budgetMin, l.budgetMax)}</div> : null}
                        </TD>
                        <TD className="hidden whitespace-nowrap md:table-cell">
                          <div className="text-ink-800">{l.source.name}</div>
                          {l.leadProvider ? <div className="text-xs text-ink-500">{l.leadProvider.name}</div> : null}
                        </TD>
                        <TD>
                          <div className="flex flex-col items-start gap-1">
                            <StatusBadge status={l.status} />
                            {l.priority === 'HOT' || l.priority === 'HIGH' ? <StatusBadge status={l.priority} size="sm" /> : null}
                          </div>
                        </TD>
                        <TD className="hidden whitespace-nowrap md:table-cell">{l.assignedTo ? <span className="text-ink-800">{l.assignedTo.fullName}</span> : <span className="text-warning">Unassigned</span>}</TD>
                        <TD className={cn('hidden whitespace-nowrap text-xs 2xl:table-cell', overdue ? 'font-medium text-danger' : 'text-ink-500')}>{l.nextFollowUpAt ? formatRelative(l.nextFollowUpAt) : '—'}</TD>
                        <TD className="hidden whitespace-nowrap text-xs text-ink-500 sm:table-cell">{formatRelative(l.createdAt)}</TD>
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

      <CreateLeadDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={partnerOrg} />
      <AssignDialog open={assignOpen} onOpenChange={setAssignOpen} leadIds={[...selected]} organizationId={partnerOrg} onDone={() => setSelected(new Set())} />
      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        endpoint="/crm/leads/import"
        extraBody={{ sourceKey: 'MANUAL', autoAssign: true, ...(partnerOrg ? { organizationId: partnerOrg } : {}) }}
        title="Import leads"
        description="Preview first: rows matching an open lead are recorded on that lead instead of creating duplicates."
        columns={LEAD_IMPORT_COLUMNS}
        onDone={() => void query.refetch()}
      />
    </>
  );
}
