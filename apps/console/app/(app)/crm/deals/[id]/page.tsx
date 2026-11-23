'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft, IndianRupee, Trash2 } from 'lucide-react';
import { enumLabel, formatDate, formatDateTime, formatINR, localDateString } from '@estate/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DescriptionList,
  Dialog,
  DialogContent,
  DialogFooter,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Skeleton,
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
import { useApi, useApiMutation } from '@/lib/hooks';
import { PaymentDialog } from '@/components/crm/dialogs';

interface DealDetail {
  id: string;
  dealNo: string;
  status: string;
  dealType: string;
  dealValue: number;
  expectedRevenue: number | null;
  bookingDate: string | null;
  agreementDate: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  notes: string | null;
  isDemo: boolean;
  createdAt: string;
  amountReceived: number;
  balance: number;
  allowedStatuses: string[];
  canManage: boolean;
  organization: { id: string; name: string };
  lead: { id: string; leadNo: string; name: string; status: string } | null;
  customer: { id: string; fullName: string; phone: string | null; email: string | null };
  property: { id: string; title: string; referenceCode: string; status: string } | null;
  project: { id: string; name: string } | null;
  unit: { id: string; code: string; status: string; totalPrice: number } | null;
  salesUser: { id: string; fullName: string } | null;
  brokerOrganization: { id: string; name: string } | null;
  leadProvider: { id: string; name: string } | null;
  createdBy: { fullName: string } | null;
  payments: { id: string; amount: number; receivedOn: string; receivedBy: string; method: string; referenceNo: string | null; notes: string | null; recordedBy: { fullName: string } | null }[];
  commissionRecords: { id: string; recipientName: string; recipientType: string; amount: number; status: string }[];
}

const DEAL_TYPE_LABELS: Record<string, string> = { SALE: 'Sale', RENT: 'Rent', LEASE: 'Lease' };
const STATUS_LABELS: Record<string, string> = { BOOKED: 'Mark booked', AGREEMENT_SIGNED: 'Agreement signed', CLOSED_WON: 'Close as won', CANCELLED: 'Cancel deal' };

