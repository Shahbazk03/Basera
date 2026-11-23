'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ExternalLink, LogOut } from 'lucide-react';
import { passwordSchema, type SessionUser } from '@estate/shared';
import { Alert, Button, Field, Input, toast } from '@estate/ui';
import { AuthLayout } from '@/components/auth-layout';
import { api } from '@/lib/api';
import { applyServerErrors } from '@/lib/hooks';
import { useBrandName } from '@/lib/brand';

const WEB_URL = (process.env.NEXT_PUBLIC_WEB_URL ?? '').replace(/\/$/, '');

async function signOut() {
  try {
    await api.post('/auth/logout');
  } finally {
    window.location.assign('/login');
  }
}

const schema = z
  .object({ currentPassword: z.string().min(1, 'Enter the password you signed in with'), newPassword: passwordSchema, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { message: 'Passwords do not match', path: ['confirm'] })
  .refine((v) => v.newPassword !== v.currentPassword, { message: 'Choose a password different from the temporary one', path: ['newPassword'] });

/** Shown after signing in with a password an administrator set: nothing else works until the user picks their own. */
export function ForcePasswordChange({ user }: { user: SessionUser }) {
  const qc = useQueryClient();
  const form = useForm<z.input<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const errors = form.formState.errors;
  return (
    <AuthLayout
      title="Choose your own password"
      subtitle={
        <>
          An administrator set a temporary password for <strong className="text-ink-900">{user.email ?? user.fullName}</strong>. Choose a new one to continue.
        </>
      }
      footer={
        <button type="button" onClick={() => void signOut()} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-600 hover:text-ink-900">
          <LogOut className="size-4" /> Sign out
        </button>
      }
    >
      <form
        noValidate
        className="grid gap-4"
        onSubmit={form.handleSubmit(async (v) => {
          try {
            await api.post('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword });
            toast.success('Password updated — welcome back');
            await qc.invalidateQueries({ queryKey: ['session'] });
          } catch (err) {
            applyServerErrors(form, err);
          }
        })}
      >
        <Field label="Temporary password" htmlFor="currentPassword" hint="The password you just signed in with." error={errors.currentPassword?.message}>
          <Input id="currentPassword" type="password" autoComplete="current-password" {...form.register('currentPassword')} />
        </Field>
        <Field label="New password" htmlFor="newPassword" hint="At least 10 characters with a letter and a number." error={errors.newPassword?.message}>
          <Input id="newPassword" type="password" autoComplete="new-password" {...form.register('newPassword')} />
        </Field>
        <Field label="Confirm new password" htmlFor="confirm" error={errors.confirm?.message}>
          <Input id="confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          Save password and continue
        </Button>
      </form>
    </AuthLayout>
  );
}

/** Customers (and any account without a console workspace) get an explanation instead of an empty, failing console. */
export function NoConsoleAccess({ user }: { user: SessionUser }) {
  const brand = useBrandName();
  return (
    <AuthLayout
      title="This account can’t use the business console"
      subtitle={
        <>
          You are signed in as <strong className="text-ink-900">{user.fullName}</strong>
          {user.email ? ` (${user.email})` : ''}, a customer account. The {brand} console is for company staff and verified partners.
        </>
      }
    >
      <div className="grid gap-3">
        {WEB_URL ? (
          <Button asChild size="lg" className="w-full">
            <a href={`${WEB_URL}/account`}>
              <ExternalLink /> Go to your account on the website
            </a>
          </Button>
        ) : null}
        <Button size="lg" variant="outline" className="w-full" onClick={() => void signOut()}>
          <LogOut /> Sign in with a different account
        </Button>
        <Alert tone="info" className="mt-2">
          Want to list properties or projects? Register as a partner on the website — your account is verified by our team before it can use the console.
        </Alert>
      </div>
    </AuthLayout>
  );
}
