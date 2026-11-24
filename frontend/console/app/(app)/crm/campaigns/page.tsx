'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Megaphone, Pencil, Plus } from 'lucide-react';
import { CAMPAIGN_STATUSES, campaignSchema, enumLabel, formatDate, formatINR, leadSourceSchema } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, DialogContent, DialogFooter, EmptyState, Field, Input, PageHeader, Select, Skeleton, StatusBadge, Switch, Table, TBody, TD, TH, THead, TR, Textarea, toast } from '@estate/ui';
import { api } from '@/lib/api';
import { applyServerErrors, useApi, useApiMutation } from '@/lib/hooks';
import type { SourceOption } from '@/components/crm/pickers';

interface Campaign {
  id: string;
  name: string;
  code: string;
  channel: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  budget: number | null;
  notes: string | null;
  leads: number;
  converted: number;
  organization: { id: string; name: string };
}

export default function CampaignsPage() {
  const campaigns = useApi<Campaign[]>('/crm/campaigns');
  const sources = useApi<(SourceOption & { _count: { leads: number } })[]>('/crm/lead-sources');
  const [editing, setEditing] = React.useState<Campaign | 'new' | null>(null);
  const [newSource, setNewSource] = React.useState(false);
  const toggleSource = useApiMutation((s: SourceOption) => api.patch(`/crm/lead-sources/${s.id}`, { isActive: !s.isActive }), { success: 'Source updated', invalidate: ['/crm/lead-sources'] });

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Track which campaigns produce leads. Website enquiries carrying a matching utm_campaign code are attributed automatically."
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus /> New campaign
          </Button>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          {campaigns.isLoading ? (
            <CardBody>
              <Skeleton className="h-40 w-full" />
            </CardBody>
          ) : !campaigns.data?.length ? (
            <EmptyState icon={<Megaphone />} title="No campaigns yet" description="Create a campaign and use its code as utm_campaign in your ads." action={<Button size="sm" onClick={() => setEditing('new')}>New campaign</Button>} />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Campaign</TH>
                  <TH className="hidden md:table-cell">Channel</TH>
                  <TH className="hidden lg:table-cell">Dates</TH>
                  <TH align="right" className="hidden md:table-cell">
                    Budget
                  </TH>
                  <TH align="right">Leads</TH>
                  <TH align="right">Converted</TH>
                  <TH>Status</TH>
                  <TH align="right">
                    <span className="sr-only">Edit</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {campaigns.data.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <div className="font-medium text-ink-900">{c.name}</div>
                      <div className="tabular text-xs text-ink-500">{c.code}</div>
                    </TD>
                    <TD className="hidden md:table-cell">{c.channel}</TD>
                    <TD className="hidden whitespace-nowrap text-xs text-ink-500 lg:table-cell">
                      {c.startDate ? formatDate(c.startDate) : '—'} → {c.endDate ? formatDate(c.endDate) : 'open'}
                    </TD>
                    <TD align="right" className="tabular hidden md:table-cell">
                      {c.budget != null ? formatINR(c.budget) : '—'}
                    </TD>
                    <TD align="right" className="tabular">
                      <Link className="text-brand hover:underline" href={`/crm/leads?campaignId=${c.id}`}>
                        {c.leads}
                      </Link>
                    </TD>
                    <TD align="right" className="tabular">
                      {c.converted}
                    </TD>
                    <TD>
                      <StatusBadge status={c.status} />
                    </TD>
                    <TD align="right">
                      <Button size="icon-sm" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                        <Pencil />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card className="h-fit">
          <CardHeader
            title="Lead sources"
            description="System sources cannot be switched off."
            actions={
              <Button size="xs" variant="outline" onClick={() => setNewSource(true)}>
                <Plus /> Add
              </Button>
            }
          />
          <ul className="divide-y divide-line">
            {(sources.data ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate text-ink-900">{s.name}</span>
                  <span className="text-xs text-ink-500">
                    {s.key} · {s._count.leads} lead(s){s.isSystem ? ' · system' : ''}
                  </span>
                </span>
                {s.isSystem ? <Badge tone="neutral" size="sm">System</Badge> : <Switch checked={s.isActive} onCheckedChange={() => toggleSource.mutate(s)} aria-label={`${s.isActive ? 'Disable' : 'Enable'} ${s.name}`} />}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {editing ? <CampaignDialog campaign={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      <SourceDialog open={newSource} onOpenChange={setNewSource} />
    </>
  );
}

function CampaignDialog({ campaign, onClose }: { campaign: Campaign | null; onClose: () => void }) {
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<z.input<typeof campaignSchema>>({
    resolver: zodResolver(campaignSchema),
    defaultValues: campaign
      ? { name: campaign.name, code: campaign.code, channel: campaign.channel, status: campaign.status as never, startDate: campaign.startDate?.slice(0, 10) ?? '', endDate: campaign.endDate?.slice(0, 10) ?? '', budget: campaign.budget, notes: campaign.notes ?? '' }
      : { name: '', code: '', channel: '', status: 'ACTIVE', startDate: '', endDate: '', notes: '' },
  });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const body = { ...v, startDate: v.startDate || null, endDate: v.endDate || null, notes: v.notes || null };
      if (campaign) await api.patch(`/crm/campaigns/${campaign.id}`, body);
      else await api.post('/crm/campaigns', body);
      toast.success(campaign ? 'Campaign updated' : 'Campaign created');
      onClose();
    } catch (err) {
      if (!applyServerErrors(form, err)) setError(errorMessage(err));
    }
  });
  const e = form.formState.errors;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={campaign ? 'Edit campaign' : 'New campaign'}>
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          {error ? <Alert tone="danger" className="sm:col-span-2">{error}</Alert> : null}
          <Field label="Name" htmlFor="cp-name" required error={e.name?.message} className="sm:col-span-2">
            <Input id="cp-name" {...form.register('name')} />
          </Field>
          <Field label="Code (utm_campaign)" htmlFor="cp-code" required error={e.code?.message}>
            <Input id="cp-code" {...form.register('code')} />
          </Field>
          <Field label="Channel" htmlFor="cp-channel" required error={e.channel?.message}>
            <Input id="cp-channel" placeholder="e.g. Social media" {...form.register('channel')} />
          </Field>
          <Field label="Start date" htmlFor="cp-start" error={e.startDate?.message}>
            <Input id="cp-start" type="date" {...form.register('startDate')} />
          </Field>
          <Field label="End date" htmlFor="cp-end" error={e.endDate?.message}>
            <Input id="cp-end" type="date" {...form.register('endDate')} />
          </Field>
          <Field label="Budget (₹)" htmlFor="cp-budget">
            <Input id="cp-budget" type="number" min={0} {...form.register('budget', { setValueAs: (v) => (v === '' || v === null ? null : Number(v)) })} />
          </Field>
          <Field label="Status" htmlFor="cp-status">
            <Select id="cp-status" {...form.register('status')}>
              {CAMPAIGN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {enumLabel(s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes" htmlFor="cp-notes" className="sm:col-span-2">
            <Textarea id="cp-notes" rows={2} {...form.register('notes')} />
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

function SourceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const form = useForm<z.input<typeof leadSourceSchema>>({ resolver: zodResolver(leadSourceSchema), defaultValues: { key: '', name: '', isActive: true } });
  const create = useApiMutation((v: z.input<typeof leadSourceSchema>) => api.post('/crm/lead-sources', v), {
    success: 'Source added',
    invalidate: ['/crm/lead-sources'],
    onSuccess: () => {
      form.reset();
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add lead source">
        <form onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate className="grid gap-4">
          <Field label="Key" htmlFor="src-key" hint="Capital letters, numbers and underscores, e.g. PROPERTY_EXPO" error={form.formState.errors.key?.message}>
            <Input id="src-key" {...form.register('key')} />
          </Field>
          <Field label="Name" htmlFor="src-name" error={form.formState.errors.name?.message}>
            <Input id="src-name" {...form.register('name')} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Add source
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
