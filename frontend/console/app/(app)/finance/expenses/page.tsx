'use client';

import * as React from 'react';
import { Banknote, FileText, Plus, Tags } from 'lucide-react';
import { formatDate, formatINR, type Paginated, localDateString } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Alert, Badge, Button, Card, Dialog, DialogContent, DialogFooter, Field, Input, PageHeader, Pagination, Select, StatusBadge, Switch, Table, TBody, TD, TH, THead, TR, Textarea } from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation, useListParams } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { FilterSelect, SearchBox, StatusTabs, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';
import { DocumentUpload, openDocument } from '@/components/uploaders';
import { DecisionDialog, PaymentDialog } from '@/components/finance/dialogs';

interface ExpenseRow {
  id: string;
  amount: number;
  expenseDate: string;
  vendor: string | null;
  description: string;
  status: string;
  isMine: boolean;
  approvedAt: string | null;
  category: { id: string; name: string };
  createdBy: { id: string; fullName: string } | null;
  approvedBy: { fullName: string } | null;
  receiptFile: { id: string; fileName: string } | null;
}
interface Category {
  id: string;
  name: string;
  isActive: boolean;
  _count: { expenses: number };
}

export default function ExpensesPage() {
  const { can } = useSession();
  const manage = can('finance.manage');
  const { values, set, page, setPage } = useListParams<{ status?: string; categoryId?: string; q?: string }>();
  const q = useApi<Paginated<ExpenseRow> & { statusCounts: Record<string, number>; totalAmount: number }>('/finance/expenses', { ...values, page, pageSize: 25 });
  const cats = useApi<Category[]>('/finance/expense-categories');
  const [creating, setCreating] = React.useState(false);
  const [catsOpen, setCatsOpen] = React.useState(false);
  const [deciding, setDeciding] = React.useState<{ row: ExpenseRow; decision: 'APPROVE' | 'REJECT' } | null>(null);
  const [paying, setPaying] = React.useState<ExpenseRow | null>(null);
  return (
    <>
      <PageHeader
        title="Expenses"
        description="Company spending. Every expense is approved by someone other than the person who recorded it before it can be paid."
        actions={
          manage ? (
            <>
              <Button variant="outline" onClick={() => setCatsOpen(true)}>
                <Tags /> Categories
              </Button>
              <Button onClick={() => setCreating(true)}>
                <Plus /> Record expense
              </Button>
            </>
          ) : null
        }
      />
      <Card>
        <StatusTabs
          tabs={[
            { value: undefined, label: 'All' },
            { value: 'PENDING', label: 'To approve' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'PAID', label: 'Paid' },
            { value: 'REJECTED', label: 'Rejected' },
          ]}
          value={values.status}
          onChange={(v) => set({ status: v })}
          counts={q.data?.statusCounts}
        />
        <Toolbar>
          <SearchBox value={values.q} onChange={(v) => set({ q: v })} placeholder="Search description or vendor" />
          <FilterSelect value={values.categoryId} onChange={(v) => set({ categoryId: v })} placeholder="All categories" options={(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
          {q.data ? <span className="text-sm text-ink-500 sm:ml-auto">Total shown: <span className="tabular font-medium text-ink-900">{formatINR(q.data.totalAmount, { precise: true })}</span></span> : null}
        </Toolbar>
        <QueryState query={q} isEmpty={(d) => d.data.length === 0} empty={{ icon: <Banknote />, title: 'No expenses', description: 'Recorded expenses will appear here for approval and payment.' }}>
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    <TH>Date</TH>
                    <TH>Expense</TH>
                    <TH className="hidden md:table-cell">Recorded by</TH>
                    <TH align="right">Amount</TH>
                    <TH>Status</TH>
                    <TH align="right">
                      <span className="sr-only">Actions</span>
                    </TH>
                  </tr>
                </THead>
                <TBody>
                  {d.data.map((e) => (
                    <TR key={e.id}>
                      <TD className="whitespace-nowrap">{formatDate(e.expenseDate)}</TD>
                      <TD>
                        <div className="font-medium text-ink-900">{e.description}</div>
                        <div className="text-xs text-ink-500">
                          {e.category.name}
                          {e.vendor ? ` · ${e.vendor}` : ''}
                          {e.receiptFile ? (
                            <button type="button" className="ml-1.5 inline-flex items-center gap-0.5 text-brand hover:underline" onClick={() => void openDocument(e.receiptFile!.id)}>
                              <FileText className="size-3" /> Receipt
                            </button>
                          ) : null}
                        </div>
                      </TD>
                      <TD className="hidden text-xs text-ink-600 md:table-cell">
                        {e.createdBy?.fullName ?? '—'}
                        {e.approvedBy ? <div className="text-ink-400">Decided by {e.approvedBy.fullName}</div> : null}
                      </TD>
                      <TD align="right" className="tabular font-medium text-ink-900">
                        {formatINR(e.amount, { precise: true })}
                      </TD>
                      <TD>
                        <StatusBadge status={e.status} />
                      </TD>
                      <TD align="right">
                        {manage ? (
                          <div className="flex justify-end gap-1">
                            {e.status === 'PENDING' && !e.isMine ? (
                              <>
                                <Button size="xs" variant="soft" onClick={() => setDeciding({ row: e, decision: 'APPROVE' })}>
                                  Approve
                                </Button>
                                <Button size="xs" variant="ghost" className="text-danger" onClick={() => setDeciding({ row: e, decision: 'REJECT' })}>
                                  Reject
                                </Button>
                              </>
                            ) : null}
                            {e.status === 'PENDING' && e.isMine ? <span className="text-xs text-ink-400">Awaiting another approver</span> : null}
                            {e.status === 'APPROVED' ? (
                              <Button size="xs" onClick={() => setPaying(e)}>
                                Mark paid
                              </Button>
                            ) : null}
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
      </Card>

      <Dialog open={creating} onOpenChange={setCreating}>
        {creating ? <ExpenseForm categories={(cats.data ?? []).filter((c) => c.isActive)} onDone={() => setCreating(false)} /> : null}
      </Dialog>
      <Dialog open={catsOpen} onOpenChange={setCatsOpen}>
        {catsOpen ? <CategoriesDialog categories={cats.data ?? []} /> : null}
      </Dialog>
      <Dialog open={Boolean(deciding)} onOpenChange={(o) => !o && setDeciding(null)}>
        {deciding ? <DecisionDialog path={`/finance/expenses/${deciding.row.id}/decision`} decision={deciding.decision} title={deciding.row.description} onDone={() => setDeciding(null)} invalidate={['/finance/expenses']} /> : null}
      </Dialog>
      <Dialog open={Boolean(paying)} onOpenChange={(o) => !o && setPaying(null)}>
        {paying ? <PaymentDialog path={`/finance/expenses/${paying.id}/pay`} title={`Pay ${formatINR(paying.amount, { precise: true })}`} description={paying.description} onDone={() => setPaying(null)} invalidate={['/finance']} /> : null}
      </Dialog>
    </>
  );
}

function ExpenseForm({ categories, onDone }: { categories: Category[]; onDone: () => void }) {
  const [v, setV] = React.useState({ categoryId: categories[0]?.id ?? '', amount: '', expenseDate: localDateString(new Date()), vendor: '', description: '' });
  const [receipt, setReceipt] = React.useState<{ id: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const save = useApiMutation(() => api.post('/finance/expenses', { ...v, amount: Number(v.amount), vendor: v.vendor || null, receiptFileId: receipt?.id ?? null }), {
    success: 'Expense recorded — it now needs approval by a colleague',
    invalidate: ['/finance/expenses'],
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e)),
    silent: true,
  });
  return (
    <DialogContent title="Record an expense">
      {error ? <Alert tone="danger" className="mb-4">{error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" htmlFor="e-cat" required>
          <Select id="e-cat" value={v.categoryId} onChange={(e) => setV({ ...v, categoryId: e.target.value })}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Amount (₹)" htmlFor="e-amt" required>
          <Input id="e-amt" type="number" step="0.01" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
        </Field>
        <Field label="Date" htmlFor="e-date" required>
          <Input id="e-date" type="date" value={v.expenseDate} onChange={(e) => setV({ ...v, expenseDate: e.target.value })} />
        </Field>
        <Field label="Vendor" htmlFor="e-vendor">
          <Input id="e-vendor" value={v.vendor} onChange={(e) => setV({ ...v, vendor: e.target.value })} />
        </Field>
        <Field label="Description" htmlFor="e-desc" required className="sm:col-span-2">
          <Textarea id="e-desc" rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <DocumentUpload purpose="receipt" label="Attach receipt" onUploaded={(f) => setReceipt({ id: f.id })} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button loading={save.isPending} disabled={!v.categoryId || !(Number(v.amount) > 0) || v.description.trim().length < 3} onClick={() => save.mutate(undefined)}>
          Save expense
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function CategoriesDialog({ categories }: { categories: Category[] }) {
  const [name, setName] = React.useState('');
  const add = useApiMutation(() => api.post('/finance/expense-categories', { name, isActive: true }), { success: 'Category added', invalidate: ['/finance/expense-categories'], onSuccess: () => setName('') });
  const toggle = useApiMutation((v: { id: string; isActive: boolean }) => api.patch(`/finance/expense-categories/${v.id}`, { isActive: v.isActive }), { invalidate: ['/finance/expense-categories'] });
  return (
    <DialogContent title="Expense categories" description="Inactive categories stay on old expenses but cannot be chosen for new ones.">
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" aria-label="New category name" />
        <Button disabled={name.trim().length < 2} loading={add.isPending} onClick={() => add.mutate(undefined)}>
          Add
        </Button>
      </div>
      <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div>
              <p className="text-sm text-ink-900">{c.name}</p>
              <p className="text-xs text-ink-500">{c._count.expenses} expense(s)</p>
            </div>
            <div className="flex items-center gap-2">
              {!c.isActive ? <Badge size="sm">Inactive</Badge> : null}
              <Switch checked={c.isActive} onCheckedChange={(v) => toggle.mutate({ id: c.id, isActive: v })} aria-label={`${c.name} active`} />
            </div>
          </li>
        ))}
      </ul>
    </DialogContent>
  );
}
