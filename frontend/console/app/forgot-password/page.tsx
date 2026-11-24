'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail } from 'lucide-react';
import { forgotPasswordSchema } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Alert, Button, Field, Input } from '@estate/ui';
import { api } from '@/lib/api';
import { AuthLayout } from '@/components/auth-layout';

export default function ForgotPasswordPage() {
  const [done, setDone] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<z.input<typeof forgotPasswordSchema>>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } });
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api.post<{ message: string }>('/auth/forgot-password', { ...values, app: 'console' });
      setDone(res.message);
    } catch (err) {
      setError(errorMessage(err));
    }
  });
  return (
    <AuthLayout title="Reset your password" subtitle="We will email you a link to choose a new password." footer={<Link href="/login" className="font-medium text-brand hover:underline">Back to sign in</Link>}>
      {done ? (
        <Alert tone="success" title="Check your inbox">
          {done}
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" leading={<Mail />} aria-invalid={Boolean(form.formState.errors.email)} {...form.register('email')} />
          </Field>
          <Button type="submit" size="lg" loading={form.formState.isSubmitting} className="w-full">
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
