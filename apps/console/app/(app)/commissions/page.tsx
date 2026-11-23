'use client';

import * as React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Coins, Pencil, Plus, Sparkles, Wallet } from 'lucide-react';
import {
  COMMISSION_RECIPIENT_TYPES,
  commissionRuleSchema,
  DEAL_TYPES,
  enumLabel,
  formatDate,
  formatINR,
  PAYMENT_METHODS,
  type Paginated,
  localDateString,
} from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  CheckboxField,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@estate/ui';
import { api } from '@/lib/api';
import { applyServerErrors, useApi, useApiMutation, useListParams } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { FilterSelect, SearchBox, StatusTabs, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';

interface RecordRow {
  id: string;
  recipientType: string;
  recipientUserId: string | null;
  recipientOrganizationId: string | null;
  leadProviderId: string | null;
  recipientName: string;
  basisAmount: number;
  calcType: 'FIXED' | 'PERCENTAGE';
  rate: number;
  amount: number;
  amountPaid: number;
  status: string;
  approvedAt: string | null;
  notes: string | null;
  createdAt: string;
  rule: { id: string; name: string } | null;
  approvedBy: { fullName: string } | null;
  deal: { id: string; dealNo: string; status: string; dealValue: number; bookingDate: string | null; project: { name: string } | null; property: { title: string; referenceCode: string } | null; unit: { code: string } | null; customer: { fullName: string } };
  payoutItems: { payout: { id: string; payoutNo: string; status: string } }[];
}

export default function CommissionsPage() {
  const { can } = useSession();
  return (
    <>
      <PageHeader title="Commissions" description="Commission records are calculated from booked deals using the configured rules, approved by finance, then paid out (or paid with salary for employees)." />
      <Tabs defaultValue="records">
        <TabsList>
          <TabsTrigger value="records">
            <Coins /> Records
          </TabsTrigger>
          <TabsTrigger value="payouts">
            <Wallet /> Payouts
          </TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          {can('commission.manage') ? (
            <TabsTrigger value="generate">
              <Sparkles /> Generate from deals
            </TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value="records">
          <RecordsTab />
        </TabsContent>
        <TabsContent value="payouts">
          <PayoutsTab />
        </TabsContent>
        <TabsContent value="rules">
          <RulesTab />
        </TabsContent>
        {can('commission.manage') ? (
          <TabsContent value="generate">
            <GenerateTab />
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}

// ───────────── Records ─────────────

function RecordsTab() {
  const { can, user } = useSession();
  const { values, set, page, setPage } = useListParams<{ status?: string; recipientType?: string; q?: string }>();
  const q = useApi<Paginated<RecordRow> & { statusCounts: Record<string, number>; statusAmounts: Record<string, number> }>('/commissions', { ...values, page, pageSize: 25 });
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [payrollOpen, setPayrollOpen] = React.useState(false);
  const [manualOpen, setManualOpen] = React.useState(false);
  const transition = useApiMutation((v: { id: string; status: 'APPROVED' | 'PAYABLE' | 'CANCELLED' }) => api.post(`/commissions/${v.id}/status`, { status: v.status }), { success: (r: unknown) => `Commission ${enumLabel((r as RecordRow).status).toLowerCase()}`, invalidate: ['/commissions'] });
  const createPayout = useApiMutation(() => api.post('/commissions/payouts', { commissionRecordIds: [...selected] }), {
    success: 'Payout created — record the payment from the Payouts tab',
    invalidate: ['/commissions'],
    onSuccess: () => setSelected(new Set()),
  });
  const rows = q.data?.data ?? [];
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const sameRecipient = selectedRows.length > 0 && selectedRows.every((r) => r.recipientType === selectedRows[0].recipientType && r.recipientUserId === selectedRows[0].recipientUserId && r.recipientOrganizationId === selectedRows[0].recipientOrganizationId && r.leadProviderId === selectedRows[0].leadProviderId);
  const allEmployees = selectedRows.length > 0 && selectedRows.every((r) => r.recipientUserId && (r.recipientType === 'SALES_EMPLOYEE' || r.recipientType === 'SALES_MANAGER'));
  const amounts = q.data?.statusAmounts ?? {};

  return (
    <>
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(['PENDING_APPROVAL', 'APPROVED', 'PAYABLE', 'PAID'] as const).map((s) => (
          <div key={s} className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <p className="text-[12.5px] font-medium text-ink-500">{enumLabel(s)}</p>
            <p className="tabular mt-1.5 font-display text-[22px] font-semibold text-ink-900">{formatINR(amounts[s] ?? 0)}</p>
            <p className="mt-1 text-xs text-ink-500">{q.data?.statusCounts[s] ?? 0} record(s)</p>
          </div>
        ))}
      </div>
      <Card>
        <StatusTabs
          tabs={[
            { value: undefined, label: 'All' },
            { value: 'PENDING_APPROVAL', label: 'Awaiting approval' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'PAYABLE', label: 'Payable' },
            { value: 'PAID', label: 'Paid' },
            { value: 'CANCELLED', label: 'Cancelled' },
          ]}
          value={values.status}
          onChange={(v) => {
            setSelected(new Set());
            set({ status: v });
          }}
          counts={q.data?.statusCounts}
        />
        <Toolbar>
          <SearchBox value={values.q} onChange={(v) => set({ q: v })} placeholder="Search recipient or deal number" />
          <FilterSelect value={values.recipientType} onChange={(v) => set({ recipientType: v })} placeholder="All recipients" options={COMMISSION_RECIPIENT_TYPES.map((t) => ({ value: t, label: enumLabel(t) }))} />
          <div className="flex flex-1 flex-wrap justify-end gap-2">
            {selected.size ? (
              <>
                <Button size="sm" variant="outline" disabled={!allEmployees} title={allEmployees ? undefined : 'Only employee commissions can be paid with salary'} onClick={() => setPayrollOpen(true)}>
                  Pay with salary ({selected.size})
                </Button>
                <Button size="sm" disabled={!sameRecipient} title={sameRecipient ? undefined : 'A payout must be for a single recipient'} loading={createPayout.isPending} onClick={() => createPayout.mutate(undefined)}>
                  Create payout ({selected.size})
                </Button>
              </>
            ) : null}
            {can('commission.manage') ? (
              <Button size="sm" variant="outline" onClick={() => setManualOpen(true)}>
                <Plus /> Manual record
              </Button>
            ) : null}
          </div>
        </Toolbar>
        <QueryState query={q} isEmpty={(d) => d.data.length === 0} empty={{ icon: <Coins />, title: 'No commission records', description: 'Generate commissions from booked deals, or add a manual record.' }}>
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    <TH className="w-10">
                      <span className="sr-only">Select</span>
                    </TH>
                    <TH>Recipient</TH>
                    <TH className="hidden md:table-cell">Deal</TH>
                    <TH className="hidden lg:table-cell">Calculation</TH>
                    <TH align="right">Amount</TH>
                    <TH>Status</TH>
                    <TH align="right">
                      <span className="sr-only">Actions</span>
                    </TH>
                  </tr>
                </THead>
                <TBody>
                  {d.data.map((r) => {
                    const own = r.recipientUserId === user.id;
                    return (
                      <TR key={r.id} selected={selected.has(r.id)}>
                        <TD>
                          {r.status === 'PAYABLE' && can('commission.manage') ? (
                            <Checkbox
                              aria-label={`Select ${r.recipientName}`}
                              checked={selected.has(r.id)}
                              onCheckedChange={(v) => {
                                const next = new Set(selected);
                                if (v) next.add(r.id);
                                else next.delete(r.id);
                                setSelected(next);
                              }}
                            />
                          ) : null}
                        </TD>
                        <TD>
                          <div className="font-medium text-ink-900">{r.recipientName}</div>
                          <div className="text-xs text-ink-500">{enumLabel(r.recipientType)}</div>
                        </TD>
                        <TD className="hidden md:table-cell">
                          <div className="text-ink-800">{r.deal.project?.name ?? r.deal.property?.title ?? '—'}</div>
                          <div className="text-xs text-ink-500">
                            {r.deal.dealNo}
                            {r.deal.unit ? ` · ${r.deal.unit.code}` : ''} · {r.deal.customer.fullName}
                          </div>
                        </TD>
                        <TD className="hidden text-xs text-ink-600 lg:table-cell">
                          {r.calcType === 'PERCENTAGE' ? `${r.rate}% of ${formatINR(r.basisAmount)}` : 'Fixed'}
                          <div className="text-ink-400">{r.rule?.name ?? 'Manual'}</div>
                        </TD>
                        <TD align="right" className="tabular font-medium text-ink-900">
                          {formatINR(r.amount, { precise: true })}
                          {r.amountPaid > 0 && r.status !== 'PAID' ? <div className="text-xs font-normal text-ink-500">Paid {formatINR(r.amountPaid)}</div> : null}
                        </TD>
                        <TD>
                          <StatusBadge status={r.status} />
                          {r.approvedBy ? <div className="mt-0.5 text-[11px] text-ink-500">by {r.approvedBy.fullName}</div> : null}
                        </TD>
                        <TD align="right">
                          <div className="flex justify-end gap-1">
                            {r.status === 'PENDING_APPROVAL' && can('commission.approve') && !own ? (
                              <Button size="xs" variant="soft" onClick={() => transition.mutate({ id: r.id, status: 'APPROVED' })}>
                                Approve
                              </Button>
                            ) : null}
                            {r.status === 'APPROVED' && can('commission.manage') ? (
                              <Button size="xs" variant="soft" onClick={() => transition.mutate({ id: r.id, status: 'PAYABLE' })}>
                                Mark payable
                              </Button>
                            ) : null}
                            {['PENDING_APPROVAL', 'APPROVED', 'PAYABLE'].includes(r.status) && can('commission.manage') ? (
                              <Button size="xs" variant="ghost" className="text-danger" onClick={() => transition.mutate({ id: r.id, status: 'CANCELLED' })}>
                                Cancel
                              </Button>
                            ) : null}
                          </div>
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
      <Dialog open={payrollOpen} onOpenChange={setPayrollOpen}>
        {payrollOpen ? <PayViaPayroll ids={[...selected]} onDone={() => (setPayrollOpen(false), setSelected(new Set()))} /> : null}
      </Dialog>
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        {manualOpen ? <ManualRecord onDone={() => setManualOpen(false)} /> : null}
      </Dialog>
    </>
  );
}

function PayViaPayroll({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const now = new Date();
  const [period, setPeriod] = React.useState({ periodYear: now.getFullYear(), periodMonth: now.getMonth() + 1 });
  const pay = useApiMutation(() => api.post<{ scheduled: number }>('/commissions/pay-via-payroll', { commissionRecordIds: ids, ...period }), {
    success: (r) => `${r.scheduled} commission(s) added to the ${period.periodYear}-${String(period.periodMonth).padStart(2, '0')} payroll as incentives`,
    invalidate: ['/commissions'],
    onSuccess: onDone,
  });
  return (
    <DialogContent title="Pay with salary" description="Adds each commission as an incentive in the chosen payroll month. They are marked paid automatically once that payroll run is paid.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Payroll month" htmlFor="pm">
          <Select id="pm" value={period.periodMonth} onChange={(e) => setPeriod({ ...period, periodMonth: Number(e.target.value) })}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {new Date(2026, i, 1).toLocaleString('en-IN', { month: 'long' })}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Year" htmlFor="py">
          <Input id="py" type="number" value={period.periodYear} onChange={(e) => setPeriod({ ...period, periodYear: Number(e.target.value) })} />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button loading={pay.isPending} onClick={() => pay.mutate(undefined)}>
          Add to payroll
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

interface EligibleDeal {
  id: string;
  dealNo: string;
  status: string;
  dealType: string;
  dealValue: number;
  expectedRevenue: number | null;
  bookingDate: string | null;
  customer: { fullName: string };
  project: { name: string } | null;
  property: { title: string } | null;
  unit: { code: string } | null;
  salesUser: { id: string; fullName: string } | null;
  brokerOrganization: { id: string; name: string } | null;
  leadProvider: { id: string; name: string } | null;
  lead: { leadProvider: { id: string; name: string } | null } | null;
  _count: { commissionRecords: number };
}

function ManualRecord({ onDone }: { onDone: () => void }) {
  const deals = useApi<EligibleDeal[]>('/commissions/deals');
  const [dealId, setDealId] = React.useState('');
  const deal = deals.data?.find((d) => d.id === dealId);
  const provider = deal?.leadProvider ?? deal?.lead?.leadProvider ?? null;
  const parties = deal
    ? [
        ...(deal.salesUser ? [{ key: 'sales', label: `${deal.salesUser.fullName} (sales)`, type: 'SALES_EMPLOYEE', userId: deal.salesUser.id, name: deal.salesUser.fullName }] : []),
        ...(deal.brokerOrganization ? [{ key: 'broker', label: `${deal.brokerOrganization.name} (co-broker)`, type: 'BROKER', orgId: deal.brokerOrganization.id, name: deal.brokerOrganization.name }] : []),
        ...(provider ? [{ key: 'provider', label: `${provider.name} (lead provider)`, type: 'LEAD_PROVIDER', providerId: provider.id, name: provider.name }] : []),
        { key: 'partner', label: 'Other partner (enter name)', type: 'PARTNER' },
      ]
    : [];
  const [party, setParty] = React.useState('');
  const [v, setV] = React.useState({ recipientName: '', calcType: 'PERCENTAGE' as 'PERCENTAGE' | 'FIXED', value: '', notes: '' });
  const p = parties.find((x) => x.key === party) as { type: string; userId?: string; orgId?: string; providerId?: string; name?: string } | undefined;
  const save = useApiMutation(
    () =>
      api.post('/commissions', {
        dealId,
        recipientType: p!.type,
        recipientUserId: p!.userId ?? null,
        recipientOrganizationId: p!.orgId ?? null,
        leadProviderId: p!.providerId ?? null,
        recipientName: p!.name ?? v.recipientName,
        calcType: v.calcType,
        value: Number(v.value),
        basisAmount: v.calcType === 'PERCENTAGE' ? deal!.dealValue : 0,
        notes: v.notes || null,
      }),
    { success: 'Commission record added for approval', invalidate: ['/commissions'], onSuccess: onDone },
  );
  return (
    <DialogContent title="Manual commission record" description="For agreements the rules do not cover. Records always start awaiting approval." size="lg">
      <div className="grid gap-4">
        <Field label="Deal" htmlFor="m-deal" required>
          <Select
            id="m-deal"
            value={dealId}
            onChange={(e) => {
              setDealId(e.target.value);
              setParty('');
            }}
          >
            <option value="">{deals.isLoading ? 'Loading…' : 'Select a booked deal'}</option>
            {(deals.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.dealNo} · {d.project?.name ?? d.property?.title ?? '—'} · {d.customer.fullName} · {formatINR(d.dealValue)}
              </option>
            ))}
          </Select>
        </Field>
        {deal ? (
          <Field label="Recipient" htmlFor="m-party" required>
            <Select id="m-party" value={party} onChange={(e) => setParty(e.target.value)}>
              <option value="">Select recipient</option>
              {parties.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {party === 'partner' ? (
          <Field label="Partner name" htmlFor="m-name" required>
            <Input id="m-name" value={v.recipientName} onChange={(e) => setV({ ...v, recipientName: e.target.value })} />
          </Field>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Calculation" htmlFor="m-calc">
            <Select id="m-calc" value={v.calcType} onChange={(e) => setV({ ...v, calcType: e.target.value as 'PERCENTAGE' | 'FIXED' })}>
              <option value="PERCENTAGE">Percentage of deal value</option>
              <option value="FIXED">Fixed amount</option>
            </Select>
          </Field>
          <Field label={v.calcType === 'PERCENTAGE' ? 'Percentage' : 'Amount (₹)'} htmlFor="m-value" required hint={deal && v.calcType === 'PERCENTAGE' && v.value ? `= ${formatINR((deal.dealValue * Number(v.value)) / 100, { precise: true })}` : undefined}>
            <Input id="m-value" type="number" step="any" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} />
          </Field>
        </div>
        <Field label="Notes" htmlFor="m-notes">
          <Textarea id="m-notes" rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button loading={save.isPending} disabled={!deal || !p || !v.value || (party === 'partner' && v.recipientName.trim().length < 2)} onClick={() => save.mutate(undefined)}>
          Add record
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ───────────── Payouts ─────────────

interface PayoutRow {
  id: string;
  payoutNo: string;
  recipientType: string;
  recipientName: string;
  totalAmount: number;
  status: string;
  method: string | null;
  referenceNo: string | null;
  paidOn: string | null;
  notes: string | null;
  createdAt: string;
  items: { amount: number; commissionRecord: { id: string; deal: { dealNo: string }; rule: { name: string } | null } }[];
  recordedBy: { fullName: string } | null;
  transactions: { txnNo: string; txnDate: string }[];
}

function PayoutsTab() {
  const { can } = useSession();
  const { values, set, page, setPage } = useListParams<{ pstatus?: string }>();
  const q = useApi<Paginated<PayoutRow>>('/commissions/payouts', { status: values.pstatus, page, pageSize: 20 });
  const [paying, setPaying] = React.useState<PayoutRow | null>(null);
  const [pay, setPay] = React.useState({ paidOn: localDateString(new Date()), method: 'BANK_TRANSFER', referenceNo: '' });
  const payMutation = useApiMutation(() => api.post(`/commissions/payouts/${paying!.id}/pay`, { ...pay, referenceNo: pay.referenceNo || null }), {
    success: 'Payout recorded as paid — ledger entry created',
    invalidate: ['/commissions', '/finance'],
    onSuccess: () => setPaying(null),
  });
  const cancel = useApiMutation((id: string) => api.post(`/commissions/payouts/${id}/cancel`), { success: 'Payout cancelled', invalidate: ['/commissions'] });
  return (
    <Card>
      <StatusTabs
        tabs={[
          { value: undefined, label: 'All' },
          { value: 'PENDING', label: 'To pay' },
          { value: 'PAID', label: 'Paid' },
          { value: 'CANCELLED', label: 'Cancelled' },
        ]}
        value={values.pstatus}
        onChange={(v) => set({ pstatus: v })}
      />
      <QueryState query={q} isEmpty={(d) => d.data.length === 0} empty={{ icon: <Wallet />, title: 'No payouts', description: 'Select payable records on the Records tab to create a payout.' }}>
        {(d) => (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Payout</TH>
                  <TH>Recipient</TH>
                  <TH align="right">Amount</TH>
                  <TH>Status</TH>
                  <TH className="hidden lg:table-cell">Payment</TH>
                  <TH align="right">
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {d.data.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <div className="tabular font-medium text-ink-900">{p.payoutNo}</div>
                      <div className="text-xs text-ink-500">
                        {p.items.length} record(s) · {p.items.map((i) => i.commissionRecord.deal.dealNo).join(', ')}
                      </div>
                    </TD>
                    <TD>
                      {p.recipientName}
                      <div className="text-xs text-ink-500">{enumLabel(p.recipientType)}</div>
                    </TD>
                    <TD align="right" className="tabular font-medium">
                      {formatINR(p.totalAmount, { precise: true })}
                    </TD>
                    <TD>
                      <StatusBadge status={p.status} />
                    </TD>
                    <TD className="hidden text-xs text-ink-600 lg:table-cell">
                      {p.paidOn ? `${formatDate(p.paidOn)} · ${enumLabel(p.method)}${p.referenceNo ? ` · ${p.referenceNo}` : ''}` : '—'}
                      {p.transactions[0] ? <div className="text-ink-400">{p.transactions[0].txnNo}</div> : null}
                    </TD>
                    <TD align="right">
                      {p.status === 'PENDING' && can('commission.manage') ? (
                        <div className="flex justify-end gap-1">
                          <Button size="xs" onClick={() => setPaying(p)}>
                            Record payment
                          </Button>
                          <Button size="xs" variant="ghost" className="text-danger" onClick={() => cancel.mutate(p.id)}>
                            Cancel
                          </Button>
                        </div>
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
      <Dialog open={Boolean(paying)} onOpenChange={(o) => !o && setPaying(null)}>
        {paying ? (
          <DialogContent title={`Pay ${paying.payoutNo}`} description={`${formatINR(paying.totalAmount, { precise: true })} to ${paying.recipientName}. Record the payment you have made — no money is moved by this system.`}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Paid on" htmlFor="po-date" required>
                <Input id="po-date" type="date" value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} />
              </Field>
              <Field label="Method" htmlFor="po-method" required>
                <Select id="po-method" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {enumLabel(m)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reference (UTR / cheque no.)" htmlFor="po-ref" className="sm:col-span-2">
                <Input id="po-ref" value={pay.referenceNo} onChange={(e) => setPay({ ...pay, referenceNo: e.target.value })} />
              </Field>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPaying(null)}>
                Cancel
              </Button>
              <Button loading={payMutation.isPending} onClick={() => payMutation.mutate(undefined)}>
                Mark paid
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </Card>
  );
}

// ───────────── Rules ─────────────

interface RuleRow {
  id: string;
  name: string;
  recipientType: string;
  calcType: 'FIXED' | 'PERCENTAGE';
  value: number;
  basis: string;
  dealType: string | null;
  projectId: string | null;
  propertyTypeId: string | null;
  cityId: string | null;
  leadProviderId: string | null;
  brokerOrganizationId: string | null;
  minDealValue: number | null;
  maxPayout: number | null;
  priority: number;
  isActive: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  project: { id: string; name: string } | null;
  propertyType: { id: string; name: string } | null;
  city: { id: string; name: string } | null;
  leadProvider: { id: string; name: string } | null;
  brokerOrganization: { id: string; name: string } | null;
  _count: { records: number };
}

function RulesTab() {
  const { can } = useSession();
  const q = useApi<RuleRow[]>('/commissions/rules');
  const [editing, setEditing] = React.useState<RuleRow | 'new' | null>(null);
  return (
    <Card>
      <CardHeader
        title="Commission rules"
        description="Evaluated in priority order for each booked deal. Every matching rule creates one record for its recipient."
        actions={
          can('commission.manage') ? (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus /> New rule
            </Button>
          ) : null
        }
      />
      <QueryState query={q} isEmpty={(d) => d.length === 0} empty={{ icon: <Coins />, title: 'No rules configured', description: 'Without rules, commissions can only be added manually.' }}>
        {(rules) => (
          <Table>
            <THead>
              <tr>
                <TH>Rule</TH>
                <TH>Recipient</TH>
                <TH>Calculation</TH>
                <TH className="hidden lg:table-cell">Applies to</TH>
                <TH>Status</TH>
                <TH align="right">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {rules.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <div className="font-medium text-ink-900">{r.name}</div>
                    <div className="text-xs text-ink-500">
                      Priority {r.priority} · {r._count.records} record(s)
                    </div>
                  </TD>
                  <TD>{enumLabel(r.recipientType)}</TD>
                  <TD className="text-ink-700">
                    {r.calcType === 'PERCENTAGE' ? `${r.value}% of ${r.basis === 'DEAL_VALUE' ? 'deal value' : 'company revenue'}` : formatINR(r.value)}
                    {r.maxPayout ? <div className="text-xs text-ink-500">Max {formatINR(r.maxPayout)}</div> : null}
                  </TD>
                  <TD className="hidden text-xs text-ink-600 lg:table-cell">
                    {[r.dealType ? enumLabel(r.dealType) : null, r.project?.name, r.propertyType?.name, r.city?.name, r.leadProvider?.name, r.brokerOrganization?.name, r.minDealValue ? `deals ≥ ${formatINR(r.minDealValue)}` : null]
                      .filter(Boolean)
                      .join(' · ') || 'All deals'}
                    {r.effectiveFrom || r.effectiveTo ? <div className="text-ink-400">{r.effectiveFrom ? formatDate(r.effectiveFrom) : '…'} – {r.effectiveTo ? formatDate(r.effectiveTo) : '…'}</div> : null}
                  </TD>
                  <TD>{r.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</TD>
                  <TD align="right">
                    {can('commission.manage') ? (
                      <Button size="xs" variant="ghost" onClick={() => setEditing(r)}>
                        <Pencil /> Edit
                      </Button>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </QueryState>
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        {editing ? <RuleForm rule={editing === 'new' ? null : editing} onDone={() => setEditing(null)} /> : null}
      </Dialog>
    </Card>
  );
}

type RuleValues = z.input<typeof commissionRuleSchema>;
const nullNum = { setValueAs: (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v)) };
const nullStr = { setValueAs: (v: unknown) => (v === '' || v === undefined ? null : v) };

function RuleForm({ rule, onDone }: { rule: RuleRow | null; onDone: () => void }) {
  const projects = useApi<{ data: { id: string; name: string }[] }>('/public/projects', { pageSize: 48 });
  const types = useApi<{ id: string; name: string }[]>('/public/property-types');
  const cities = useApi<{ id: string; name: string }[]>('/public/cities');
  const form = useForm<RuleValues>({
    resolver: zodResolver(commissionRuleSchema),
    defaultValues: rule
      ? {
          name: rule.name,
          recipientType: rule.recipientType as RuleValues['recipientType'],
          calcType: rule.calcType,
          value: rule.value,
          basis: rule.basis as RuleValues['basis'],
          dealType: (rule.dealType as RuleValues['dealType']) ?? null,
          projectId: rule.projectId,
          propertyTypeId: rule.propertyTypeId,
          cityId: rule.cityId,
          leadProviderId: rule.leadProviderId,
          brokerOrganizationId: rule.brokerOrganizationId,
          minDealValue: rule.minDealValue,
          maxPayout: rule.maxPayout,
          priority: rule.priority,
          isActive: rule.isActive,
          effectiveFrom: rule.effectiveFrom?.slice(0, 10) ?? null,
          effectiveTo: rule.effectiveTo?.slice(0, 10) ?? null,
        }
      : { name: '', recipientType: 'SALES_EMPLOYEE', calcType: 'PERCENTAGE', basis: 'DEAL_VALUE', priority: 100, isActive: true },
  });
  const e = form.formState.errors;
  return (
    <DialogContent title={rule ? `Edit ${rule.name}` : 'New commission rule'} size="lg">
      <form
        noValidate
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={form.handleSubmit(async (v) => {
          try {
            if (rule) await api.patch(`/commissions/rules/${rule.id}`, v);
            else await api.post('/commissions/rules', v);
            toast.success(rule ? 'Rule updated' : 'Rule created');
            onDone();
          } catch (err) {
            if (!applyServerErrors(form, err)) toast.error(errorMessage(err));
          }
        })}
      >
        <Field label="Name" htmlFor="r-name" required className="sm:col-span-2" error={e.name?.message}>
          <Input id="r-name" {...form.register('name')} />
        </Field>
        <Field label="Recipient" htmlFor="r-rec" required>
          <Select id="r-rec" {...form.register('recipientType')}>
            {COMMISSION_RECIPIENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {enumLabel(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Calculation" htmlFor="r-calc" required>
          <Select id="r-calc" {...form.register('calcType')}>
            <option value="PERCENTAGE">Percentage</option>
            <option value="FIXED">Fixed amount</option>
          </Select>
        </Field>
        <Field label={form.watch('calcType') === 'PERCENTAGE' ? 'Percentage' : 'Amount (₹)'} htmlFor="r-value" required error={e.value?.message}>
          <Input id="r-value" type="number" step="any" {...form.register('value')} />
        </Field>
        <Field label="Basis" htmlFor="r-basis">
          <Select id="r-basis" {...form.register('basis')}>
            <option value="DEAL_VALUE">Deal value</option>
            <option value="COMPANY_REVENUE">Company revenue on the deal</option>
          </Select>
        </Field>
        <Field label="Deal type" htmlFor="r-dt">
          <Select id="r-dt" {...form.register('dealType', nullStr)}>
            <option value="">Any</option>
            {DEAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {enumLabel(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Project" htmlFor="r-proj">
          <Select id="r-proj" {...form.register('projectId', nullStr)}>
            <option value="">Any project</option>
            {(projects.data?.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Property type" htmlFor="r-type">
          <Select id="r-type" {...form.register('propertyTypeId', nullStr)}>
            <option value="">Any type</option>
            {(types.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="City" htmlFor="r-city">
          <Select id="r-city" {...form.register('cityId', nullStr)}>
            <option value="">Any city</option>
            {(cities.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Minimum deal value (₹)" htmlFor="r-min" error={e.minDealValue?.message}>
          <Input id="r-min" type="number" {...form.register('minDealValue', nullNum)} />
        </Field>
        <Field label="Maximum payout (₹)" htmlFor="r-max" error={e.maxPayout?.message}>
          <Input id="r-max" type="number" {...form.register('maxPayout', nullNum)} />
        </Field>
        <Field label="Effective from" htmlFor="r-from">
          <Input id="r-from" type="date" {...form.register('effectiveFrom', nullStr)} />
        </Field>
        <Field label="Effective to" htmlFor="r-to" error={e.effectiveTo?.message}>
          <Input id="r-to" type="date" {...form.register('effectiveTo', nullStr)} />
        </Field>
        <Field label="Priority" htmlFor="r-pri" hint="Lower runs first">
          <Input id="r-pri" type="number" {...form.register('priority')} />
        </Field>
        <div className="flex items-end pb-2">
          <Controller control={form.control} name="isActive" render={({ field }) => <CheckboxField checked={Boolean(field.value)} onCheckedChange={(v) => field.onChange(Boolean(v))} label="Rule is active" />} />
        </div>
        {rule?.leadProvider || rule?.brokerOrganization ? (
          <Alert tone="info" className="sm:col-span-2">
            Restricted to {rule.leadProvider?.name ?? rule.brokerOrganization?.name}.
          </Alert>
        ) : null}
        <div className="sm:col-span-2">
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {rule ? 'Save rule' : 'Create rule'}
            </Button>
          </DialogFooter>
        </div>
      </form>
    </DialogContent>
  );
}

// ───────────── Generate ─────────────

interface GenerationResult {
  dealNo: string;
  created: { id: string; rule: string; recipientName: string; amount: number }[];
  skipped: { rule: string; reason: string }[];
}

function GenerateTab() {
  const [search, setSearch] = React.useState<string | undefined>();
  const deals = useApi<EligibleDeal[]>('/commissions/deals', { q: search });
  const [results, setResults] = React.useState<Record<string, GenerationResult>>({});
  const generate = useApiMutation((dealId: string) => api.post<GenerationResult>(`/commissions/deals/${dealId}/generate`), {
    success: (r) => (r.created.length ? `${r.created.length} commission record(s) created for ${r.dealNo}` : `Nothing new for ${r.dealNo}`),
    invalidate: ['/commissions'],
    onSuccess: (r, dealId) => setResults((prev) => ({ ...prev, [dealId]: r })),
  });
  return (
    <Card>
      <CardHeader title="Booked deals" description="Generation is safe to repeat — existing records are never duplicated. It also runs automatically every hour." />
      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search deal number or customer" />
      </Toolbar>
      <QueryState query={deals} isEmpty={(d) => d.length === 0} empty={{ icon: <Sparkles />, title: 'No booked deals', description: 'Deals appear here once the sales team records a booking.' }}>
        {(rows) => (
          <ul className="divide-y divide-line">
            {rows.map((d) => {
              const r = results[d.id];
              return (
                <li key={d.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">
                        {d.dealNo} · {d.project?.name ?? d.property?.title ?? '—'}
                        {d.unit ? ` · ${d.unit.code}` : ''}
                      </p>
                      <p className="text-xs text-ink-500">
                        {d.customer.fullName} · {formatINR(d.dealValue)} · {d.salesUser?.fullName ?? 'No sales person'} · {d._count.commissionRecords} record(s)
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={d.status} />
                      <Button size="sm" variant="outline" loading={generate.isPending && generate.variables === d.id} onClick={() => generate.mutate(d.id)}>
                        <Sparkles /> Generate
                      </Button>
                    </div>
                  </div>
                  {r ? (
                    <div className="mt-3 rounded-lg bg-ink-50 px-3.5 py-2.5 text-xs">
                      {r.created.map((c) => (
                        <p key={c.id} className="text-success">
                          Created: {c.rule} → {c.recipientName} {formatINR(c.amount, { precise: true })}
                        </p>
                      ))}
                      {r.skipped.map((s, i) => (
                        <p key={i} className="text-ink-600">
                          Skipped: {s.rule} — {s.reason}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </Card>
  );
}

