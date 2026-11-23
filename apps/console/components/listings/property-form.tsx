'use client';

import * as React from 'react';
import { useForm, Controller, type UseFormRegisterReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  AREA_UNITS,
  enumLabel,
  FACINGS,
  FORM_PROFILES,
  FURNISHINGS,
  OWNERSHIP_TYPES,
  POSSESSION_STATUSES,
  PROFILE_FIELDS,
  propertyBaseSchema,
  type FormProfileKey,
  type ProfileField,
} from '@estate/shared';
import { Alert, Button, Card, CardBody, CardHeader, Checkbox, CheckboxField, Field, Input, Segmented, Select, Textarea, cn } from '@estate/ui';
import { X } from 'lucide-react';
import { useApi, applyServerErrors } from '@/lib/hooks';
import { useSession } from '@/lib/session';

type FormValues = z.input<typeof propertyBaseSchema>;
type PropertyType = { id: string; segment: string; name: string; slug: string; formProfile: FormProfileKey; allowSale: boolean; allowRent: boolean };
type City = { id: string; name: string; slug: string };
type Locality = { id: string; name: string; slug: string };
type Amenity = { id: string; name: string; category: string };

const asNumber = { setValueAs: (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v)) };
const asNullable = { setValueAs: (v: unknown) => (v === '' || v === undefined ? null : v) };

const FIELD_META: Record<ProfileField, { label: string; kind: 'int' | 'decimal' | 'select' | 'bool' | 'text' | 'date'; options?: readonly string[]; unit?: string; hint?: string }> = {
  bedrooms: { label: 'Bedrooms', kind: 'int' },
  bathrooms: { label: 'Bathrooms', kind: 'int' },
  balconies: { label: 'Balconies', kind: 'int' },
  furnishing: { label: 'Furnishing', kind: 'select', options: FURNISHINGS },
  floorNumber: { label: 'Floor number', kind: 'int', hint: '0 for ground floor' },
  totalFloors: { label: 'Total floors', kind: 'int' },
  facing: { label: 'Facing', kind: 'select', options: FACINGS },
  possessionStatus: { label: 'Possession', kind: 'select', options: POSSESSION_STATUSES },
  availableFrom: { label: 'Available from', kind: 'date' },
  ageYears: { label: 'Age of property', kind: 'int', unit: 'years' },
  plotLengthFt: { label: 'Plot length', kind: 'decimal', unit: 'ft' },
  plotWidthFt: { label: 'Plot width', kind: 'decimal', unit: 'ft' },
  roadWidthFt: { label: 'Road width', kind: 'decimal', unit: 'ft' },
  isCornerPlot: { label: 'Corner plot', kind: 'bool' },
  ownershipType: { label: 'Ownership', kind: 'select', options: OWNERSHIP_TYPES },
  approvalAuthority: { label: 'Approval authority', kind: 'text', hint: 'e.g. development authority that approved the layout/map' },
  reraNumber: { label: 'RERA registration', kind: 'text' },
  coveredParking: { label: 'Covered parking', kind: 'int' },
  openParking: { label: 'Open parking', kind: 'int' },
  carpetAreaSqft: { label: 'Carpet area', kind: 'decimal', unit: 'sq.ft' },
  builtUpAreaSqft: { label: 'Built-up area', kind: 'decimal', unit: 'sq.ft' },
  superAreaSqft: { label: 'Super built-up area', kind: 'decimal', unit: 'sq.ft' },
  plotAreaSqft: { label: 'Plot area', kind: 'decimal', unit: 'sq.ft' },
};

export interface PropertyFormProps {
  mode: 'create' | 'edit';
  initial?: Partial<FormValues> & { amenityIds?: string[] };
  organizationOptions?: { id: string; name: string }[];
  submitting?: boolean;
  onSubmit: (values: Record<string, unknown>, opts: { submitForReview: boolean }) => Promise<unknown>;
  disabled?: boolean;
}

