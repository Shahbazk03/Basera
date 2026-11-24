'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { passwordSchema } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Alert, Button, Card, CardBody, CardHeader, Field, Input } from '@estate/ui';
import { api } from '@/lib/api-browser';
import { useCurrentUser } from '@/lib/session';

export default function SecurityPage() {
  const qc = useQueryClient();
  const { data: user } = useCurrentUser();
  const mustChange = Boolean(user?.mustChangePassword);
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  return (
    <Card className="max-w-xl">
      <CardHeader title={mustChange ? 'Choose your own password' : 'Change password'} description="Other devices are signed out when you change your password." />
      <CardBody>
        {mustChange ? (
          <Alert tone="warning" title="Your password was set by an administrator" className="mb-4">
            Enter the temporary password you received as your current password, then choose your own to continue using your account.
          </Alert>
        ) : null}
        {msg ? (
          <Alert tone={msg.tone} className="mb-4">
            {msg.text}
          </Alert>
        ) : null}
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setMsg(null);
            const check = passwordSchema.safeParse(next);
            if (!check.success) return setMsg({ tone: 'danger', text: check.error.issues[0].message });
            setBusy(true);
            try {
              await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
              setCurrent('');
              setNext('');
              setMsg({ tone: 'success', text: 'Password updated.' });
              await qc.invalidateQueries({ queryKey: ['me'] });
            } catch (err) {
              setMsg({ tone: 'danger', text: errorMessage(err) });
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label={mustChange ? 'Temporary password' : 'Current password'} htmlFor="current">
            <Input id="current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" htmlFor="next" hint="At least 10 characters with a letter and a number.">
            <Input id="next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Button type="submit" loading={busy} className="w-fit">
            Update password
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
