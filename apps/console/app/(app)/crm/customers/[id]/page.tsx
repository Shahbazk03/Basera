'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ChevronLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { customerUpdateSchema, enumLabel, formatDateTime, formatINR, formatPriceRange } from '@estate/shared';
import { Badge, Button, Card, CardBody, CardHeader, DescriptionList, Dialog, DialogContent, DialogFooter, EmptyState, Field, Input, PageHeader, Select, Skeleton, StatusBadge, Textarea } from '@estate/ui';
import { api } from '@/lib/api';
import { applyServerErrors, useApi, useApiMutation } from '@/lib/hooks';

interface CustomerDetail {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  alternatePhone: string | null;
  city: string | null;
  occupation: string | null;
  notes: string | null;
  isDemo: boolean;
  createdAt: string;
  canEdit: boolean;
  organization: { id: string; name: string };
  user: { id: string; email: string | null } | null;
  preferences: { id: string; listingType: string | null; segment: string | null; localityNames: string[]; budgetMin: number | null; budgetMax: number | null; bedroomsMin: number | null; notes: string | null; city: { name: string } | null }[];
  leads: { id: string; leadNo: string; status: string; priority: string; createdAt: string; assignedTo: { fullName: string } | null; project: { name: string } | null; property: { title: string } | null }[];
  enquiries: { id: string; referenceNo: string; type: string; status: string; createdAt: string; property: { title: string } | null; project: { name: string } | null }[];
  siteVisits: { id: string; status: string; scheduledAt: string; property: { title: string } | null; project: { name: string } | null }[];
  deals: { id: string; dealNo: string; status: string; dealValue: number; createdAt: string }[];
}

