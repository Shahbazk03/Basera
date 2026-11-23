'use client';

import * as React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, MessageCircle } from 'lucide-react';
import { enquirySchema, PREFERRED_TIME_SLOTS, type EnquiryInput, type EnquiryReceipt, type EnquiryType } from '@estate/shared';
import { ApiError, errorMessage } from '@estate/api-client';
import { Alert, Button, Checkbox, cn, Field, Input, Select, Textarea } from '@estate/ui';
import { api } from '@/lib/api-browser';
import { useCurrentUser } from '@/lib/session';
import { captchaEnabled, Turnstile } from './turnstile';

export interface EnquiryTarget {
  propertyId?: string;
  projectId?: string;
  unitId?: string;
}

export interface EnquiryFormProps extends EnquiryTarget {
  type: EnquiryType;
  submitLabel?: string;
  /** Hide email and message (short callback forms). */
  compact?: boolean;
  messagePlaceholder?: string;
  defaultMessage?: string;
  tone?: 'light' | 'dark';
  onSuccess?: (receipt: EnquiryReceipt) => void;
  className?: string;
}

function attribution() {
  if (typeof window === 'undefined') return {};
  const q = new URLSearchParams(window.location.search);
  const clip = (v: string | null, n: number) => (v ? v.slice(0, n) : undefined);
  return {
    sourcePage: window.location.pathname.slice(0, 500),
    utmSource: clip(q.get('utm_source'), 100),
    utmMedium: clip(q.get('utm_medium'), 100),
    utmCampaign: clip(q.get('utm_campaign'), 100),
    referrer: clip(document.referrer || null, 500),
  };
}

function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

/**
 * Public enquiry form → POST /api/v1/public/enquiries. Every submission becomes a CRM lead with a
 * reference number. Spam protection: honeypot field, minimum fill time, rate limiting server-side
 * and optional Cloudflare Turnstile.
 */
