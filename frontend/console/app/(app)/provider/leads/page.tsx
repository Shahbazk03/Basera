'use client';

import * as React from 'react';
import Link from 'next/link';
import { ListChecks, Send } from 'lucide-react';
import { LEAD_INTAKE_STATUSES, enumLabel, formatDateTime, type Paginated } from '@estate/shared';
import { Badge, Button, Card, PageHeader, Pagination, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@estate/ui';
import { useApi, useListParams } from '@/lib/hooks';
import { FilterSelect, SearchBox, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';

interface MyLead {
  id: string;
  leadNo: string;
  name: string;
  phone: string;
  createdAt: string;
  intakeStatus: string;
  intakeNote: string | null;
  progress: string;
  converted: boolean;
  interest: string | null;
}

export default function ProviderLeadsPage() {
  const { values, set, page, setPage } = useListParams<{ intake?: string; q?: string }>();
  const query = useApi<Paginated<MyLead>>('/provider/leads', { ...values, page, pageSize: 25 });
  return (
    <>
      <PageHeader
        title="My leads"
        description="Every lead you have submitted, its intake result and how far it has progressed."
        actions={
          <Button asChild size="sm">
            <Link href="/provider/submit">
              <Send /> Submit a lead
            </Link>
          </Button>
        }
      />
      <Card>
        <Toolbar>
          <SearchBox value={values.q} onChange={(q) => set({ q })} placeholder="Name, phone or lead no." />
          <FilterSelect value={values.intake} onChange={(v) => set({ intake: v })} placeholder="Any intake result" options={LEAD_INTAKE_STATUSES.map((s) => ({ value: s, label: enumLabel(s) }))} />
        </Toolbar>
        <QueryState query={query} isEmpty={(d) => d.data.length === 0} empty={{ icon: <ListChecks />, title: 'No leads yet', description: 'Leads you submit appear here with their status.', action: <Button asChild size="sm"><Link href="/provider/submit">Submit a lead</Link></Button> }}>
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    <TH>Lead</TH>
                    <TH className="hidden md:table-cell">Interested in</TH>
                    <TH>Intake</TH>
                    <TH>Progress</TH>
                    <TH className="hidden sm:table-cell">Submitted</TH>
                  </tr>
                </THead>
                <TBody>
                  {d.data.map((l) => (
                    <TR key={l.id}>
                      <TD>
                        <div className="font-medium text-ink-900">{l.name}</div>
                        <div className="tabular text-xs text-ink-500">
                          {l.leadNo} · {l.phone}
                        </div>
                      </TD>
                      <TD className="hidden max-w-60 truncate md:table-cell">{l.interest ?? '—'}</TD>
                      <TD>
                        <StatusBadge status={l.intakeStatus} />
                        {l.intakeStatus === 'REJECTED' && l.intakeNote ? <div className="mt-1 max-w-56 text-xs text-ink-500">{l.intakeNote}</div> : null}
                      </TD>
                      <TD>{l.converted ? <Badge tone="success">Converted</Badge> : <span className="text-sm text-ink-700">{l.progress}</span>}</TD>
                      <TD className="hidden whitespace-nowrap text-xs text-ink-500 sm:table-cell">{formatDateTime(l.createdAt)}</TD>
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
    </>
  );
}
