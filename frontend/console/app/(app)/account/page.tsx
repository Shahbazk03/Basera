'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Camera, Laptop, ShieldCheck, Trash2 } from 'lucide-react';
import { passwordSchema, formatDateTime, type SessionUser } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Alert, Avatar, Badge, Button, Card, CardBody, CardHeader, DescriptionList, Field, Input, PageHeader, toast } from '@estate/ui';
import { api } from '@/lib/api';
import { applyServerErrors, useApi, useApiMutation } from '@/lib/hooks';
import { useSession } from '@/lib/session';

const schema = z
  .object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: passwordSchema, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

interface SessionRow {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  current: boolean;
}

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

function ProfileCard() {
  const { user, reload } = useSession();
  const photoInput = React.useRef<HTMLInputElement>(null);
  const [name, setName] = React.useState(user.fullName);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  React.useEffect(() => setName(user.fullName), [user.fullName]);
  const resend = useApiMutation(() => api.post('/auth/resend-verification'), { success: 'Verification email sent' });
  const saveName = useApiMutation((fullName: string) => api.patch<SessionUser>('/auth/me', { fullName }), { success: 'Name updated', onSuccess: () => void reload() });
  const removePhoto = useApiMutation(() => api.patch<SessionUser>('/auth/me', { avatarFileId: null }), { success: 'Profile photo removed', onSuccess: () => void reload() });

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      toast.error('Choose a photo smaller than 10 MB');
      return;
    }
    setPhotoBusy(true);
    try {
      const uploaded = await api.upload(file, 'avatar');
      await api.patch<SessionUser>('/auth/me', { avatarFileId: uploaded.id });
      await reload();
      toast.success('Profile photo updated');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPhotoBusy(false);
    }
  }

  const trimmed = name.trim();
  return (
    <Card>
      <CardHeader title="Profile" description="Your name and photo are shown to colleagues and on the records you work on." />
      <CardBody className="grid gap-5">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={user.fullName} src={user.avatarUrl} size={72} />
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" loading={photoBusy} onClick={() => photoInput.current?.click()}>
                <Camera /> {user.avatarUrl ? 'Change photo' : 'Upload photo'}
              </Button>
              {user.avatarUrl ? (
                <Button size="sm" variant="ghost" loading={removePhoto.isPending} onClick={() => removePhoto.mutate(undefined)}>
                  <Trash2 /> Remove
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-ink-500">JPEG, PNG or WebP, up to 10 MB. It is cropped to a square.</p>
          </div>
          <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void onPhoto(e)} aria-label="Upload profile photo" />
        </div>

        <form
          noValidate
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed.length < 2) {
              setNameError('Enter your name');
              return;
            }
            setNameError(null);
            saveName.mutate(trimmed);
          }}
        >
          <Field label="Full name" htmlFor="profile-name" error={nameError ?? undefined} className="min-w-56 flex-1">
            <Input id="profile-name" autoComplete="name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(nameError)} />
          </Field>
          <Button type="submit" variant="outline" loading={saveName.isPending} disabled={trimmed === user.fullName}>
            Save name
          </Button>
        </form>

        <DescriptionList
          items={[
            { label: 'Email', value: user.email ?? '—' },
            { label: 'Mobile', value: user.phone ?? '—' },
            { label: 'Roles', value: user.roles.map((r) => r.name).join(', ') || '—' },
          ]}
        />
        <p className="-mt-2 text-xs text-ink-500">Your email and mobile number are used to sign in — ask an administrator if they need to change.</p>
        {!user.emailVerified ? (
          <Alert tone="warning" title="Email not verified" action={<Button size="xs" variant="outline" loading={resend.isPending} onClick={() => resend.mutate(undefined)}>Resend link</Button>}>
            Verify your email to receive important notifications.
          </Alert>
        ) : (
          <Badge tone="success" className="w-fit">
            <ShieldCheck /> Email verified
          </Badge>
        )}
      </CardBody>
    </Card>
  );
}

export default function AccountPage() {
  const sessions = useApi<SessionRow[]>('/auth/sessions');
  const revoke = useApiMutation((id: string) => api.delete(`/auth/sessions/${id}`), { success: 'Session signed out', invalidate: ['/auth/sessions'] });
  const form = useForm<z.input<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const [done, setDone] = React.useState(false);

  return (
    <>
      <PageHeader title="Account & security" description="Your profile, photo, password and signed-in devices." />
      <div className="grid gap-5 lg:grid-cols-2">
        <ProfileCard />

        <Card>
          <CardHeader title="Change password" description="Other devices are signed out when you change your password." />
          <CardBody>
            {done ? <Alert tone="success" className="mb-4">Password updated.</Alert> : null}
            <form
              noValidate
              className="grid gap-4"
              onSubmit={form.handleSubmit(async (v) => {
                setDone(false);
                try {
                  await api.post('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword });
                  form.reset();
                  setDone(true);
                } catch (err) {
                  applyServerErrors(form, err);
                }
              })}
            >
              <Field label="Current password" htmlFor="currentPassword" error={form.formState.errors.currentPassword?.message}>
                <Input id="currentPassword" type="password" autoComplete="current-password" {...form.register('currentPassword')} />
              </Field>
              <Field label="New password" htmlFor="newPassword" hint="At least 10 characters with a letter and a number." error={form.formState.errors.newPassword?.message}>
                <Input id="newPassword" type="password" autoComplete="new-password" {...form.register('newPassword')} />
              </Field>
              <Field label="Confirm new password" htmlFor="confirm" error={form.formState.errors.confirm?.message}>
                <Input id="confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
              </Field>
              <Button type="submit" className="w-fit" loading={form.formState.isSubmitting}>
                Update password
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Signed-in devices" />
          <ul className="divide-y divide-line">
            {(sessions.data ?? []).map((s) => (
              <li key={s.id} className="flex items-center gap-4 px-5 py-3.5">
                <Laptop className="size-5 text-ink-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink-900">{s.userAgent ?? 'Unknown device'}</p>
                  <p className="text-xs text-ink-500">
                    {s.ipAddress ?? '—'} · last active {formatDateTime(s.lastUsedAt ?? s.createdAt)}
                  </p>
                </div>
                {s.current ? (
                  <Badge tone="brand">This device</Badge>
                ) : (
                  <Button size="xs" variant="outline" loading={revoke.isPending} onClick={() => revoke.mutate(s.id)}>
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
