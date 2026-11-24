'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Camera, Heart, Inbox, LayoutDashboard, Trash2 } from 'lucide-react';
import type { SessionUser } from '@estate/shared';
import { Alert, Avatar, Button, Card, CardBody, CardHeader, DescriptionList, Field, Input, toast } from '@estate/ui';
import { errorMessage } from '@estate/api-client';
import { api } from '@/lib/api-browser';
import { consoleUrl, useCurrentUser } from '@/lib/session';
import { useFavouriteIds } from '@/components/common/favourite-button';

function Welcome() {
  const welcome = useSearchParams().get('welcome');
  if (!welcome) return null;
  return (
    <Alert tone="success" title="Your account is ready" className="mb-6">
      We sent a verification link to your email address. You can start saving properties right away.
    </Alert>
  );
}

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Name and profile photo — PATCH /auth/me returns the refreshed session user. */
function ProfileEditor({ user }: { user: SessionUser }) {
  const qc = useQueryClient();
  const photoInput = React.useRef<HTMLInputElement>(null);
  const [name, setName] = React.useState(user.fullName);
  const [nameError, setNameError] = React.useState<string | null>(null);
  React.useEffect(() => setName(user.fullName), [user.fullName]);
  const save = useMutation({
    mutationFn: (body: { fullName?: string; avatarFileId?: string | null }) => api.patch<SessionUser>('/auth/me', body),
    onSuccess: (updated) => qc.setQueryData(['me'], updated),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const [photoBusy, setPhotoBusy] = React.useState(false);

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
      await save.mutateAsync({ avatarFileId: uploaded.id });
      toast.success('Profile photo updated');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPhotoBusy(false);
    }
  }

  const trimmed = name.trim();
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={user.fullName} src={user.avatarUrl} size={72} />
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" loading={photoBusy} onClick={() => photoInput.current?.click()}>
              <Camera /> {user.avatarUrl ? 'Change photo' : 'Upload photo'}
            </Button>
            {user.avatarUrl ? (
              <Button size="sm" variant="ghost" loading={save.isPending && !photoBusy} onClick={() => save.mutate({ avatarFileId: null }, { onSuccess: () => toast.success('Profile photo removed') })}>
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
          save.mutate({ fullName: trimmed }, { onSuccess: () => toast.success('Name updated') });
        }}
      >
        <Field label="Full name" htmlFor="profile-name" error={nameError ?? undefined} className="min-w-56 flex-1">
          <Input id="profile-name" autoComplete="name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(nameError)} />
        </Field>
        <Button type="submit" variant="outline" loading={save.isPending && !photoBusy} disabled={trimmed === user.fullName}>
          Save name
        </Button>
      </form>
    </div>
  );
}

export default function AccountOverviewPage() {
  const { data: user } = useCurrentUser();
  const favourites = useFavouriteIds();
  const resend = useMutation({
    mutationFn: () => api.post('/auth/resend-verification'),
    onSuccess: () => toast.success('Verification email sent'),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!user) return null;
  return (
    <>
      <React.Suspense>
        <Welcome />
      </React.Suspense>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Your details" />
          <CardBody className="grid gap-5">
            <ProfileEditor user={user} />
            <DescriptionList
              items={[
                { label: 'Email', value: user.email ?? '—' },
                { label: 'Mobile', value: user.phone ?? '—' },
                { label: 'Email status', value: user.emailVerified ? 'Verified' : 'Not verified yet' },
              ]}
            />
            <p className="-mt-2 text-xs text-ink-500">
              Your email and mobile number are used to sign in. Password:{' '}
              <Link href="/account/security" className="font-medium text-brand-strong hover:underline">
                change it here
              </Link>
              .
            </p>
            {!user.emailVerified ? (
              <Alert tone="warning" action={<Button size="xs" variant="outline" loading={resend.isPending} onClick={() => resend.mutate()}>Resend link</Button>}>
                Verify your email to receive updates about your enquiries.
              </Alert>
            ) : null}
          </CardBody>
        </Card>
        <div className="flex flex-col gap-4">
          <Link href="/account/saved" className="flex items-center gap-4 rounded-xl border border-line bg-surface p-5 transition-colors hover:border-ink-300">
            <span className="grid size-11 place-items-center rounded-lg bg-danger-soft text-danger">
              <Heart className="size-5" />
            </span>
            <span className="flex-1">
              <span className="block font-semibold text-ink-900">Saved properties</span>
              <span className="text-sm text-ink-500">{favourites.data ? `${favourites.data.length} saved` : 'Loading…'}</span>
            </span>
            <ArrowRight className="size-4 text-ink-400" />
          </Link>
          <Link href="/account/enquiries" className="flex items-center gap-4 rounded-xl border border-line bg-surface p-5 transition-colors hover:border-ink-300">
            <span className="grid size-11 place-items-center rounded-lg bg-info-soft text-info">
              <Inbox className="size-5" />
            </span>
            <span className="flex-1">
              <span className="block font-semibold text-ink-900">My enquiries</span>
              <span className="text-sm text-ink-500">Reference numbers and status</span>
            </span>
            <ArrowRight className="size-4 text-ink-400" />
          </Link>
          {user.workspaces.length ? (
            <a href={consoleUrl('/')} className="flex items-center gap-4 rounded-xl border border-line bg-surface p-5 transition-colors hover:border-ink-300">
              <span className="grid size-11 place-items-center rounded-lg bg-brand-soft text-brand-strong">
                <LayoutDashboard className="size-5" />
              </span>
              <span className="flex-1">
                <span className="block font-semibold text-ink-900">Business console</span>
                <span className="text-sm text-ink-500">Manage listings, leads and your organisation</span>
              </span>
              <ArrowRight className="size-4 text-ink-400" />
            </a>
          ) : null}
        </div>
      </div>
    </>
  );
}
