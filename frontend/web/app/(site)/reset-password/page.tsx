'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { passwordSchema } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Alert, Button, Field, Input } from '@estate/ui';
import { api } from '@/lib/api-browser';
import { AuthCard } from '@/components/auth/auth-card';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (!token) return <Alert tone="danger">This reset link is incomplete. Request a new one.</Alert>;
  if (done)
    return (
      <Alert tone="success" title="Password updated" action={<Link href="/login" className="text-sm font-medium text-brand-strong">Log in</Link>}>
        You have been signed out of other devices for your security.
      </Alert>
    );
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const check = passwordSchema.safeParse(password);
        if (!check.success) return setError(check.error.issues[0].message);
        if (password !== confirm) return setError('Passwords do not match');
        setBusy(true);
        try {
          await api.post('/auth/reset-password', { token, password });
          setDone(true);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="New password" htmlFor="password" hint="At least 10 characters with a letter and a number.">
        <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm">
        <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <Button type="submit" size="lg" loading={busy} className="w-full">
        Update password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthCard title="Choose a new password">
      <React.Suspense>
        <ResetForm />
      </React.Suspense>
    </AuthCard>
  );
}
