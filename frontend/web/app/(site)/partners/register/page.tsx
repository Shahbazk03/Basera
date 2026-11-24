'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Building2, CheckCircle2, Home, Network } from 'lucide-react';
import { leadProviderRegisterSchema, partnerRegisterSchema, type SessionUser } from '@estate/shared';
import { ApiError, errorMessage } from '@estate/api-client';
import { Alert, Button, CheckboxField, cn, Field, Input, RadioCard, RadioGroup, Select, Textarea } from '@estate/ui';
import { api } from '@/lib/api-browser';
import { consoleUrl } from '@/lib/session';

type PartnerKind = 'BROKERAGE' | 'DEVELOPER' | 'INDIVIDUAL_OWNER' | 'LEAD_PROVIDER';

const KINDS: { value: PartnerKind; title: string; text: string; icon: React.ReactNode }[] = [
  { value: 'BROKERAGE', title: 'Broker or agency', text: 'List and manage properties for your clients', icon: <Briefcase className="size-5" /> },
  { value: 'DEVELOPER', title: 'Builder / developer', text: 'Showcase projects with live inventory', icon: <Building2 className="size-5" /> },
  { value: 'INDIVIDUAL_OWNER', title: 'Property owner', text: 'Sell or rent your own property', icon: <Home className="size-5" /> },
  { value: 'LEAD_PROVIDER', title: 'Lead partner', text: 'Refer buyers and track commissions', icon: <Network className="size-5" /> },
];

type Values = Record<string, string | boolean | undefined>;