export function EnquiryForm({ type, propertyId, projectId, unitId, submitLabel, compact, messagePlaceholder, defaultMessage, tone = 'light', onSuccess, className }: EnquiryFormProps) {
  const { data: user } = useCurrentUser();
  const startedAt = React.useRef(Date.now());
  const [receipt, setReceipt] = React.useState<EnquiryReceipt | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [captcha, setCaptcha] = React.useState<string | null>(null);
  const dark = tone === 'dark';

  const form = useForm<EnquiryInput>({
    resolver: zodResolver(enquirySchema),
    defaultValues: { type, name: '', phone: '', email: '', message: defaultMessage ?? '', propertyId, projectId, unitId, website: '', consent: undefined as unknown as true },
  });
  const { register, formState, setValue } = form;
  const errors = formState.errors;

  React.useEffect(() => {
    if (!user) return;
    if (!form.getValues('name')) setValue('name', user.fullName);
    if (!form.getValues('phone') && user.phone) setValue('phone', user.phone);
    if (!form.getValues('email') && user.email) setValue('email', user.email);
  }, [user, form, setValue]);

  React.useEffect(() => {
    setValue('type', type);
    setValue('unitId', unitId);
  }, [type, unitId, setValue]);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    if (captchaEnabled() && !captcha) {
      setError('Please complete the verification check.');
      return;
    }
    try {
      const res = await api.post<EnquiryReceipt>('/public/enquiries', {
        ...values,
        email: values.email || undefined,
        preferredDate: values.preferredDate || undefined,
        formStartedAt: startedAt.current,
        captchaToken: captcha ?? undefined,
        ...attribution(),
      });
      setReceipt(res);
      onSuccess?.(res);
      if (res.whatsappUrl) window.open(res.whatsappUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      if (err instanceof ApiError && err.details.length) {
        for (const d of err.details) if (d.path) form.setError(d.path as keyof EnquiryInput, { message: d.message });
      }
      setError(errorMessage(err, 'We could not send your enquiry. Please try again.'));
    }
  });

  if (receipt) {
    return (
      <div className={cn('rounded-lg p-5 text-center', dark ? 'bg-white/5 text-white' : 'bg-success-soft', className)} role="status">
        <CheckCircle2 className={cn('mx-auto size-8', dark ? 'text-white' : 'text-success')} />
        <p className={cn('mt-3 font-semibold', dark ? 'text-white' : 'text-ink-900')}>Thank you — we have your request</p>
        <p className={cn('mt-1 text-sm', dark ? 'text-white/75' : 'text-ink-600')}>{receipt.message}</p>
        <p className={cn('mt-3 text-sm', dark ? 'text-white/75' : 'text-ink-600')}>
          Reference <span className={cn('tabular font-semibold', dark ? 'text-white' : 'text-ink-900')}>{receipt.referenceNo}</span>
        </p>
        {receipt.whatsappUrl ? (
          <Button asChild variant="whatsapp" className="mt-4">
            <a href={receipt.whatsappUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle /> Continue on WhatsApp
            </a>
          </Button>
        ) : null}
      </div>
    );
  }

  const labelCls = dark ? '[&_label]:text-white/85' : '';
  return (
    <form onSubmit={onSubmit} noValidate className={cn('flex flex-col gap-3.5', labelCls, className)}>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden>
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" {...register('website')} />
        </label>
      </div>
      <div className={cn('grid gap-3.5', !compact && 'sm:grid-cols-2')}>
        <Field label="Your name" htmlFor={`name-${type}`} required error={errors.name?.message}>
          <Input id={`name-${type}`} autoComplete="name" aria-invalid={Boolean(errors.name)} {...register('name')} />
        </Field>
        <Field label="Mobile number" htmlFor={`phone-${type}`} required error={errors.phone?.message}>
          <Input id={`phone-${type}`} type="tel" inputMode="tel" autoComplete="tel" placeholder="10-digit mobile" leading={<span className="text-[13px] text-ink-500">+91</span>} aria-invalid={Boolean(errors.phone)} {...register('phone')} />
        </Field>
      </div>
      {!compact ? (
        <Field label="Email" htmlFor={`email-${type}`} error={errors.email?.message}>
          <Input id={`email-${type}`} type="email" autoComplete="email" aria-invalid={Boolean(errors.email)} {...register('email')} />
        </Field>
      ) : null}
      {type === 'SITE_VISIT' ? (
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Preferred date" htmlFor="preferredDate" required error={errors.preferredDate?.message}>
            <Input id="preferredDate" type="date" min={todayIso()} aria-invalid={Boolean(errors.preferredDate)} {...register('preferredDate')} />
          </Field>
          <Field label="Preferred time" htmlFor="preferredTimeSlot">
            <Select id="preferredTimeSlot" {...register('preferredTimeSlot', { setValueAs: (v) => v || undefined })}>
              <option value="">Any time</option>
              {Object.entries(PREFERRED_TIME_SLOTS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}
      {!compact ? (
        <Field label="Message" htmlFor={`message-${type}`} error={errors.message?.message}>
          <Textarea id={`message-${type}`} rows={3} placeholder={messagePlaceholder ?? 'Tell us what you are looking for'} {...register('message')} />
        </Field>
      ) : null}
      <Controller
        control={form.control}
        name="consent"
        render={({ field }) => (
          <div className="flex items-start gap-2.5">
            <Checkbox id={`consent-${type}`} checked={field.value === true} onCheckedChange={(v) => field.onChange(v === true ? true : undefined)} className="mt-0.5" />
            <label htmlFor={`consent-${type}`} className={cn('text-[12.5px] leading-snug', dark ? 'text-white/70' : 'text-ink-600')}>
              I agree to be contacted by phone, WhatsApp or email about this enquiry.
              {errors.consent ? <span className="mt-1 block text-danger">{errors.consent.message}</span> : null}
            </label>
          </div>
        )}
      />
      <Turnstile onToken={setCaptcha} />
      <Button type="submit" size="lg" variant={type === 'WHATSAPP' ? 'whatsapp' : 'primary'} loading={formState.isSubmitting} className="w-full">
        {type === 'WHATSAPP' ? <MessageCircle /> : null}
        {submitLabel ?? 'Send enquiry'}
      </Button>
    </form>
  );
}
