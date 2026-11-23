'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Send, Upload } from 'lucide-react';
import { LEAD_IMPORT_COLUMNS, phoneSchema } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, PageHeader, Select, Skeleton, Stat, Textarea } from '@estate/ui';
import { api } from '@/lib/api';
import { applyServerErrors, useApi } from '@/lib/hooks';
import { CsvImportDialog } from '@/components/crm/dialogs';
import { useProjectOptions } from '@/components/crm/pickers';

interface Profile {
  name: string;
  status: string;
  organizationStatus: string;
  duplicateWindowDays: number;
  canSubmit: boolean;
}
interface Stats {
  submitted: number;
  accepted: number;
  duplicate: number;
  rejected: number;
  pending: number;
  converted: number;
}

const form = z.object({
  name: z.string().trim().min(2, 'Enter the customer’s name').max(100),
  phone: phoneSchema,
  email: z.email('Enter a valid email').optional().or(z.literal('')),
  projectId: z.string().optional(),
  listingType: z.string().optional(),
  budgetMin: z.number().min(0).optional().nullable(),
  budgetMax: z.number().min(0).optional().nullable(),
  locationPreference: z.string().max(300).optional(),
  requirement: z.string().max(2000).optional(),
  externalRef: z.string().max(80).optional(),
});
const num = { setValueAs: (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v)) };

export default function ProviderSubmitPage() {
  const profile = useApi<Profile>('/provider/profile');
  const stats = useApi<Stats>('/provider/stats');
  const projects = useProjectOptions();
  const [result, setResult] = React.useState<{ leadNo: string; intakeStatus: string; message: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  const f = useForm<z.input<typeof form>>({ resolver: zodResolver(form), defaultValues: { name: '', phone: '', email: '', projectId: '', listingType: '', locationPreference: '', requirement: '', externalRef: '' } });

  const submit = f.handleSubmit(async (v) => {
    setError(null);
    setResult(null);
    try {
      const res = await api.post<{ leadNo: string; intakeStatus: string; message: string }>('/provider/leads', {
        name: v.name,
        phone: v.phone,
        email: v.email || '',
        projectId: v.projectId || null,
        listingType: v.listingType || null,
        budgetMin: v.budgetMin ?? null,
        budgetMax: v.budgetMax ?? null,
        locationPreference: v.locationPreference || null,
        requirement: v.requirement || null,
        externalRef: v.externalRef || null,
      });
      setResult(res);
      f.reset();
      void stats.refetch();
    } catch (err) {
      if (!applyServerErrors(f, err)) setError(errorMessage(err));
    }
  });

  const disabled = profile.data ? !profile.data.canSubmit : true;
  const e = f.formState.errors;
  return (
    <>
      <PageHeader
        title="Submit leads"
        description="Leads are checked for duplicates against our pipeline. Duplicates are recorded on your statement but are not counted for commission."
        actions={
          <>
            <Button variant="outline" size="sm" disabled={disabled} onClick={() => setImportOpen(true)}>
              <Upload /> Import CSV
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/provider/leads">My leads</Link>
            </Button>
          </>
        }
      />
      {profile.isLoading ? (
        <Skeleton className="mb-5 h-14 w-full" />
      ) : profile.data && !profile.data.canSubmit ? (
        <Alert tone="warning" className="mb-5" title={profile.data.organizationStatus === 'PENDING' ? 'Account awaiting activation' : 'Account suspended'}>
          {profile.data.organizationStatus === 'PENDING' ? 'Our partner team will activate your account after reviewing your details. You will receive an email when you can start submitting leads.' : 'Lead submission is paused for your account. Please contact our partner team.'}
        </Alert>
      ) : profile.isError ? (
        <Alert tone="danger" className="mb-5">
          {errorMessage(profile.error)}
        </Alert>
      ) : null}
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Submitted" value={stats.data?.submitted ?? '—'} />
        <Stat label="Accepted" value={stats.data?.accepted ?? '—'} />
        <Stat label="Under review" value={stats.data?.pending ?? '—'} />
        <Stat label="Duplicates" value={stats.data?.duplicate ?? '—'} />
        <Stat label="Converted" value={stats.data?.converted ?? '—'} tone="success" />
      </div>
      <Card className="max-w-3xl">
        <CardHeader title="New lead" description={profile.data ? `Duplicate window: ${profile.data.duplicateWindowDays} days` : undefined} />
        <CardBody>
          {result ? (
            <Alert tone={result.intakeStatus === 'ACCEPTED' ? 'success' : result.intakeStatus === 'DUPLICATE' ? 'warning' : 'info'} className="mb-5">
              {result.message}
            </Alert>
          ) : null}
          {error ? (
            <Alert tone="danger" className="mb-5">
              {error}
            </Alert>
          ) : null}
          <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer name" htmlFor="pv-name" required error={e.name?.message}>
              <Input id="pv-name" disabled={disabled} {...f.register('name')} aria-invalid={Boolean(e.name)} />
            </Field>
            <Field label="Mobile number" htmlFor="pv-phone" required error={e.phone?.message}>
              <Input id="pv-phone" inputMode="tel" disabled={disabled} {...f.register('phone')} aria-invalid={Boolean(e.phone)} />
            </Field>
            <Field label="Email" htmlFor="pv-email" error={e.email?.message}>
              <Input id="pv-email" type="email" disabled={disabled} {...f.register('email')} />
            </Field>
            <Field label="Your reference" htmlFor="pv-ref" hint="Optional — your own ID for this lead">
              <Input id="pv-ref" disabled={disabled} {...f.register('externalRef')} />
            </Field>
            <Field label="Interested in project" htmlFor="pv-project">
              <Select id="pv-project" disabled={disabled} {...f.register('projectId')}>
                <option value="">Not a specific project</option>
                {projects.options.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Looking to" htmlFor="pv-lt">
              <Select id="pv-lt" disabled={disabled} {...f.register('listingType')}>
                <option value="">Not specified</option>
                <option value="SALE">Buy</option>
                <option value="RENT">Rent</option>
              </Select>
            </Field>
            <Field label="Budget from (₹)" htmlFor="pv-bmin">
              <Input id="pv-bmin" type="number" min={0} disabled={disabled} {...f.register('budgetMin', num)} />
            </Field>
            <Field label="Budget up to (₹)" htmlFor="pv-bmax">
              <Input id="pv-bmax" type="number" min={0} disabled={disabled} {...f.register('budgetMax', num)} />
            </Field>
            <Field label="Preferred location" htmlFor="pv-loc" className="sm:col-span-2">
              <Input id="pv-loc" disabled={disabled} {...f.register('locationPreference')} />
            </Field>
            <Field label="Requirement" htmlFor="pv-req" hint="Leads with a project or requirement are accepted straight away; others are reviewed first." className="sm:col-span-2">
              <Textarea id="pv-req" rows={3} disabled={disabled} {...f.register('requirement')} />
            </Field>
            <div className="flex justify-end sm:col-span-2">
              <Button type="submit" disabled={disabled} loading={f.formState.isSubmitting}>
                <Send /> Submit lead
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        endpoint="/provider/leads/import"
        title="Import leads from CSV"
        description="Preview the file first. Each row is checked for duplicates; an optional external_ref column is stored as your reference."
        columns={[...LEAD_IMPORT_COLUMNS, 'external_ref']}
        onDone={() => void stats.refetch()}
      />
    </>
  );
}