export default function DealPage() {
  const { id } = useParams<{ id: string }>();
  const q = useApi<DealDetail>(`/crm/deals/${id}`);
  const d = q.data;
  const [paying, setPaying] = React.useState(false);
  const [target, setTarget] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState('');
  const [agreementDate, setAgreementDate] = React.useState(() => localDateString(new Date()));
  const [removing, setRemoving] = React.useState<string | null>(null);
  const status = useApiMutation(() => api.post(`/crm/deals/${id}/status`, { status: target, reason: reason || undefined, agreementDate: target === 'AGREEMENT_SIGNED' ? agreementDate : undefined }), {
    success: 'Deal updated',
    invalidate: ['/crm/deals', '/crm/leads'],
    onSuccess: () => {
      setTarget(null);
      setReason('');
    },
  });
  const removePayment = useApiMutation((paymentId: string) => api.delete(`/crm/deals/${id}/payments/${paymentId}`), { success: 'Payment removed', invalidate: ['/crm/deals'], onSuccess: () => setRemoving(null) });

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!d) return <EmptyState title="Deal not found" action={<Button asChild variant="outline"><Link href="/crm/deals">Back to deals</Link></Button>} />;

  const subject = d.property ? d.property.title : d.project ? `${d.project.name}${d.unit ? ` · unit ${d.unit.code}` : ''}` : '—';
  return (
    <>
      <PageHeader
        breadcrumbs={
          <Link href="/crm/deals" className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
            <ChevronLeft className="size-4" /> Deals
          </Link>
        }
        title={`${d.dealNo} · ${d.customer.fullName}`}
        description={
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge status={d.status} />
            {d.isDemo ? <Badge tone="outline">Demo data</Badge> : null}
            <span>{subject}</span>
          </span>
        }
        actions={
          <>
            {d.allowedStatuses.map((s) => (
              <Button key={s} size="sm" variant={s === 'CANCELLED' ? 'destructive-outline' : s === 'CLOSED_WON' ? 'primary' : 'outline'} onClick={() => setTarget(s)}>
                {STATUS_LABELS[s] ?? enumLabel(s)}
              </Button>
            ))}
            {d.canManage && d.status !== 'CANCELLED' ? (
              <Button size="sm" variant="outline" onClick={() => setPaying(true)}>
                <IndianRupee /> Record payment
              </Button>
            ) : null}
          </>
        }
      />
      {d.status === 'CANCELLED' && d.cancellationReason ? (
        <Alert tone="warning" title="Cancelled" className="mb-5">
          {d.cancellationReason}
        </Alert>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="p-4">
              <p className="text-[12.5px] text-ink-500">Deal value</p>
              <p className="tabular mt-1 font-display text-2xl font-semibold text-ink-900">{formatINR(d.dealValue)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-[12.5px] text-ink-500">Customer payments received</p>
              <p className="tabular mt-1 font-display text-2xl font-semibold text-ink-900">{formatINR(d.amountReceived)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-[12.5px] text-ink-500">Balance</p>
              <p className="tabular mt-1 font-display text-2xl font-semibold text-ink-900">{formatINR(d.balance)}</p>
            </Card>
          </div>
          <Card>
            <CardHeader title="Customer payments" description="Money paid by the customer towards the deal value — not company revenue." />
            {d.payments.length ? (
              <Table>
                <THead>
                  <tr>
                    <TH>Received on</TH>
                    <TH align="right">Amount</TH>
                    <TH className="hidden md:table-cell">Received by</TH>
                    <TH className="hidden md:table-cell">Method</TH>
                    <TH className="hidden lg:table-cell">Reference</TH>
                    <TH align="right">
                      <span className="sr-only">Actions</span>
                    </TH>
                  </tr>
                </THead>
                <TBody>
                  {d.payments.map((p) => (
                    <TR key={p.id}>
                      <TD>{formatDate(p.receivedOn)}</TD>
                      <TD align="right" className="tabular font-medium">
                        {formatINR(p.amount)}
                      </TD>
                      <TD className="hidden md:table-cell">{enumLabel(p.receivedBy)}</TD>
                      <TD className="hidden md:table-cell">{enumLabel(p.method)}</TD>
                      <TD className="hidden text-xs text-ink-500 lg:table-cell">{p.referenceNo ?? '—'}</TD>
                      <TD align="right">
                        {d.canManage ? (
                          <Button size="icon-sm" variant="ghost" aria-label="Remove payment" onClick={() => setRemoving(p.id)}>
                            <Trash2 />
                          </Button>
                        ) : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="px-5 py-6 text-sm text-ink-500">No payments recorded.</p>
            )}
          </Card>
          <Card>
            <CardHeader title="Commissions" description="Generated by the finance team from commission rules." />
            {d.commissionRecords.length ? (
              <ul className="divide-y divide-line">
                {d.commissionRecords.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span>
                      {c.recipientName} <span className="text-xs text-ink-500">({enumLabel(c.recipientType)})</span>
                    </span>
                    <span className="tabular">{formatINR(c.amount)}</span>
                    <StatusBadge status={c.status} size="sm" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-ink-500">No commission records yet.</p>
            )}
          </Card>
        </div>
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DescriptionList
              columns={1}
              items={[
                { label: 'Lead', value: d.lead ? <Link className="text-brand hover:underline" href={`/crm/leads/${d.lead.id}`}>{d.lead.leadNo}</Link> : '—' },
                { label: 'Customer', value: <Link className="text-brand hover:underline" href={`/crm/customers/${d.customer.id}`}>{d.customer.fullName}</Link> },
                { label: 'Deal type', value: DEAL_TYPE_LABELS[d.dealType] ?? enumLabel(d.dealType) },
                { label: 'Unit', value: d.unit ? <span>{d.unit.code} <StatusBadge status={d.unit.status} size="sm" /></span> : '—' },
                { label: 'Listing', value: d.property ? `${d.property.referenceCode} · ${d.property.title}` : '—' },
                { label: 'Expected company revenue', value: d.expectedRevenue != null ? formatINR(d.expectedRevenue) : '—' },
                { label: 'Booking date', value: d.bookingDate ? formatDate(d.bookingDate) : '—' },
                { label: 'Agreement date', value: d.agreementDate ? formatDate(d.agreementDate) : '—' },
                { label: 'Closed', value: d.closedAt ? formatDateTime(d.closedAt) : '—' },
                { label: 'Sales person', value: d.salesUser?.fullName ?? '—' },
                { label: 'Co-broking partner', value: d.brokerOrganization?.name ?? '—' },
                { label: 'Lead partner', value: d.leadProvider?.name ?? '—' },
                { label: 'Recorded by', value: `${d.createdBy?.fullName ?? '—'} · ${formatDateTime(d.createdAt)}` },
              ]}
            />
            {d.notes ? <p className="mt-4 whitespace-pre-line rounded-md bg-ink-50 px-3 py-2 text-sm text-ink-700">{d.notes}</p> : null}
          </CardBody>
        </Card>
      </div>

      <PaymentDialog open={paying} onOpenChange={setPaying} dealId={d.id} balance={d.balance} onDone={() => void q.refetch()} />
      <Dialog open={Boolean(target)} onOpenChange={(o) => !o && setTarget(null)}>
        {target ? (
          <DialogContent
            title={STATUS_LABELS[target] ?? enumLabel(target)}
            description={
              target === 'CLOSED_WON'
                ? 'The lead is converted, a booked unit becomes sold and a linked listing is marked sold/rented.'
                : target === 'CANCELLED'
                  ? 'A booked unit returns to available inventory and a linked listing is no longer under offer.'
                  : 'Confirm the change.'
            }
          >
            {target === 'AGREEMENT_SIGNED' ? (
              <Field label="Agreement date" htmlFor="ag-date">
                <Input id="ag-date" type="date" value={agreementDate} onChange={(e) => setAgreementDate(e.target.value)} />
              </Field>
            ) : null}
            {target === 'CANCELLED' ? (
              <Field label="Reason" htmlFor="cancel-reason" required>
                <Textarea id="cancel-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => setTarget(null)}>
                Back
              </Button>
              <Button variant={target === 'CANCELLED' ? 'destructive' : 'primary'} loading={status.isPending} disabled={target === 'CANCELLED' && reason.trim().length < 3} onClick={() => status.mutate(undefined)}>
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
      <ConfirmDialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)} tone="danger" title="Remove this payment?" description="Use this only for payments recorded by mistake. The removal is kept in the audit log." confirmLabel="Remove" loading={removePayment.isPending} onConfirm={() => removing && removePayment.mutate(removing)} />
    </>
  );
}
