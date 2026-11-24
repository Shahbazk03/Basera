'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { loginSchema, type LoginInput, type SessionUser } from '@estate/shared';
import { ApiError, errorMessage } from '@estate/api-client';
import { Alert, Button, Field, Input } from '@estate/ui';
import { api } from '@/lib/api-browser';
import { consoleUrl } from '@/lib/session';
import { AuthCard, safeNext } from '@/components/auth/auth-card';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { identifier: '', password: '' } });
  // Every rejected attempt counts towards the temporary lock, so pressing Enter again (or holding it)
  // must not resend credentials the server has just rejected, nor send a second request in flight.
  const inFlight = React.useRef(false);
  const lastRejected = React.useRef<{ attempt: string; at: number } | null>(null);
  // Editing either field (or waiting) allows the same pair again — the password may have been reset meanwhile.
  React.useEffect(() => {
    const sub = form.watch(() => {
      lastRejected.current = null;
    });
    return () => sub.unsubscribe();
  }, [form]);
  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={form.handleSubmit(async (values) => {
        const attempt = `${values.identifier.trim().toLowerCase()}\n${values.password}`;
        if (inFlight.current) return;
        if (lastRejected.current?.attempt === attempt && Date.now() - lastRejected.current.at < 30_000) {
          setError('That email/mobile and password were just rejected. Check the password (is Caps Lock on?) or use “Forgot password?”.');
          return;
        }
        inFlight.current = true;
        setError(null);
        try {
          const res = await api.post<{ user: SessionUser }>('/auth/login', values);
          qc.setQueryData(['me'], res.user);
          await qc.invalidateQueries({ queryKey: ['favourites'] });
          router.replace(safeNext(params.get('next')));
          router.refresh();
        } catch (err) {
          if (err instanceof ApiError && err.code === 'INVALID_CREDENTIALS') lastRejected.current = { attempt, at: Date.now() };
          setError(errorMessage(err));
        } finally {
          inFlight.current = false;
        }
      })}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="Email or mobile number" htmlFor="identifier" error={form.formState.errors.identifier?.message}>
        <Input id="identifier" autoComplete="username" autoFocus aria-invalid={Boolean(form.formState.errors.identifier)} {...form.register('identifier')} />
      </Field>
      <Field
        label={
          <span className="flex w-full justify-between">
            Password
            <Link href="/forgot-password" className="text-[13px] font-medium text-brand-strong hover:underline">
              Forgot password?
            </Link>
          </span>
        }
        htmlFor="password"
        error={form.formState.errors.password?.message}
      >
        <Input id="password" type="password" autoComplete="current-password" aria-invalid={Boolean(form.formState.errors.password)} {...form.register('password')} />
      </Field>
      <Button type="submit" size="lg" loading={form.formState.isSubmitting} className="w-full">
        Log in
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthCard
      title="Welcome back"
      subtitle="Log in to save properties and track your enquiries."
      footer={
        <div className="space-y-2">
          <p>
            New here?{' '}
            <Link href="/register" className="font-medium text-brand-strong hover:underline">
              Create an account
            </Link>
          </p>
          <p>
            Broker, builder or staff?{' '}
            <a href={consoleUrl('/login')} className="font-medium text-brand-strong hover:underline">
              Log in to the console
            </a>
          </p>
        </div>
      }
    >
      <React.Suspense>
        <LoginForm />
      </React.Suspense>
    </AuthCard>
  );
}
