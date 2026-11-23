'use client';

import * as React from 'react';
import Link from 'next/link';
import { Inbox, MoreHorizontal } from 'lucide-react';
import { ENQUIRY_TYPES, enumLabel, formatDate, formatDateTime, PREFERRED_TIME_SLOTS, type Paginated } from '@estate/shared';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogFooter,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  PageHeader,
  Pagination,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
} from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation, useListParams } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { FilterSelect, SearchBox, StatusTabs, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';

interface EnquiryRow {
  id: string;
  referenceNo: string;
  type: string;
  status: string;
  name: string;
  phone: string;
  email: string | null;
  message: string | null;
  preferredDate: string | null;
  preferredTimeSlot: keyof typeof PREFERRED_TIME_SLOTS | null;
  sourceKey: string;
  sourcePage: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  spamReason: string | null;
  isDemo: boolean;
  createdAt: string;
  organization: { id: string; name: string };
  property: { id: string; title: string; referenceCode: string } | null;
  project: { id: string; name: string } | null;
  unit: { code: string } | null;
  lead: { id: string; leadNo: string; status: string; assignedTo: { fullName: string } | null } | null;
}

export default function EnquiriesPage() {
  const { can, workspace, activeOrgId } = useSession();
  const partnerOrg = ['broker', 'developer', 'owner'].includes(workspace) ? activeOrgId : null;
  const { values, set, page, setPage } = useListParams<{ status?: string; type?: string; q?: string }>();
  const query = useApi<Paginated<EnquiryRow> & { statusCounts: Record<string, number> }>('/crm/enquiries', { ...values, ...(partnerOrg ? { organizationId: partnerOrg } : {}), page, pageSize: 25 });
  const [action, setAction] = React.useState<{ row: EnquiryRow; status: 'SPAM' | 'CLOSED' | 'PROCESSED' } | null>(null);
  const [note, setNote] = React.useState('');
  const mutate = useApiMutation(() => api.patch(`/crm/enquiries/${action!.row.id}/status`, { status: action!.status, note: note || undefined }), {
    success: 'Enquiry updated',
    invalidate: ['/crm/enquiries', '/crm/leads'],
    onSuccess: () => {
      setAction(null);
      setNote('');
    },
  });

  return (
    <>
      <PageHeader title="Enquiries" description="Raw enquiries from the website, project microsites and WhatsApp, each linked to the lead it created or joined." />
      <Card>
        <StatusTabs
          tabs={[
            { value: undefined, label: 'All' },
            { value: 'NEW', label: 'New' },
            { value: 'PROCESSED', label: 'Processed' },
            { value: 'CLOSED', label: 'Closed' },
            { value: 'SPAM', label: 'Spam' },
          ]}
          value={values.status}
          onChange={(v) => set({ status: v })}
          counts={query.data?.statusCounts}
        />
        <Toolbar>
          <SearchBox value={values.q} onChange={(q) => set({ q })} placeholder="Reference, name, phone or email" />
          <FilterSelect value={values.type} onChange={(v) => set({ type: v })} placeholder="Any type" options={ENQUIRY_TYPES.map((t) => ({ value: t, label: enumLabel(t) }))} />
        </Toolbar>
        <QueryState query={query} isEmpty={(d) => d.data.length === 0} empty={{ icon: <Inbox />, title: 'No enquiries found', description: 'Enquiries submitted on listing and project pages appear here instantly.' }}>
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    <TH>Enquiry</TH>
                    <TH>Customer</TH>
                    <TH className="hidden lg:table-cell">Regarding</TH>
                    <TH className="hidden md:table-cell">Lead</TH>
                    <TH>Status</TH>
                    <TH className="hidden sm:table-cell">Received</TH>
                    <TH align="right">
                      <span className="sr-only">Actions</span>
                    </TH>
                  </tr>
                </THead>
                <TBody>
                  {d.data.map((e) => (
                    <TR key={e.id}>
                      <TD>
                        <div className="font-medium text-ink-900">{enumLabel(e.type)}</div>
                        <div className="tabular whitespace-nowrap text-xs text-ink-500">
                          {e.referenceNo}
                          {e.isDemo ? <Badge tone="outline" size="sm" className="ml-1.5">Demo</Badge> : null}
                        </div>
                      </TD>
                      <TD>
                        <div className="text-ink-900">{e.name}</div>
                        <div className="tabular text-xs text-ink-500">{e.phone}</div>
                      </TD>
                      <TD className="hidden max-w-72 lg:table-cell">
                        <div className="truncate text-ink-800">{e.property ? e.property.title : e.project ? `${e.project.name}${e.unit ? ` · ${e.unit.code}` : ''}` : 'General'}</div>
                        <div className="truncate text-xs text-ink-500">
                          {e.preferredDate ? `Visit ${formatDate(e.preferredDate)}${e.preferredTimeSlot ? ` (${PREFERRED_TIME_SLOTS[e.preferredTimeSlot]})` : ''} · ` : ''}
                          {e.message ?? (e.utmCampaign ? `Campaign ${e.utmCampaign}` : e.sourcePage ?? '')}
                        </div>
                      </TD>
                      <TD className="hidden md:table-cell">
                        {e.lead ? (
                          <Link href={`/crm/leads/${e.lead.id}`} className="text-brand hover:underline">
                            {e.lead.leadNo}
                          </Link>
                        ) : (
                          '—'
                        )}
                        <div className="text-xs text-ink-500">{e.lead?.assignedTo?.fullName ?? (e.lead ? 'Unassigned' : '')}</div>
                      </TD>
                      <TD>
                        <StatusBadge status={e.status} />
                      </TD>
                      <TD className="hidden whitespace-nowrap text-xs text-ink-500 sm:table-cell">{formatDateTime(e.createdAt)}</TD>
                      <TD align="right">
                        {can('enquiry.manage', e.organization.id) ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${e.referenceNo}`}>
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              {e.status !== 'CLOSED' ? <DropdownMenuItem onSelect={() => setAction({ row: e, status: 'CLOSED' })}>Mark closed</DropdownMenuItem> : null}
                              {e.status !== 'PROCESSED' ? <DropdownMenuItem onSelect={() => setAction({ row: e, status: 'PROCESSED' })}>Mark processed</DropdownMenuItem> : null}
                              {e.status !== 'SPAM' ? (
                                <DropdownMenuItem tone="danger" onSelect={() => setAction({ row: e, status: 'SPAM' })}>
                                  Mark as spam
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <div className="border-t border-line px-4 py-3">
                <Pagination page={page} totalPages={d.meta.totalPages} total={d.meta.total} pageSize={d.meta.pageSize} onPageChange={setPage} />
              </div>
            </>
          )}
        </QueryState>
      </Card>
      <Dialog open={Boolean(action)} onOpenChange={(o) => !o && setAction(null)}>
        {action ? (
          <DialogContent
            title={action.status === 'SPAM' ? 'Mark enquiry as spam' : `Mark enquiry ${action.status.toLowerCase()}`}
            description={action.status === 'SPAM' ? 'If this enquiry is the only one on its lead and nobody has worked the lead yet, the lead is closed as lost.' : action.row.referenceNo}
          >
            <Field label="Note" htmlFor="enq-note">
              <Textarea id="enq-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAction(null)}>
                Cancel
              </Button>
              <Button variant={action.status === 'SPAM' ? 'destructive' : 'primary'} loading={mutate.isPending} onClick={() => mutate.mutate(undefined)}>
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
