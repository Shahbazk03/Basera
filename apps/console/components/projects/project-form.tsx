'use client';

import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { enumLabel, PROJECT_TYPES, projectBaseSchema, slugify } from '@estate/shared';
import { Alert, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Select, Switch, Textarea, cn } from '@estate/ui';
import { applyServerErrors, useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { SingleImageField } from './single-image-field';
import { fromLocalInput, toLocalInput } from './types';

type FormValues = z.input<typeof projectBaseSchema>;
type City = { id: string; name: string; slug: string };
type Locality = { id: string; name: string };
type Amenity = { id: string; name: string; category: string };

const asNumber = { setValueAs: (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v)) };
const asNullable = { setValueAs: (v: unknown) => (v === '' || v === undefined ? null : v) };

export function ProjectForm({
  mode,
  initial,
  organizationOptions = [],
  disabled,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  initial?: Partial<FormValues>;
  organizationOptions?: { id: string; name: string }[];
  disabled?: boolean;
  onSubmit: (values: Record<string, unknown>) => Promise<unknown>;
}) {
  const { activeOrgId } = useSession();
  const cities = useApi<City[]>('/public/cities');
  const amenities = useApi<Amenity[]>('/public/amenities', { for: 'project' });
  const developers = useApi<{ id: string; name: string }[]>('/projects/options/developers');
  const form = useForm<FormValues>({
    resolver: zodResolver(projectBaseSchema),
    defaultValues: { projectType: 'RESIDENTIAL_PLOTS', autoStatus: true, closingSoonHours: 72, videoUrls: [], amenityIds: [], organizationId: organizationOptions.length > 1 ? (activeOrgId ?? organizationOptions[0]?.id) : undefined, ...initial } as FormValues,
  });
  const { register, control, watch, setValue, formState } = form;
  const errors = formState.errors as Record<string, { message?: string } | undefined>;
  const cityId = watch('cityId');
  const name = watch('name');
  const slug = watch('slug');
  const autoStatus = watch('autoStatus');
  const orgId = watch('organizationId') ?? initial?.organizationId ?? activeOrgId;
  const citySlug = cities.data?.find((c) => c.id === cityId)?.slug;
  const localities = useApi<Locality[]>(citySlug ? `/public/cities/${citySlug}/localities` : null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const webUrl = process.env.NEXT_PUBLIC_WEB_URL ?? '';
  // When the managing organisation is itself a developer, it is the developer of record.
  const isOrgDeveloper = Boolean(orgId && developers.data?.some((d) => d.id === orgId));

  React.useEffect(() => {
    if (!cityId && cities.data?.length === 1) setValue('cityId', cities.data[0].id);
  }, [cities.data, cityId, setValue]);

  const amenityGroups = React.useMemo(() => {
    const g = new Map<string, Amenity[]>();
    for (const a of amenities.data ?? []) g.set(a.category, [...(g.get(a.category) ?? []), a]);
    return [...g.entries()];
  }, [amenities.data]);

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    setSubmitting(true);
    const out: Record<string, unknown> = { ...values };
    if (!out.slug) delete out.slug;
    if (!out.organizationId) delete out.organizationId;
    try {
      await onSubmit(out);
    } catch (err) {
      setFormError(applyServerErrors(form, err) ? 'Please correct the highlighted fields.' : err instanceof Error ? err.message : 'Could not save the project');
    } finally {
      setSubmitting(false);
    }
  });

  const num = (field: string, opts: { unit?: string; step?: string } = {}) => (
    <Input id={field} type="number" inputMode="decimal" step={opts.step ?? 'any'} disabled={disabled} trailing={opts.unit ? <span className="text-xs">{opts.unit}</span> : undefined} aria-invalid={Boolean(errors[field])} {...register(field as never, asNumber)} />
  );

  return (
    <form onSubmit={(e) => e.preventDefault()} noValidate className="flex flex-col gap-5 pb-24">
      {formError ? <Alert tone="danger">{formError}</Alert> : null}

      <Card>
        <CardHeader title="Project basics" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          {organizationOptions.length > 1 ? (
            <Field label="Managed by" htmlFor="organizationId" hint="The organisation that owns and sells this project" className="sm:col-span-2">
              <Select id="organizationId" disabled={disabled || mode === 'edit'} {...register('organizationId', asNullable)}>
                {organizationOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Project name" htmlFor="name" required error={errors.name?.message}>
            <Input id="name" disabled={disabled} aria-invalid={Boolean(errors.name)} {...register('name')} />
          </Field>
          <Field label="Project type" htmlFor="projectType" required>
            <Select id="projectType" disabled={disabled} {...register('projectType')}>
              {PROJECT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {enumLabel(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Web address" htmlFor="slug" hint={`${webUrl}/projects/${slug || slugify(name ?? '') || 'project-name'}`} error={errors.slug?.message}>
            <Input id="slug" placeholder="Generated from the name" disabled={disabled} aria-invalid={Boolean(errors.slug)} {...register('slug', { setValueAs: (v: string) => (v ? v : undefined) })} />
          </Field>
          {!isOrgDeveloper ? (
            <Field label="Developer" htmlFor="developerOrgId" hint="The builder of the project, shown on the project page">
              <Select id="developerOrgId" disabled={disabled} {...register('developerOrgId', asNullable)}>
                <option value="">Not specified</option>
                {(developers.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Tagline" htmlFor="tagline" hint="One line shown under the project name" className="sm:col-span-2" error={errors.tagline?.message}>
            <Input id="tagline" maxLength={160} disabled={disabled} {...register('tagline', asNullable)} />
          </Field>
          <Field label="Description" htmlFor="description" required className="sm:col-span-2" error={errors.description?.message}>
            <Textarea id="description" rows={7} disabled={disabled} aria-invalid={Boolean(errors.description)} {...register('description')} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Location" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field label="City" htmlFor="cityId" required error={errors.cityId?.message}>
            <Controller
              control={control}
              name="cityId"
              render={({ field }) => (
                <Select
                  id="cityId"
                  disabled={disabled}
                  value={(field.value as string) ?? ''}
                  onBlur={field.onBlur}
                  onChange={(e) => {
                    field.onChange(e.target.value);
                    setValue('localityId', '' as never);
                  }}
                >
                  <option value="">{cities.isLoading ? 'Loading…' : 'Select city'}</option>
                  {(cities.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            />
          </Field>
          <Field label="Locality" htmlFor="localityId" required error={errors.localityId?.message}>
            <Controller
              control={control}
              name="localityId"
              render={({ field }) => (
                <Select id="localityId" disabled={disabled || !citySlug} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} onBlur={field.onBlur}>
                  <option value="">{!citySlug ? 'Select a city first' : localities.isLoading ? 'Loading…' : 'Select locality'}</option>
                  {(localities.data ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              )}
            />
          </Field>
          <Field label="Address" htmlFor="addressLine" className="sm:col-span-2">
            <Input id="addressLine" disabled={disabled} {...register('addressLine', asNullable)} />
          </Field>
          <Field label="PIN code" htmlFor="pincode" error={errors.pincode?.message}>
            <Input id="pincode" inputMode="numeric" maxLength={6} disabled={disabled} {...register('pincode', asNullable)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude" htmlFor="latitude" error={errors.latitude?.message}>
              {num('latitude')}
            </Field>
            <Field label="Longitude" htmlFor="longitude" error={errors.longitude?.message}>
              {num('longitude')}
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Images & video" description="The hero image leads the project page and search cards. Gallery photos are managed in the Media tab." />
        <CardBody className="grid gap-6 lg:grid-cols-3">
          <Field label="Hero image" error={errors.heroImageUrl?.message}>
            <Controller control={control} name="heroImageUrl" render={({ field }) => <SingleImageField value={field.value as string | null} onChange={field.onChange} organizationId={orgId} disabled={disabled} />} />
          </Field>
          <Field label="Master plan" error={errors.masterPlanUrl?.message}>
            <Controller control={control} name="masterPlanUrl" render={({ field }) => <SingleImageField value={field.value as string | null} onChange={field.onChange} organizationId={orgId} disabled={disabled} aspect="aspect-[4/3]" />} />
          </Field>
          <Field label="Project logo" error={errors.logoUrl?.message}>
            <Controller control={control} name="logoUrl" render={({ field }) => <SingleImageField value={field.value as string | null} onChange={field.onChange} organizationId={orgId} disabled={disabled} aspect="aspect-[3/1]" />} />
          </Field>
          <Field label="Video links" hint="YouTube or Vimeo links, one per line" className="lg:col-span-3" error={errors.videoUrls?.message}>
            <Controller
              control={control}
              name="videoUrls"
              render={({ field }) => (
                <Textarea
                  rows={3}
                  disabled={disabled}
                  defaultValue={((field.value as string[]) ?? []).join('\n')}
                  onBlur={(e) => field.onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
                />
              )}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Key facts" description="Shown on the project page. Leave the price range empty to derive it from released inventory." />
        <CardBody className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Total land area" htmlFor="totalAreaAcres" error={errors.totalAreaAcres?.message}>
            {num('totalAreaAcres', { unit: 'acres' })}
          </Field>
          <Field label="Total units planned" htmlFor="totalUnitsPlanned" error={errors.totalUnitsPlanned?.message}>
            {num('totalUnitsPlanned', { step: '1' })}
          </Field>
          <Field label="Launch date" htmlFor="launchDate">
            <Input id="launchDate" type="date" disabled={disabled} {...register('launchDate', asNullable)} />
          </Field>
          <Field label="Possession date" htmlFor="possessionDate">
            <Input id="possessionDate" type="date" disabled={disabled} {...register('possessionDate', asNullable)} />
          </Field>
          <Field label="Price from (₹)" htmlFor="priceMinOverride" hint="Used until units are released" error={errors.priceMinOverride?.message}>
            {num('priceMinOverride', { step: '1' })}
          </Field>
          <Field label="Price up to (₹)" htmlFor="priceMaxOverride" error={errors.priceMaxOverride?.message}>
            {num('priceMaxOverride', { step: '1' })}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Approvals & legal" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field label="RERA registration number" htmlFor="reraNumber">
            <Input id="reraNumber" disabled={disabled} {...register('reraNumber', asNullable)} />
          </Field>
          <Field label="RERA valid until" htmlFor="reraValidUntil">
            <Input id="reraValidUntil" type="date" disabled={disabled} {...register('reraValidUntil', asNullable)} />
          </Field>
          <Field label="Approval details" htmlFor="approvalDetails" className="sm:col-span-2" hint="e.g. the authority that approved the layout or building plan">
            <Input id="approvalDetails" disabled={disabled} {...register('approvalDetails', asNullable)} />
          </Field>
          <Field label="Legal information" htmlFor="legalInformation" className="sm:col-span-2">
            <Textarea id="legalInformation" rows={4} disabled={disabled} {...register('legalInformation', asNullable)} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Booking window" description="With automatic status on, the server moves the project through Upcoming → Booking open → Closing soon → Closed (or Sold out) from these times and the live inventory." />
        <CardBody className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
            <Controller control={control} name="autoStatus" render={({ field }) => <Switch id="autoStatus" checked={Boolean(field.value)} onCheckedChange={field.onChange} disabled={disabled} />} />
            <label htmlFor="autoStatus" className="text-sm text-ink-800">
              Automatic status from booking window and inventory
            </label>
          </div>
          <Field label="Booking opens" htmlFor="bookingOpensAt" error={errors.bookingOpensAt?.message}>
            <Controller
              control={control}
              name="bookingOpensAt"
              render={({ field }) => <Input id="bookingOpensAt" type="datetime-local" disabled={disabled} value={toLocalInput(field.value as string | null)} onChange={(e) => field.onChange(fromLocalInput(e.target.value))} />}
            />
          </Field>
          <Field label="Booking closes" htmlFor="bookingClosesAt" error={errors.bookingClosesAt?.message}>
            <Controller
              control={control}
              name="bookingClosesAt"
              render={({ field }) => <Input id="bookingClosesAt" type="datetime-local" disabled={disabled} value={toLocalInput(field.value as string | null)} onChange={(e) => field.onChange(fromLocalInput(e.target.value))} />}
            />
          </Field>
          <Field label="“Closing soon” starts" htmlFor="closingSoonHours" hint="Hours before closing" error={errors.closingSoonHours?.message}>
            <Input id="closingSoonHours" type="number" min={1} disabled={disabled || !autoStatus} trailing={<span className="text-xs">hours</span>} {...register('closingSoonHours', { setValueAs: (v) => (v === '' ? undefined : Number(v)) })} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Sales contact" description="Numbers are never shown publicly — WhatsApp opens only after a visitor shares their details." />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field label="WhatsApp number" htmlFor="whatsappNumber">
            <Input id="whatsappNumber" inputMode="tel" disabled={disabled} {...register('whatsappNumber', asNullable)} />
          </Field>
          <Field label="Sales phone" htmlFor="salesPhone">
            <Input id="salesPhone" inputMode="tel" disabled={disabled} {...register('salesPhone', asNullable)} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Amenities" />
        <CardBody>
          <Controller
            control={control}
            name="amenityIds"
            render={({ field }) => {
              const selected = new Set((field.value ?? []) as string[]);
              return (
                <div className="grid gap-5">
                  {amenityGroups.map(([category, list]) => (
                    <fieldset key={category}>
                      <legend className="mb-2 text-[12.5px] font-medium text-ink-500">{category}</legend>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {list.map((a) => (
                          <label key={a.id} className={cn('flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors', selected.has(a.id) ? 'border-brand bg-brand-soft text-ink-900' : 'border-line hover:border-ink-300')}>
                            <Checkbox
                              checked={selected.has(a.id)}
                              disabled={disabled}
                              onCheckedChange={(v) => {
                                const next = new Set(selected);
                                if (v) next.add(a.id);
                                else next.delete(a.id);
                                field.onChange([...next]);
                              }}
                            />
                            {a.name}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </div>
              );
            }}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Search engines & sharing" />
        <CardBody className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
          <div className="grid gap-5">
            <Field label="SEO title" htmlFor="seoTitle" hint="Up to 70 characters" error={errors.seoTitle?.message}>
              <Input id="seoTitle" maxLength={70} disabled={disabled} {...register('seoTitle', asNullable)} />
            </Field>
            <Field label="SEO description" htmlFor="seoDescription" hint="Up to 170 characters" error={errors.seoDescription?.message}>
              <Textarea id="seoDescription" rows={3} maxLength={170} disabled={disabled} {...register('seoDescription', asNullable)} />
            </Field>
          </div>
          <Field label="Social sharing image">
            <Controller control={control} name="ogImageUrl" render={({ field }) => <SingleImageField value={field.value as string | null} onChange={field.onChange} organizationId={orgId} disabled={disabled} />} />
          </Field>
        </CardBody>
      </Card>

      {!disabled ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur lg:left-64">
          <div className="mx-auto flex max-w-[1320px] items-center justify-end gap-2 px-4 py-3 lg:px-8">
            <Button loading={submitting} onClick={() => void submit()}>
              {mode === 'create' ? 'Create project' : 'Save changes'}
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
