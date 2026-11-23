'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ChevronLeft, CreditCard, Pencil, Plus } from 'lucide-react';
import { BILLING_PERIODS, enumLabel, formatINR, subscriptionPlanSchema } from '@estate/shared';
import { Badge, Button, Card, CheckboxField, Dialog, DialogContent, DialogFooter, Field, Input, PageHeader, Select, Table, TBody, TD, TH, THead, TR, Textarea } from '@estate/ui';
import { api } from '@/lib/api';
import { applyServerErrors, useApi, useApiMutation } from '@/lib/hooks';
import { QueryState } from '@/components/query-state';

interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price: number;
  billingPeriod: string;
  listingQuota: number | null;
  featuredQuota: number | null;
  features: string[];
  isActive: boolean;
  sortOrder: number;
  _count: { subscriptions: number };
}

type FormValues = z.input<typeof subscriptionPlanSchema>;
const num = { setValueAs: (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v)) };

export default function PlansPage() {
  const q = useApi<Plan[]>('/partners/plans');
  const [editing, setEditing] = React.useState<Plan | 'new' | null>(null);
  return (
    <>
      <PageHeader
        breadcrumbs={
          <Link href="/partners" className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
            <ChevronLeft className="size-4" /> Partners
          </Link>
        }
        title="Subscription plans"
        description="Plans brokers can be placed on. Prices and quotas are configured here — nothing is hard-coded. Quotas are enforced only when “Enforce listing quotas” is on in Settings."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> New plan
          </Button>
        }
      />
      <Card>
        <QueryState query={q} isEmpty={(d) => d.length === 0} empty={{ icon: <CreditCard />, title: 'No plans yet', description: 'Create a plan before assigning subscriptions to brokers.', action: <Button size="sm" onClick={() => setEditing('new')}><Plus /> New plan</Button> }}>
          {(plans) => (
            <Table>
              <THead>
                <tr>
                  <TH>Plan</TH>
                  <TH align="right">Price</TH>
                  <TH className="hidden md:table-cell">Quotas</TH>
                  <TH className="hidden md:table-cell" align="right">
                    Active subscribers
                  </TH>
                  <TH>Status</TH>
                  <TH align="right">
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {plans.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <div className="font-medium text-ink-900">{p.name}</div>
                      <div className="text-xs text-ink-500">{p.code}</div>
                    </TD>
                    <TD align="right" className="tabular">
                      {formatINR(p.price)}
                      <div className="text-xs text-ink-500">{enumLabel(p.billingPeriod).toLowerCase()}</div>
                    </TD>
                    <TD className="hidden text-xs text-ink-600 md:table-cell">
                      {p.listingQuota === null ? 'Unlimited listings' : `${p.listingQuota} live listings`}
                      <br />
                      {p.featuredQuota === null ? 'Unlimited featured' : `${p.featuredQuota} featured`}
                    </TD>
                    <TD align="right" className="tabular hidden md:table-cell">
                      {p._count.subscriptions}
                    </TD>
                    <TD>{p.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</TD>
                    <TD align="right">
                      <Button size="xs" variant="ghost" onClick={() => setEditing(p)}>
                        <Pencil /> Edit
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </QueryState>
      </Card>
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        {editing ? <PlanForm plan={editing === 'new' ? null : editing} onDone={() => setEditing(null)} /> : null}
      </Dialog>
    </>
  );
}

function PlanForm({ plan, onDone }: { plan: Plan | null; onDone: () => void }) {
  const form = useForm<FormValues>({
    resolver: zodResolver(subscriptionPlanSchema),
    defaultValues: plan
      ? { code: plan.code, name: plan.name, description: plan.description, price: plan.price, billingPeriod: plan.billingPeriod as FormValues['billingPeriod'], listingQuota: plan.listingQuota, featuredQuota: plan.featuredQuota, features: plan.features, isActive: plan.isActive, sortOrder: plan.sortOrder }
      : { code: '', name: '', billingPeriod: 'MONTHLY', features: [], isActive: true, sortOrder: 0 },
  });
  const [features, setFeatures] = React.useState((plan?.features ?? []).join('\n'));
  const save = useApiMutation(
    (values: Record<string, unknown>) => (plan ? api.patch(`/partners/plans/${plan.id}`, values) : api.post('/partners/plans', values)),
    { success: plan ? 'Plan updated' : 'Plan created', invalidate: ['/partners/plans'], onSuccess: onDone, silent: true },
  );
  const e = form.formState.errors;
  return (
    <DialogContent title={plan ? `Edit ${plan.name}` : 'New subscription plan'} size="lg">
      <form
        noValidate
        onSubmit={form.handleSubmit(async (v) => {
          try {
            await save.mutateAsync({ ...v, features: features.split('\n').map((f) => f.trim()).filter((f) => f.length >= 2) });
          } catch (err) {
            if (!applyServerErrors(form, err)) form.setError('root', { message: err instanceof Error ? err.message : 'Could not save' });
          }
        })}
        className="grid gap-4 sm:grid-cols-2"
      >
        {form.formState.errors.root ? <p className="text-sm text-danger sm:col-span-2">{form.formState.errors.root.message}</p> : null}
        <Field label="Name" htmlFor="name" required error={e.name?.message}>
          <Input id="name" {...form.register('name')} />
        </Field>
        <Field label="Code" htmlFor="code" required hint="Uppercase identifier, e.g. BROKER_PRO" error={e.code?.message}>
          <Input id="code" {...form.register('code')} />
        </Field>
        <Field label="Price (₹)" htmlFor="price" required error={e.price?.message}>
          <Input id="price" type="number" step="1" {...form.register('price')} />
        </Field>
        <Field label="Billing period" htmlFor="billingPeriod" required>
          <Select id="billingPeriod" {...form.register('billingPeriod')}>
            {BILLING_PERIODS.map((b) => (
              <option key={b} value={b}>
                {enumLabel(b)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Live listing quota" htmlFor="listingQuota" hint="Leave blank for unlimited" error={e.listingQuota?.message}>
          <Input id="listingQuota" type="number" {...form.register('listingQuota', num)} />
        </Field>
        <Field label="Featured listing quota" htmlFor="featuredQuota" hint="Leave blank for unlimited" error={e.featuredQuota?.message}>
          <Input id="featuredQuota" type="number" {...form.register('featuredQuota', num)} />
        </Field>
        <Field label="Description" htmlFor="description" className="sm:col-span-2">
          <Textarea id="description" rows={2} {...form.register('description')} />
        </Field>
        <Field label="Features" htmlFor="features" hint="One per line" className="sm:col-span-2">
          <Textarea id="features" rows={3} value={features} onChange={(ev) => setFeatures(ev.target.value)} />
        </Field>
        <Field label="Display order" htmlFor="sortOrder">
          <Input id="sortOrder" type="number" {...form.register('sortOrder')} />
        </Field>
        <div className="flex items-end pb-2">
          <Controller control={form.control} name="isActive" render={({ field }) => <CheckboxField checked={Boolean(field.value)} onCheckedChange={(v) => field.onChange(Boolean(v))} label="Available for new subscriptions" />} />
        </div>
        <div className="sm:col-span-2">
          <DialogFooter>
            <Button variant="outline" type="button" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {plan ? 'Save changes' : 'Create plan'}
            </Button>
          </DialogFooter>
        </div>
      </form>
    </DialogContent>
  );
}
