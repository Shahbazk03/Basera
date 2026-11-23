'use client';

import * as React from 'react';
import Link from 'next/link';
import { errorMessage } from '@estate/api-client';
import { Alert, Button, Field, Input } from '@estate/ui';
import { api } from '@/lib/api-browser';
import { AuthCard } from '@/components/auth/auth-card';

export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <AuthCard title="Forgot your password?" subtitle="Enter your account email and we will send you a reset link." footer={<Link href="/login" className="font-medium text-brand-strong hover:underline">Back to log in</Link>}>
      {done ? (
        <Alert tone="success" title="Check your inbox">
          {done}
        </Alert>
      ) : (
        <form
          className="flex flex-col gap-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const res = await api.post<{ message: string }>('/auth/forgot-password', { email, app: 'web' });
              setDone(res.message);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label="Email" htmlFor="email" required>
            <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" size="lg" loading={busy} className="w-full">
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
