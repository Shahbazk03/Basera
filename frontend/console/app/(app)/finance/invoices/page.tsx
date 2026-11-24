'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Receipt } from 'lucide-react';
import { formatDate, formatINR, type Paginated } from '@estate/shared';
import { Badge, Button, Card, Dialog, PageHeader, Pagination, Stat, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@estate/ui';
import { useApi, useListParams } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { SearchBox, StatusTabs, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';
import { InvoiceForm } from '@/components/finance/invoice-form';

interface InvoiceRow {
  id: string;
  invoiceNo: string;
  billToName: string;
  issueDate: string;
  dueDate: string | null;
  status: string;
  total: number;
  amountPaid: number;
  isOverdue: boolean;
  deal: { dealNo: string } | null;
}

export default function InvoicesPage() {
  const router = useRouter();
  const { can } = useSession();
  const { values, set, page, setPage } = useListParams<{ status?: string; q?: string }>();
  const q = useApi<Paginated<InvoiceRow> & { statusCounts: Record<string, number>; outstanding: number }>('/finance/invoices', { ...values, page, pageSize: 20 });
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <PageHeader
        title="Invoices"
        description="Bills raised by the company — the source of revenue. Tax rates are entered per line by your accountant."
        actions={
          can('finance.manage') ? (
            <Button onClick={() => setOpen(true)}>
              <Plus /> New invoice
            </Button>
          ) : null
        }
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat label="Outstanding on issued invoices" value={q.data ? formatINR(q.data.outstanding) : '—'} tone={q.data && q.data.outstanding > 0 ? 'warning' : 'default'} />
        <Stat label="Drafts" value={q.data?.statusCounts.DRAFT ?? 0} />
        <Stat label="Partly paid" value={q.data?.statusCounts.PARTIALLY_PAID ?? 0} />
      </div>
      <Card>
        <StatusTabs
          tabs={[
            { value: undefined, label: 'All' },
            { value: 'DRAFT', label: 'Drafts' },
            { value: 'ISSUED', label: 'Issued' },
            { value: 'PARTIALLY_PAID', label: 'Partly paid' },
            { value: 'PAID', label: 'Paid' },
            { value: 'CANCELLED', label: 'Cancelled' },
          ]}
          value={values.status}
          onChange={(v) => set({ status: v })}
          counts={q.data?.statusCounts}
        />
        <Toolbar>
          <SearchBox value={values.q} onChange={(v) => set({ q: v })} placeholder="Search invoice number or customer" />
        </Toolbar>
        <QueryState query={q} isEmpty={(d) => d.data.length === 0} empty={{ icon: <Receipt />, title: 'No invoices', description: 'Raise an invoice for brokerage, marketing or advisory services.' }}>
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    <TH>Invoice</TH>
                    <TH>Bill to</TH>
                    <TH className="hidden md:table-cell">Due</TH>
                    <TH align="right">Total</TH>
                    <TH align="right" className="hidden sm:table-cell">
                      Balance
                    </TH>
                    <TH>Status</TH>
                  </tr>
                </THead>
                <TBody>
                  {d.data.map((i) => (
                    <TR key={i.id} onClick={() => router.push(`/finance/invoices/${i.id}`)}>
                      <TD>
                        <Link href={`/finance/invoices/${i.id}`} onClick={(e) => e.stopPropagation()} className="tabular font-medium text-ink-900 hover:underline">
                          {i.status === 'DRAFT' ? 'Draft' : i.invoiceNo}
                        </Link>
                        <div className="text-xs text-ink-500">{formatDate(i.issueDate)}</div>
                      </TD>
                      <TD>
                        {i.billToName}
                        {i.deal ? <div className="text-xs text-ink-500">{i.deal.dealNo}</div> : null}
                      </TD>
                      <TD className="hidden md:table-cell">
                        {i.dueDate ? formatDate(i.dueDate) : '—'} {i.isOverdue ? <Badge tone="danger" size="sm">Overdue</Badge> : null}
                      </TD>
                      <TD align="right" className="tabular">
                        {formatINR(i.total, { precise: true })}
                      </TD>
                      <TD align="right" className="tabular hidden font-medium text-ink-900 sm:table-cell">
                        {i.status === 'CANCELLED' ? '—' : formatINR(i.total - i.amountPaid, { precise: true })}
                      </TD>
                      <TD>
                        <StatusBadge status={i.status} />
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
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? (
          <InvoiceForm
            onDone={(id) => {
              setOpen(false);
              if (id) router.push(`/finance/invoices/${id}`);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}
