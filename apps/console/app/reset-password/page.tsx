'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { passwordSchema } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Alert, Button, Field, Input } from '@estate/ui';
import { api } from '@/lib/api';
import { AuthLayout } from '@/components/auth-layout';

const schema = z.object({ password: passwordSchema, confirm: z.string() }).refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = React.useState<'idle' | 'done'>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<z.input<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });
  if (!token) return <Alert tone="danger">This reset link is incomplete. Request a new one from the sign-in page.</Alert>;
  if (state === 'done')
    return (
      <Alert tone="success" title="Password updated" action={<Link href="/login" className="text-sm font-medium text-brand">Sign in</Link>}>
        All other sessions were signed out for your security.
      </Alert>
    );
  return (
    <form
      onSubmit={form.handleSubmit(async (v) => {
        setError(null);
        try {
          await api.post('/auth/reset-password', { token, password: v.password });
          setState('done');
        } catch (err) {
          setError(errorMessage(err));
        }
      })}
      noValidate
      className="flex flex-col gap-5"
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="New password" htmlFor="password" hint="At least 10 characters with a letter and a number." error={form.formState.errors.password?.message}>
        <Input id="password" type="password" autoComplete="new-password" aria-invalid={Boolean(form.formState.errors.password)} {...form.register('password')} />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm" error={form.formState.errors.confirm?.message}>
        <Input id="confirm" type="password" autoComplete="new-password" aria-invalid={Boolean(form.formState.errors.confirm)} {...form.register('confirm')} />
      </Field>
      <Button type="submit" size="lg" loading={form.formState.isSubmitting} className="w-full">
        Update password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthLayout title="Choose a new password">
      <React.Suspense>
        <ResetForm />
      </React.Suspense>
    </AuthLayout>
  );
}
