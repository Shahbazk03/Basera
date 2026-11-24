'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { loginSchema, type LoginInput } from '@estate/shared';
import { ApiError, errorMessage } from '@estate/api-client';
import { Alert, Button, Field, Input } from '@estate/ui';
import { api } from '@/lib/api';
import { AuthLayout } from '@/components/auth-layout';

function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/';
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);
  const [show, setShow] = React.useState(false);
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

  const onSubmit = form.handleSubmit(async (values) => {
    const attempt = `${values.identifier.trim().toLowerCase()}\n${values.password}`;
    if (inFlight.current) return;
    if (lastRejected.current?.attempt === attempt && Date.now() - lastRejected.current.at < 30_000) {
      setError('That email/mobile and password were just rejected. Check the password (is Caps Lock on?) or use “Forgot password?”.');
      return;
    }
    inFlight.current = true;
    setError(null);
    try {
      await api.post('/auth/login', values);
      await qc.invalidateQueries({ queryKey: ['session'] });
      router.replace(safeNext(params.get('next')));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_CREDENTIALS') lastRejected.current = { attempt, at: Date.now() };
      setError(errorMessage(err));
    } finally {
      inFlight.current = false;
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="Email or mobile number" htmlFor="identifier" error={form.formState.errors.identifier?.message}>
        <Input id="identifier" autoComplete="username" autoFocus leading={<Mail />} aria-invalid={Boolean(form.formState.errors.identifier)} {...form.register('identifier')} />
      </Field>
      <Field
        label={
          <span className="flex w-full items-center justify-between">
            Password
            <Link href="/forgot-password" className="text-[13px] font-medium text-brand hover:underline">
              Forgot password?
            </Link>
          </span>
        }
        htmlFor="password"
        error={form.formState.errors.password?.message}
      >
        <Input
          id="password"
          type={show ? 'text' : 'password'}
          autoComplete="current-password"
          leading={<Lock />}
          trailing={
            <button type="button" onClick={() => setShow((s) => !s)} className="pointer-events-auto text-ink-400 hover:text-ink-700" aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff /> : <Eye />}
            </button>
          }
          aria-invalid={Boolean(form.formState.errors.password)}
          {...form.register('password')}
        />
      </Field>
      <Button type="submit" size="lg" loading={form.formState.isSubmitting} className="mt-1 w-full">
        Sign in
      </Button>
    </form>
  );
}

export default function LoginPage() {
  const webUrl = process.env.NEXT_PUBLIC_WEB_URL ?? '';
  return (
    <AuthLayout
      title="Sign in to the console"
      subtitle="For staff, brokers, developers and lead partners."
      footer={
        <>
          New broker, builder or property owner?{' '}
          <a href={`${webUrl}/partners/register`} className="font-medium text-brand hover:underline">
            Register as a partner
          </a>
        </>
      }
    >
      <React.Suspense>
        <LoginForm />
      </React.Suspense>
    </AuthLayout>
  );
}