function Form() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const initial = (params.get('type') as PartnerKind | null) ?? 'BROKERAGE';
  const [kind, setKind] = React.useState<PartnerKind>(KINDS.some((k) => k.value === initial) ? initial : 'BROKERAGE');
  const [values, setValues] = React.useState<Values>({ acceptTerms: false });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<SessionUser | null>(null);
  const cities = useQuery({ queryKey: ['cities'], queryFn: () => api.get<{ id: string; name: string }[]>('/public/cities') });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));
  const err = (k: string) => errors[k];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setErrors({});
    const isProvider = kind === 'LEAD_PROVIDER';
    const payload = isProvider
      ? { fullName: values.fullName, email: values.email, phone: values.phone, password: values.password, organizationName: values.organizationName }
      : { ...values, partnerType: kind, acceptTerms: values.acceptTerms === true ? true : undefined, experienceYears: values.experienceYears ? Number(values.experienceYears) : undefined };
    const parsed = (isProvider ? leadProviderRegisterSchema : partnerRegisterSchema).safeParse(payload);
    if (!parsed.success) {
      const map: Record<string, string> = {};
      for (const i of parsed.error.issues) map[i.path.join('.')] ??= i.message;
      setErrors(map);
      setError('Please correct the highlighted fields.');
      return;
    }
    if (isProvider && values.acceptTerms !== true) {
      setErrors({ acceptTerms: 'Accept the partner terms to continue' });
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ user: SessionUser }>(isProvider ? '/auth/register/lead-provider' : '/auth/register/partner', parsed.data);
      qc.setQueryData(['me'], res.user);
      setDone(res.user);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e2) {
      if (e2 instanceof ApiError) setErrors(e2.fieldErrors());
      setError(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
        <CheckCircle2 className="mx-auto size-10 text-success" />
        <h2 className="mt-4 text-[22px] font-bold text-ink-900">Registration received</h2>
        <p className="mx-auto mt-2 max-w-md text-[15px] text-ink-600">
          Your account is created and your organisation is <strong>awaiting verification</strong>. Upload your business documents from the console — our partner team reviews them and you will be notified by email. Listings can be prepared now and go live once you are verified.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <a href={consoleUrl('/')}>Open partner console</a>
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Back to the website</Link>
          </Button>
        </div>
      </div>
    );
  }

  const business = kind === 'BROKERAGE' || kind === 'DEVELOPER';
  return (
    <form onSubmit={submit} noValidate className="rounded-2xl border border-line bg-surface p-6 shadow-card md:p-8">
      {error ? <Alert tone="danger" className="mb-6">{error}</Alert> : null}
      <fieldset>
        <legend className="text-[15px] font-semibold text-ink-900">I am a…</legend>
        <RadioGroup value={kind} onValueChange={(v) => setKind(v as PartnerKind)} className="mt-3 grid gap-3 sm:grid-cols-2">
          {KINDS.map((k) => (
            <RadioCard key={k.value} value={k.value} className="items-start">
              <span className={cn('grid size-10 shrink-0 place-items-center rounded-lg', kind === k.value ? 'bg-brand text-white' : 'bg-ink-100 text-ink-600')}>{k.icon}</span>
              <span>
                <span className="block font-semibold text-ink-900">{k.title}</span>
                <span className="block text-[13px] text-ink-500">{k.text}</span>
              </span>
            </RadioCard>
          ))}
        </RadioGroup>
      </fieldset>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <h3 className="text-[15px] font-semibold text-ink-900 sm:col-span-2">Your details</h3>
        <Field label="Full name" htmlFor="fullName" required error={err('fullName')}>
          <Input id="fullName" autoComplete="name" onChange={set('fullName')} aria-invalid={Boolean(err('fullName'))} />
        </Field>
        <Field label="Mobile number" htmlFor="phone" required error={err('phone')}>
          <Input id="phone" type="tel" autoComplete="tel" leading={<span className="text-[13px] text-ink-500">+91</span>} onChange={set('phone')} aria-invalid={Boolean(err('phone'))} />
        </Field>
        <Field label="Email" htmlFor="email" required error={err('email')}>
          <Input id="email" type="email" autoComplete="email" onChange={set('email')} aria-invalid={Boolean(err('email'))} />
        </Field>
        <Field label="Password" htmlFor="password" required hint="At least 10 characters with a letter and a number." error={err('password')}>
          <Input id="password" type="password" autoComplete="new-password" onChange={set('password')} aria-invalid={Boolean(err('password'))} />
        </Field>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <h3 className="text-[15px] font-semibold text-ink-900 sm:col-span-2">{kind === 'INDIVIDUAL_OWNER' ? 'Your address' : 'Business details'}</h3>
        {kind !== 'INDIVIDUAL_OWNER' ? (
          <Field label={kind === 'DEVELOPER' ? 'Company name' : 'Business / agency name'} htmlFor="organizationName" required error={err('organizationName')} className="sm:col-span-2">
            <Input id="organizationName" onChange={set('organizationName')} aria-invalid={Boolean(err('organizationName'))} />
          </Field>
        ) : null}
        {kind !== 'LEAD_PROVIDER' ? (
          <>
            <Field label={kind === 'INDIVIDUAL_OWNER' ? 'Address' : 'Business address'} htmlFor="businessAddress" required error={err('businessAddress')} className="sm:col-span-2">
              <Input id="businessAddress" onChange={set('businessAddress')} aria-invalid={Boolean(err('businessAddress'))} />
            </Field>
            <Field label="City" htmlFor="cityId" required error={err('cityId')}>
              <Select id="cityId" defaultValue="" onChange={set('cityId')} aria-invalid={Boolean(err('cityId'))}>
                <option value="">Select city</option>
                {(cities.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="PIN code" htmlFor="pincode" error={err('pincode')}>
              <Input id="pincode" inputMode="numeric" maxLength={6} onChange={set('pincode')} aria-invalid={Boolean(err('pincode'))} />
            </Field>
          </>
        ) : null}
        {business ? (
          <>
            <Field label={kind === 'DEVELOPER' ? 'RERA promoter registration' : 'RERA agent registration'} htmlFor="reraNumber" error={err('reraNumber')}>
              <Input id="reraNumber" onChange={set('reraNumber')} />
            </Field>
            <Field label="GSTIN" htmlFor="gstin" error={err('gstin')}>
              <Input id="gstin" maxLength={15} onChange={set('gstin')} aria-invalid={Boolean(err('gstin'))} />
            </Field>
            {kind === 'BROKERAGE' ? (
              <Field label="Years of experience" htmlFor="experienceYears" error={err('experienceYears')}>
                <Input id="experienceYears" type="number" min={0} max={70} onChange={set('experienceYears')} />
              </Field>
            ) : null}
            <Field label="Website" htmlFor="website" error={err('website')}>
              <Input id="website" type="url" placeholder="https://" onChange={set('website')} aria-invalid={Boolean(err('website'))} />
            </Field>
            <Field label="About your business" htmlFor="about" className="sm:col-span-2">
              <Textarea id="about" rows={3} maxLength={2000} onChange={set('about')} />
            </Field>
          </>
        ) : null}
      </div>

      <div className="mt-6">
        <CheckboxField
          checked={values.acceptTerms === true}
          onCheckedChange={(v) => setValues((s) => ({ ...s, acceptTerms: v === true }))}
          label={
            <>
              I confirm the information is accurate and agree to the{' '}
              <Link href="/terms-of-use" className="font-medium text-brand-strong hover:underline">
                terms of use
              </Link>{' '}
              and{' '}
              <Link href="/listing-guidelines" className="font-medium text-brand-strong hover:underline">
                listing guidelines
              </Link>
              .
            </>
          }
        />
        {err('acceptTerms') ? <p className="mt-1 text-[12.5px] text-danger">{err('acceptTerms')}</p> : null}
      </div>
      <Button type="submit" size="lg" loading={busy} className="mt-6 w-full sm:w-auto">
        Create partner account
      </Button>
      <p className="mt-3 text-xs text-ink-500">Every partner is verified by our team before listings or leads go live.</p>
    </form>
  );
}

export default function PartnerRegisterPage() {
  return (
    <div className="bg-canvas">
      <div className="container-page grid gap-10 py-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] lg:py-16">
        <div className="lg:pt-4">
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-brand-strong">Partner programme</p>
          <h1 className="mt-3 text-[30px] font-bold leading-tight text-ink-900 md:text-[36px]">Grow your real estate business with us</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-600">One account for listings, project inventory, leads, site visits and commission statements.</p>
          <ol className="mt-8 space-y-5">
            {[
              ['Register', 'Create your account in a couple of minutes.'],
              ['Get verified', 'Upload business documents; our partner team reviews them.'],
              ['Publish & respond', 'Listings go live after review. Enquiries arrive as leads in your console.'],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-4">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink-900 text-sm font-semibold text-white">{i + 1}</span>
                <span>
                  <span className="block font-semibold text-ink-900">{t}</span>
                  <span className="text-sm text-ink-500">{d}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-8 text-sm text-ink-500">
            Already registered?{' '}
            <a href={consoleUrl('/login')} className="font-medium text-brand-strong hover:underline">
              Log in to the console
            </a>
          </p>
        </div>
        <React.Suspense>
          <Form />
        </React.Suspense>
      </div>
    </div>
  );
}