const editSchema = customerUpdateSchema;

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const q = useApi<CustomerDetail>(`/crm/customers/${id}`);
  const c = q.data;
  const [editing, setEditing] = React.useState(false);
  const [addingPref, setAddingPref] = React.useState(false);
  const removePref = useApiMutation((prefId: string) => api.delete(`/crm/customers/${id}/preferences/${prefId}`), { success: 'Preference removed', invalidate: ['/crm/customers'] });

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!c) return <EmptyState title="Customer not found" action={<Button asChild variant="outline"><Link href="/crm/customers">Back to customers</Link></Button>} />;

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Link href="/crm/customers" className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
            <ChevronLeft className="size-4" /> Customers
          </Link>
        }
        title={c.fullName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {c.organization.name}
            {c.user ? <Badge tone="info">Has website account</Badge> : null}
            {c.isDemo ? <Badge tone="outline">Demo data</Badge> : null}
          </span>
        }
        actions={
          c.canEdit ? (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil /> Edit details
            </Button>
          ) : null
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Leads" description="Every lead this customer has had with your organisation." />
            {c.leads.length ? (
              <ul className="divide-y divide-line">
                {c.leads.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div>
                      <Link href={`/crm/leads/${l.id}`} className="font-medium text-brand hover:underline">
                        {l.leadNo}
                      </Link>
                      <p className="text-xs text-ink-500">
                        {l.property?.title ?? l.project?.name ?? 'General requirement'} · {l.assignedTo?.fullName ?? 'Unassigned'} · {formatDateTime(l.createdAt)}
                      </p>
                    </div>
                    <StatusBadge status={l.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-ink-500">No leads.</p>
            )}
          </Card>
          <Card>
            <CardHeader title="Deals" />
            {c.deals.length ? (
              <ul className="divide-y divide-line">
                {c.deals.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <Link href={`/crm/deals/${d.id}`} className="font-medium text-brand hover:underline">
                      {d.dealNo}
                    </Link>
                    <span className="tabular text-sm">{formatINR(d.dealValue)}</span>
                    <StatusBadge status={d.status} size="sm" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-ink-500">No deals yet.</p>
            )}
          </Card>
          <Card>
            <CardHeader title="Enquiries & visits" />
            <ul className="divide-y divide-line">
              {c.enquiries.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span>
                    <span className="font-medium text-ink-900">{e.referenceNo}</span> · {enumLabel(e.type)} · {e.property?.title ?? e.project?.name ?? 'General'}
                  </span>
                  <span className="text-xs text-ink-500">{formatDateTime(e.createdAt)}</span>
                </li>
              ))}
              {c.siteVisits.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span>
                    Site visit · {v.property?.title ?? v.project?.name ?? 'Property'} · {formatDateTime(v.scheduledAt)}
                  </span>
                  <StatusBadge status={v.status} size="sm" />
                </li>
              ))}
              {!c.enquiries.length && !c.siteVisits.length ? <li className="px-5 py-6 text-sm text-ink-500">No enquiries or visits.</li> : null}
            </ul>
          </Card>
        </div>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Contact details" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { label: 'Mobile', value: c.phone ? <a className="text-brand hover:underline" href={`tel:${c.phone}`}>{c.phone}</a> : '—' },
                  { label: 'Email', value: c.email ?? '—' },
                  { label: 'Alternate phone', value: c.alternatePhone ?? '—' },
                  { label: 'City', value: c.city ?? '—' },
                  { label: 'Occupation', value: c.occupation ?? '—' },
                  { label: 'Customer since', value: formatDateTime(c.createdAt) },
                ]}
              />
              {c.notes ? <p className="mt-4 whitespace-pre-line rounded-md bg-ink-50 px-3 py-2 text-sm text-ink-700">{c.notes}</p> : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Preferences"
              actions={
                c.canEdit ? (
                  <Button size="xs" variant="outline" onClick={() => setAddingPref(true)}>
                    <Plus /> Add
                  </Button>
                ) : null
              }
            />
            {c.preferences.length ? (
              <ul className="divide-y divide-line">
                {c.preferences.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                    <div>
                      <p className="font-medium text-ink-900">
                        {p.listingType ? (p.listingType === 'RENT' ? 'Rent' : 'Buy') : 'Any'} · {p.segment ? enumLabel(p.segment) : 'Any segment'}
                      </p>
                      <p className="text-xs text-ink-500">
                        {[p.city?.name, p.localityNames.join(', '), p.budgetMin || p.budgetMax ? formatPriceRange(p.budgetMin, p.budgetMax) : null, p.bedroomsMin ? `${p.bedroomsMin}+ BHK` : null].filter(Boolean).join(' · ')}
                      </p>
                      {p.notes ? <p className="mt-1 text-xs text-ink-600">{p.notes}</p> : null}
                    </div>
                    {c.canEdit ? (
                      <Button size="icon-sm" variant="ghost" aria-label="Remove preference" onClick={() => removePref.mutate(p.id)}>
                        <Trash2 />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-ink-500">No saved preferences.</p>
            )}
          </Card>
        </div>
      </div>
      {editing ? <EditCustomerDialog customer={c} onClose={() => setEditing(false)} onSaved={() => void q.refetch()} /> : null}
      <PreferenceDialog open={addingPref} onOpenChange={setAddingPref} customerId={c.id} onSaved={() => void q.refetch()} />
    </>
  );
}

function EditCustomerDialog({ customer, onClose, onSaved }: { customer: CustomerDetail; onClose: () => void; onSaved: () => void }) {
  const form = useForm<z.input<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    defaultValues: { fullName: customer.fullName, email: customer.email ?? '', alternatePhone: customer.alternatePhone ?? '', city: customer.city ?? '', occupation: customer.occupation ?? '', notes: customer.notes ?? '' },
  });
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.patch(`/crm/customers/${customer.id}`, { ...v, alternatePhone: v.alternatePhone || null, city: v.city || null, occupation: v.occupation || null, notes: v.notes || null });
      onSaved();
      onClose();
    } catch (err) {
      applyServerErrors(form, err);
    }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Edit customer" description="The mobile number identifies the customer and cannot be changed here.">
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="c-name" error={form.formState.errors.fullName?.message} className="sm:col-span-2">
            <Input id="c-name" {...form.register('fullName')} />
          </Field>
          <Field label="Email" htmlFor="c-email" error={form.formState.errors.email?.message}>
            <Input id="c-email" type="email" {...form.register('email')} />
          </Field>
          <Field label="Alternate phone" htmlFor="c-alt">
            <Input id="c-alt" {...form.register('alternatePhone')} />
          </Field>
          <Field label="City" htmlFor="c-city">
            <Input id="c-city" {...form.register('city')} />
          </Field>
          <Field label="Occupation" htmlFor="c-occ">
            <Input id="c-occ" {...form.register('occupation')} />
          </Field>
          <Field label="Notes" htmlFor="c-notes" className="sm:col-span-2">
            <Textarea id="c-notes" rows={3} {...form.register('notes')} />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PreferenceDialog({ open, onOpenChange, customerId, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; customerId: string; onSaved: () => void }) {
  const [listingType, setListingType] = React.useState('');
  const [segment, setSegment] = React.useState('');
  const [localities, setLocalities] = React.useState('');
  const [budgetMin, setBudgetMin] = React.useState('');
  const [budgetMax, setBudgetMax] = React.useState('');
  const [bedrooms, setBedrooms] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const mutate = useApiMutation(
    () =>
      api.post(`/crm/customers/${customerId}/preferences`, {
        listingType: listingType || null,
        segment: segment || null,
        localityNames: localities.split(',').map((s) => s.trim()).filter((s) => s.length >= 2),
        budgetMin: budgetMin ? Number(budgetMin) : null,
        budgetMax: budgetMax ? Number(budgetMax) : null,
        bedroomsMin: bedrooms ? Number(bedrooms) : null,
        notes: notes || null,
      }),
    {
      success: 'Preference saved',
      invalidate: ['/crm/customers'],
      onSuccess: () => {
        onOpenChange(false);
        onSaved();
      },
    },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add preference" description="What the customer is looking for — used by the team to shortlist options.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Looking to" htmlFor="p-lt">
            <Select id="p-lt" value={listingType} onChange={(e) => setListingType(e.target.value)}>
              <option value="">Any</option>
              <option value="SALE">Buy</option>
              <option value="RENT">Rent</option>
            </Select>
          </Field>
          <Field label="Segment" htmlFor="p-seg">
            <Select id="p-seg" value={segment} onChange={(e) => setSegment(e.target.value)}>
              <option value="">Any</option>
              {['RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL', 'AGRICULTURAL'].map((s) => (
                <option key={s} value={s}>
                  {enumLabel(s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Localities" htmlFor="p-loc" hint="Comma separated" className="sm:col-span-2">
            <Input id="p-loc" value={localities} onChange={(e) => setLocalities(e.target.value)} placeholder="Gomti Nagar, Indira Nagar" />
          </Field>
          <Field label="Budget from (₹)" htmlFor="p-bmin">
            <Input id="p-bmin" type="number" min={0} value={budgetMin} onChange={(e) => setBudgetMin(e.target.value)} />
          </Field>
          <Field label="Budget up to (₹)" htmlFor="p-bmax">
            <Input id="p-bmax" type="number" min={0} value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} />
          </Field>
          <Field label="Minimum bedrooms" htmlFor="p-bed">
            <Input id="p-bed" type="number" min={0} max={20} value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} />
          </Field>
          <Field label="Notes" htmlFor="p-notes" className="sm:col-span-2">
            <Textarea id="p-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={mutate.isPending} onClick={() => mutate.mutate(undefined)}>
            Save preference
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
