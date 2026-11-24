'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { customerRegisterSchema, type CustomerRegisterInput, type SessionUser } from '@estate/shared';
import { ApiError, errorMessage } from '@estate/api-client';
import { Alert, Button, CheckboxField, Field, Input } from '@estate/ui';
import { api } from '@/lib/api-browser';
import { AuthCard } from '@/components/auth/auth-card';

export default function RegisterPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<CustomerRegisterInput>({
    resolver: zodResolver(customerRegisterSchema),
    defaultValues: { fullName: '', email: '', phone: '', password: '', acceptTerms: undefined as unknown as true },
  });
  const e = form.formState.errors;
  return (
    <AuthCard
      title="Create your account"
      subtitle="Save properties, get alerts on your enquiries and book site visits faster."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-brand-strong hover:underline">
            Log in
          </Link>
          <span className="mx-2 text-ink-300">·</span>
          Listing property?{' '}
          <Link href="/partners/register" className="font-medium text-brand-strong hover:underline">
            Register as a partner
          </Link>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit(async (values) => {
          setError(null);
          try {
            const res = await api.post<{ user: SessionUser }>('/auth/register', values);
            qc.setQueryData(['me'], res.user);
            router.replace('/account?welcome=1');
          } catch (err) {
            if (err instanceof ApiError) for (const d of err.details) if (d.path) form.setError(d.path as keyof CustomerRegisterInput, { message: d.message });
            setError(errorMessage(err));
          }
        })}
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Full name" htmlFor="fullName" required error={e.fullName?.message}>
          <Input id="fullName" autoComplete="name" aria-invalid={Boolean(e.fullName)} {...form.register('fullName')} />
        </Field>
        <Field label="Email" htmlFor="email" required error={e.email?.message}>
          <Input id="email" type="email" autoComplete="email" aria-invalid={Boolean(e.email)} {...form.register('email')} />
        </Field>
        <Field label="Mobile number" htmlFor="phone" required error={e.phone?.message}>
          <Input id="phone" type="tel" autoComplete="tel" leading={<span className="text-[13px] text-ink-500">+91</span>} aria-invalid={Boolean(e.phone)} {...form.register('phone')} />
        </Field>
        <Field label="Password" htmlFor="password" required hint="At least 10 characters with a letter and a number." error={e.password?.message}>
          <Input id="password" type="password" autoComplete="new-password" aria-invalid={Boolean(e.password)} {...form.register('password')} />
        </Field>
        <Controller
          control={form.control}
          name="acceptTerms"
          render={({ field }) => (
            <div>
              <CheckboxField
                checked={field.value === true}
                onCheckedChange={(v) => field.onChange(v === true ? true : undefined)}
                label={
                  <>
                    I agree to the{' '}
                    <Link href="/terms-of-use" className="font-medium text-brand-strong hover:underline">
                      terms of use
                    </Link>{' '}
                    and{' '}
                    <Link href="/privacy-policy" className="font-medium text-brand-strong hover:underline">
                      privacy policy
                    </Link>
                  </>
                }
              />
              {e.acceptTerms ? <p className="mt-1 text-[12.5px] text-danger">{e.acceptTerms.message}</p> : null}
            </div>
          )}
        />
        <Button type="submit" size="lg" loading={form.formState.isSubmitting} className="mt-1 w-full">
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
