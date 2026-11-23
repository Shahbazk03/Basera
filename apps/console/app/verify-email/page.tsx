'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { errorMessage } from '@estate/api-client';
import { Alert, Spinner } from '@estate/ui';
import { api } from '@/lib/api';
import { AuthLayout } from '@/components/auth-layout';

function Verify() {
  const token = useSearchParams().get('token');
  const [state, setState] = React.useState<{ status: 'loading' | 'ok' | 'error'; message?: string }>({ status: 'loading' });
  React.useEffect(() => {
    if (!token) {
      setState({ status: 'error', message: 'This verification link is incomplete.' });
      return;
    }
    api
      .post('/auth/verify-email', { token })
      .then(() => setState({ status: 'ok' }))
      .catch((err) => setState({ status: 'error', message: errorMessage(err) }));
  }, [token]);
  if (state.status === 'loading') return <Spinner label="Verifying" />;
  if (state.status === 'ok')
    return (
      <Alert tone="success" title="Email verified" action={<Link href="/" className="text-sm font-medium text-brand">Continue</Link>}>
        Thank you — your email address is confirmed.
      </Alert>
    );
  return <Alert tone="danger">{state.message}</Alert>;
}

export default function VerifyEmailPage() {
  return (
    <AuthLayout title="Email verification">
      <React.Suspense>
        <Verify />
      </React.Suspense>
    </AuthLayout>
  );
}