export function PropertyForm({ mode, initial, organizationOptions = [], submitting, onSubmit, disabled }: PropertyFormProps) {
  const { activeOrgId } = useSession();
  const types = useApi<PropertyType[]>('/public/property-types');
  const cities = useApi<City[]>('/public/cities');
  const amenities = useApi<Amenity[]>('/public/amenities', { for: 'property' });

  const form = useForm<FormValues>({
    resolver: zodResolver(propertyBaseSchema),
    defaultValues: {
      listingType: 'SALE',
      areaUnit: 'SQFT',
      priceNegotiable: false,
      hideExactLocation: false,
      attributes: {},
      highlights: [],
      amenityIds: [],
      organizationId: organizationOptions.length > 1 ? (activeOrgId ?? undefined) : undefined,
      ...initial,
    } as FormValues,
  });
  const { register, control, watch, setValue, formState } = form;
  const errors = formState.errors as Record<string, { message?: string } | undefined>;
  const listingType = watch('listingType');
  const typeId = watch('propertyTypeId');
  const cityId = watch('cityId');
  const selectedType = types.data?.find((t) => t.id === typeId);
  const profile = selectedType ? FORM_PROFILES[selectedType.formProfile] : null;
  const citySlug = cities.data?.find((c) => c.id === cityId)?.slug;
  const localities = useApi<Locality[]>(citySlug ? `/public/cities/${citySlug}/localities` : null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [highlight, setHighlight] = React.useState('');

  React.useEffect(() => {
    if (!cityId && cities.data?.length === 1) setValue('cityId', cities.data[0].id);
  }, [cities.data, cityId, setValue]);

  const groupedTypes = React.useMemo(() => {
    const groups = new Map<string, PropertyType[]>();
    for (const t of types.data ?? []) {
      if (listingType === 'RENT' ? !t.allowRent : !t.allowSale) continue;
      groups.set(t.segment, [...(groups.get(t.segment) ?? []), t]);
    }
    return [...groups.entries()];
  }, [types.data, listingType]);

  const amenityGroups = React.useMemo(() => {
    const g = new Map<string, Amenity[]>();
    for (const a of amenities.data ?? []) g.set(a.category, [...(g.get(a.category) ?? []), a]);
    return [...g.entries()];
  }, [amenities.data]);

  const submit = (submitForReview: boolean) =>
    form.handleSubmit(async (values) => {
      setFormError(null);
      const out: Record<string, unknown> = { ...values };
      // Clear fields that do not apply to the chosen category so they are never sent.
      if (profile) {
        for (const f of PROFILE_FIELDS) if (!profile.fields.includes(f)) out[f] = null;
        const allowed = new Set(profile.attributes.map((a) => a.key));
        out.attributes = Object.fromEntries(Object.entries((values.attributes ?? {}) as Record<string, unknown>).filter(([k, v]) => allowed.has(k) && v !== '' && v !== null && v !== undefined));
      }
      if (listingType === 'SALE') out.securityDeposit = null;
      if (!out.organizationId) delete out.organizationId;
      try {
        await onSubmit(out, { submitForReview });
      } catch (err) {
        if (!applyServerErrors(form, err)) setFormError(err instanceof Error ? err.message : 'Could not save the listing');
        else setFormError('Please correct the highlighted fields.');
      }
    })();

  const numberInput = (name: string, props: { unit?: string; step?: string; placeholder?: string } = {}) => (
    <Input
      id={name}
      type="number"
      inputMode="decimal"
      step={props.step ?? 'any'}
      placeholder={props.placeholder}
      trailing={props.unit ? <span className="text-xs">{props.unit}</span> : undefined}
      aria-invalid={Boolean(errors[name])}
      disabled={disabled}
      {...(register(name as never, asNumber) as UseFormRegisterReturn)}
    />
  );

  const profileField = (f: ProfileField) => {
    const meta = FIELD_META[f];
    const required = profile?.required.includes(f);
    const err = errors[f]?.message;
    let input: React.ReactNode;
    if (meta.kind === 'int' || meta.kind === 'decimal') input = numberInput(f, { unit: meta.unit, step: meta.kind === 'int' ? '1' : 'any' });
    else if (meta.kind === 'select')
      input = (
        <Select id={f} disabled={disabled} aria-invalid={Boolean(err)} {...register(f as never, asNullable)}>
          <option value="">Select</option>
          {meta.options!.map((o) => (
            <option key={o} value={o}>
              {enumLabel(o)}
            </option>
          ))}
        </Select>
      );
    else if (meta.kind === 'bool')
      input = (
        <Controller
          control={control}
          name={f as never}
          render={({ field }) => (
            <Segmented
              value={field.value === true ? 'yes' : field.value === false ? 'no' : ''}
              onChange={(v) => field.onChange(v === 'yes' ? true : v === 'no' ? false : null)}
              options={[
                { value: '', label: 'Not specified' },
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
              ]}
              size="sm"
            />
          )}
        />
      );
    else if (meta.kind === 'date') input = <Input id={f} type="date" disabled={disabled} {...register(f as never, asNullable)} />;
    else input = <Input id={f} disabled={disabled} aria-invalid={Boolean(err)} {...register(f as never, asNullable)} />;
    return (
      <Field key={f} label={meta.label} htmlFor={f} required={required} hint={meta.hint} error={err}>
        {input}
      </Field>
    );
  };

  const highlights = (watch('highlights') ?? []) as string[];

  return (
    <form onSubmit={(e) => e.preventDefault()} noValidate className="flex flex-col gap-5 pb-24">
      {formError ? <Alert tone="danger">{formError}</Alert> : null}

      <Card>
        <CardHeader title="Basics" description="What are you listing, and is it for sale or rent?" />
        <CardBody className="grid gap-5">
          {organizationOptions.length > 1 ? (
            <Field label="List under" htmlFor="organizationId" hint="The organisation that owns this listing">
              <Select id="organizationId" disabled={disabled || mode === 'edit'} {...register('organizationId', asNullable)}>
                {organizationOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Listing for" required>
            <Controller
              control={control}
              name="listingType"
              render={({ field }) => (
                <Segmented
                  value={field.value}
                  onChange={(v) => field.onChange(v)}
                  options={[
                    { value: 'SALE', label: 'Sale' },
                    { value: 'RENT', label: 'Rent / lease' },
                  ]}
                />
              )}
            />
          </Field>
          <Field label="Property type" htmlFor="propertyTypeId" required error={errors.propertyTypeId?.message}>
            <Controller
              control={control}
              name="propertyTypeId"
              render={({ field }) => (
                <Select id="propertyTypeId" disabled={disabled} aria-invalid={Boolean(errors.propertyTypeId)} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} onBlur={field.onBlur}>
                  <option value="">{types.isLoading ? 'Loading…' : 'Select property type'}</option>
                  {groupedTypes.map(([segment, list]) => (
                    <optgroup key={segment} label={enumLabel(segment)}>
                      {list.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              )}
            />
          </Field>
          <Field label="Title" htmlFor="title" required hint="e.g. “3 BHK apartment with park view in Gomti Nagar”" error={errors.title?.message}>
            <Input id="title" maxLength={140} disabled={disabled} aria-invalid={Boolean(errors.title)} {...register('title')} />
          </Field>
          <Field label="Description" htmlFor="description" required hint="Describe the property, condition, surroundings and anything a buyer should know." error={errors.description?.message}>
            <Textarea id="description" rows={6} maxLength={8000} disabled={disabled} aria-invalid={Boolean(errors.description)} {...register('description')} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Location" description="Exact address is optional and can be hidden from the public page." />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field label="City" htmlFor="cityId" required error={errors.cityId?.message}>
            <Controller
              control={control}
              name="cityId"
              render={({ field }) => (
                <Select
                  id="cityId"
                  disabled={disabled}
                  aria-invalid={Boolean(errors.cityId)}
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
                <Select id="localityId" disabled={disabled || !citySlug} aria-invalid={Boolean(errors.localityId)} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} onBlur={field.onBlur}>
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
          <Field label="Address" htmlFor="addressLine" className="sm:col-span-2" error={errors.addressLine?.message}>
            <Input id="addressLine" disabled={disabled} {...register('addressLine', asNullable)} />
          </Field>
          <Field label="Landmark" htmlFor="landmark">
            <Input id="landmark" disabled={disabled} {...register('landmark', asNullable)} />
          </Field>
          <Field label="PIN code" htmlFor="pincode" error={errors.pincode?.message}>
            <Input id="pincode" inputMode="numeric" maxLength={6} disabled={disabled} aria-invalid={Boolean(errors.pincode)} {...register('pincode', asNullable)} />
          </Field>
          <Field label="Latitude" htmlFor="latitude" hint="Optional — used for the map and nearby search" error={errors.latitude?.message}>
            {numberInput('latitude', { placeholder: '26.8467' })}
          </Field>
          <Field label="Longitude" htmlFor="longitude" error={errors.longitude?.message}>
            {numberInput('longitude', { placeholder: '80.9462' })}
          </Field>
          <div className="sm:col-span-2">
            <Controller
              control={control}
              name="hideExactLocation"
              render={({ field }) => (
                <CheckboxField checked={Boolean(field.value)} onCheckedChange={(v) => field.onChange(Boolean(v))} label="Hide the exact address on the public page" description="Only the locality and an approximate map area are shown." disabled={disabled} />
              )}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Area & price" />
        <CardBody className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Area" htmlFor="area" required error={errors.area?.message}>
            {numberInput('area')}
          </Field>
          <Field label="Area unit" htmlFor="areaUnit" required>
            <Select id="areaUnit" disabled={disabled} {...register('areaUnit')}>
              {AREA_UNITS.map((u) => (
                <option key={u} value={u}>
                  {enumLabel(u)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={listingType === 'RENT' ? 'Monthly rent (₹)' : 'Price (₹)'} htmlFor="price" required error={errors.price?.message}>
            {numberInput('price', { step: '1' })}
          </Field>
          {listingType === 'RENT' ? (
            <Field label="Security deposit (₹)" htmlFor="securityDeposit" error={errors.securityDeposit?.message}>
              {numberInput('securityDeposit', { step: '1' })}
            </Field>
          ) : (
            <Field label="Booking / token amount (₹)" htmlFor="bookingAmount" error={errors.bookingAmount?.message}>
              {numberInput('bookingAmount', { step: '1' })}
            </Field>
          )}
          <Field label="Maintenance per month (₹)" htmlFor="maintenanceMonthly" error={errors.maintenanceMonthly?.message}>
            {numberInput('maintenanceMonthly', { step: '1' })}
          </Field>
          <div className="flex items-end pb-2">
            <Controller control={control} name="priceNegotiable" render={({ field }) => <CheckboxField checked={Boolean(field.value)} onCheckedChange={(v) => field.onChange(Boolean(v))} label="Price is negotiable" disabled={disabled} />} />
          </div>
        </CardBody>
      </Card>

      {profile ? (
        <Card>
          <CardHeader title={`${selectedType?.name} details`} description={profile.description} />
          <CardBody className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {profile.fields.map((f) => profileField(f))}
            {profile.attributes.map((a) => {
              const name = `attributes.${a.key}`;
              const err = (formState.errors.attributes as Record<string, { message?: string }> | undefined)?.[a.key]?.message;
              return (
                <Field key={a.key} label={a.label} htmlFor={name} error={err}>
                  {a.kind === 'select' ? (
                    <Select id={name} disabled={disabled} {...register(name as never, asNullable)}>
                      <option value="">Select</option>
                      {a.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  ) : a.kind === 'boolean' ? (
                    <Controller
                      control={control}
                      name={name as never}
                      render={({ field }) => (
                        <Segmented
                          value={field.value === true ? 'yes' : field.value === false ? 'no' : ''}
                          onChange={(v) => field.onChange(v === 'yes' ? true : v === 'no' ? false : undefined)}
                          options={[
                            { value: '', label: '—' },
                            { value: 'yes', label: 'Yes' },
                            { value: 'no', label: 'No' },
                          ]}
                          size="sm"
                        />
                      )}
                    />
                  ) : a.kind === 'number' ? (
                    numberInput(name, { unit: a.unit })
                  ) : (
                    <Input id={name} disabled={disabled} {...register(name as never)} />
                  )}
                </Field>
              );
            })}
          </CardBody>
        </Card>
      ) : (
        <Alert tone="info">Choose a property type to see the details that apply to it.</Alert>
      )}

      <Card>
        <CardHeader title="Amenities & highlights" />
        <CardBody className="grid gap-6">
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
          <Field label="Highlights" hint="Short selling points shown as bullet points (up to 12)." error={errors.highlights?.message}>
            <div className="flex gap-2">
              <Input
                value={highlight}
                onChange={(e) => setHighlight(e.target.value)}
                placeholder="e.g. East-facing with morning sunlight"
                disabled={disabled || highlights.length >= 12}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (highlight.trim().length >= 2) {
                      setValue('highlights', [...highlights, highlight.trim()]);
                      setHighlight('');
                    }
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={disabled || highlight.trim().length < 2 || highlights.length >= 12}
                onClick={() => {
                  setValue('highlights', [...highlights, highlight.trim()]);
                  setHighlight('');
                }}
              >
                Add
              </Button>
            </div>
            {highlights.length ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {highlights.map((h, i) => (
                  <li key={`${h}-${i}`} className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 py-1 pl-3 pr-1.5 text-[13px] text-ink-800">
                    {h}
                    <button
                      type="button"
                      aria-label={`Remove ${h}`}
                      disabled={disabled}
                      className="rounded-full p-0.5 text-ink-500 hover:bg-ink-200 hover:text-ink-900"
                      onClick={() =>
                        setValue(
                          'highlights',
                          highlights.filter((_, j) => j !== i),
                        )
                      }
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Owner contact (private)" description="Never shown publicly. Used by your team and our verification staff only." />
        <CardBody className="grid gap-5 sm:grid-cols-3">
          <Field label="Owner name" htmlFor="ownerName">
            <Input id="ownerName" disabled={disabled} {...register('ownerName', asNullable)} />
          </Field>
          <Field label="Owner phone" htmlFor="ownerPhone">
            <Input id="ownerPhone" inputMode="tel" disabled={disabled} {...register('ownerPhone', asNullable)} />
          </Field>
          <Field label="Owner email" htmlFor="ownerEmail" error={errors.ownerEmail?.message}>
            <Input id="ownerEmail" type="email" disabled={disabled} {...register('ownerEmail', asNullable)} />
          </Field>
        </CardBody>
      </Card>

      {!disabled ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur lg:left-64">
          <div className="mx-auto flex max-w-[1320px] items-center justify-end gap-2 px-4 py-3 lg:px-8">
            {mode === 'create' ? (
              <>
                <Button variant="outline" loading={submitting} onClick={() => void submit(false)}>
                  Save as draft
                </Button>
                <Button loading={submitting} onClick={() => void submit(true)}>
                  Save & add photos
                </Button>
              </>
            ) : (
              <Button loading={submitting} onClick={() => void submit(false)}>
                Save changes
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </form>
  );
}
