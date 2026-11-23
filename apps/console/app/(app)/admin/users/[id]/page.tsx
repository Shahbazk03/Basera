'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft, Copy, KeyRound, Lock, Pencil, ShieldOff, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { enumLabel, formatDate, formatDateTime } from '@estate/shared';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CheckboxField,
  CardHeader,
  ConfirmDialog,
  DescriptionList,
  Dialog,
  DialogContent,
  DialogFooter,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
  toast,
} from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useSession } from '@/lib/session';

interface UserDetail {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  accountType: string;
  status: string;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  lastLoginAt: string | null;
  failedLoginCount: number;
  lockedUntil: string | null;
  createdAt: string;
  isDemo: boolean;
  activeSessions: number;
  employee: { id: string; employeeCode: string; employmentStatus: string; department: { name: string } | null; designation: { name: string } | null } | null;
  memberships: { id: string; title: string | null; isOwner: boolean; status: string; joinedAt: string; organization: { id: string; name: string; type: string; status: string } }[];
  userRoles: { id: string; createdAt: string; organizationId: string | null; role: { id: string; key: string; name: string; scope: 'PLATFORM' | 'ORGANIZATION' }; organization: { name: string } | null; grantedBy: { fullName: string } | null }[];
  history: { id: string; action: string; entityType: string; createdAt: string; actorIp: string | null; actor: { fullName: string } | null }[];
}

const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** A strong random password (no look-alike characters) that satisfies the password rules. */
function generatePassword(length = 14): string {
  const bytes = new Uint32Array(length);
  for (;;) {
    crypto.getRandomValues(bytes);
    const pw = Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join('');
    if (/[A-Za-z]/.test(pw) && /\d/.test(pw)) return `${pw.slice(0, 7)}-${pw.slice(7)}`;
  }
}

const EMAIL_STATUS_TEXT: Record<string, string> = {
  SENT: 'Emailed',
  QUEUED: 'Email queued — it will be retried automatically',
  FAILED: 'The email could not be delivered',
  NOT_CONFIGURED: 'Email is not configured on this server, so it was not sent',
};

interface SetPasswordResult {
  sessionsRevoked: number;
  mustChange: boolean;
  emailStatus: 'SENT' | 'QUEUED' | 'FAILED' | 'NOT_CONFIGURED' | null;
  sentTo: string | null;
}

interface RoleOption {
  id: string;
  key: string;
  name: string;
  scope: 'PLATFORM' | 'ORGANIZATION';
  description: string | null;
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user: me, can } = useSession();
  const q = useApi<UserDetail>(`/admin/users/${id}`);
  const roles = useApi<RoleOption[]>('/admin/roles');
  const u = q.data;
  const isSelf = me.id === id;

  const [grantOpen, setGrantOpen] = React.useState(false);
  const [roleKey, setRoleKey] = React.useState('');
  const [scope, setScope] = React.useState<string>('');
  const selectedRole = roles.data?.find((r) => r.key === roleKey);
  const grant = useApiMutation(() => api.post(`/admin/users/${id}/roles`, { roleKey, organizationId: scope || null }), {
    success: 'Role granted — it applies immediately',
    invalidate: ['/admin/users'],
    onSuccess: () => {
      setGrantOpen(false);
      setRoleKey('');
      setScope('');
    },
  });
  const revoke = useApiMutation((grantId: string) => api.delete(`/admin/users/${id}/roles/${grantId}`), { success: 'Role removed', invalidate: ['/admin/users'] });
  const [statusAction, setStatusAction] = React.useState<'SUSPENDED' | 'ACTIVE' | null>(null);
  const [reason, setReason] = React.useState('');
  const setStatus = useApiMutation(() => api.patch(`/admin/users/${id}/status`, { status: statusAction, reason: reason || undefined }), {
    success: statusAction === 'SUSPENDED' ? 'Account suspended and signed out everywhere' : 'Account reactivated',
    invalidate: ['/admin/users'],
    onSuccess: () => {
      setStatusAction(null);
      setReason('');
    },
  });

  const [nameOpen, setNameOpen] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const rename = useApiMutation(() => api.patch(`/admin/users/${id}`, { fullName: newName.trim() }), {
    success: 'Name updated',
    invalidate: ['/admin/users'],
    onSuccess: () => setNameOpen(false),
  });
  const [pwOpen, setPwOpen] = React.useState(false);
  const [pw, setPw] = React.useState('');
  const [pwEmail, setPwEmail] = React.useState(true);
  const [pwMustChange, setPwMustChange] = React.useState(true);
  const [pwResult, setPwResult] = React.useState<SetPasswordResult | null>(null);
  const pwValid = pw.length >= 10 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
  const setPassword = useApiMutation(() => api.post<SetPasswordResult>(`/admin/users/${id}/password`, { password: pw, sendEmail: pwEmail, mustChange: pwEmail || pwMustChange }), {
    invalidate: ['/admin/users'],
    onSuccess: (r) => setPwResult(r),
  });
  const openSetPassword = (hasEmail: boolean) => {
    setPw(generatePassword());
    setPwEmail(hasEmail);
    setPwMustChange(true);
    setPwResult(null);
    setPwOpen(true);
  };
  const [resetOpen, setResetOpen] = React.useState(false);
  const sendReset = useApiMutation(() => api.post<{ sentTo: string }>(`/admin/users/${id}/password-reset`), {
    success: (r) => `Password reset link sent to ${r.sentTo}`,
    onSuccess: () => setResetOpen(false),
  });

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!u) return <EmptyState title="User not found" action={<Button asChild variant="outline"><Link href="/admin/users">Back to users</Link></Button>} />;

  const platformOrgId = me.platformOrganizationId;
  const scopeOptions =
    selectedRole?.scope === 'ORGANIZATION'
      ? u.memberships.filter((m) => m.status === 'ACTIVE' && m.organization.type !== 'PLATFORM').map((m) => ({ value: m.organization.id, label: m.organization.name }))
      : [{ value: '', label: 'Platform-wide (all organisations)' }, ...(platformOrgId ? [{ value: platformOrgId, label: 'Company organisation only' }] : [])];

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Link href="/admin/users" className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
            <ChevronLeft className="size-4" /> Users
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <Avatar name={u.fullName} src={u.avatarUrl} size={40} />
            {u.fullName}
          </span>
        }
        description={
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge status={u.status} />
            <span>{enumLabel(u.accountType)}</span>
            {u.isDemo ? <Badge tone="outline">Demo data</Badge> : null}
            <span aria-hidden>·</span>
            <span>Joined {formatDate(u.createdAt)}</span>
          </span>
        }
        actions={
          !isSelf ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setNewName(u.fullName);
                  setNameOpen(true);
                }}
              >
                <Pencil /> Edit name
              </Button>
              <Button variant="outline" onClick={() => openSetPassword(Boolean(u.email))}>
                <Lock /> Set password
              </Button>
              <Button variant="outline" disabled={!u.email || u.status !== 'ACTIVE'} title={!u.email ? 'This user has no email address' : u.status !== 'ACTIVE' ? 'Reactivate the account first' : undefined} onClick={() => setResetOpen(true)}>
                <KeyRound /> Send reset link
              </Button>
              {u.status === 'ACTIVE' ? (
                <Button variant="destructive-outline" onClick={() => setStatusAction('SUSPENDED')}>
                  <ShieldOff /> Suspend access
                </Button>
              ) : (
                <Button onClick={() => setStatusAction('ACTIVE')}>
                  <ShieldCheck /> Reactivate
                </Button>
              )}
            </>
          ) : (
            <Button asChild variant="outline">
              <Link href="/account">
                <Pencil /> Edit my profile
              </Link>
            </Button>
          )
        }
      />
      {isSelf ? (
        <Alert tone="info" className="mb-5">
          This is your own account. Change your name, photo and password on your <Link href="/account" className="font-medium underline">Account &amp; security</Link> page; your roles and status can only be changed by another administrator.
        </Alert>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader
              title="Roles"
              description="Platform-wide roles apply to every organisation; organisation roles apply only to that organisation's records."
              actions={
                !isSelf ? (
                  <Button size="sm" onClick={() => setGrantOpen(true)}>
                    <KeyRound /> Grant role
                  </Button>
                ) : null
              }
            />
            {u.userRoles.length ? (
              <Table>
                <THead>
                  <tr>
                    <TH>Role</TH>
                    <TH>Scope</TH>
                    <TH className="hidden md:table-cell">Granted</TH>
                    <TH align="right">
                      <span className="sr-only">Actions</span>
                    </TH>
                  </tr>
                </THead>
                <TBody>
                  {u.userRoles.map((r) => (
                    <TR key={r.id}>
                      <TD className="font-medium text-ink-900">{r.role.name}</TD>
                      <TD className="text-ink-700">{r.organization?.name ?? 'Platform-wide'}</TD>
                      <TD className="hidden text-xs text-ink-500 md:table-cell">
                        {formatDate(r.createdAt)}
                        {r.grantedBy ? ` by ${r.grantedBy.fullName}` : ''}
                      </TD>
                      <TD align="right">
                        {!isSelf ? (
                          <Button size="xs" variant="ghost" className="text-danger" loading={revoke.isPending} onClick={() => revoke.mutate(r.id)} aria-label={`Remove ${r.role.name}`}>
                            <Trash2 /> Remove
                          </Button>
                        ) : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <EmptyState icon={<KeyRound />} title="No roles" description={u.accountType === 'CUSTOMER' ? 'Customers do not need roles.' : 'Grant a role to give this user access to the console.'} />
            )}
          </Card>

          <Card>
            <CardHeader title="Organisations" />
            {u.memberships.length ? (
              <ul className="divide-y divide-line">
                {u.memberships.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">
                        {m.organization.type !== 'PLATFORM' && can('broker.view') ? (
                          <Link href={`/partners/${m.organization.id}`} className="hover:underline">
                            {m.organization.name}
                          </Link>
                        ) : (
                          m.organization.name
                        )}{' '}
                        {m.isOwner ? <Badge tone="dark" size="sm">Owner</Badge> : null}
                      </p>
                      <p className="text-xs text-ink-500">
                        {enumLabel(m.organization.type)}
                        {m.title ? ` · ${m.title}` : ''} · since {formatDate(m.joinedAt)}
                      </p>
                    </div>
                    <StatusBadge status={m.status} size="sm" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-ink-500">Not a member of any organisation.</p>
            )}
          </Card>

          <Card>
            <CardHeader title="Recent activity" description="From the audit log." />
            {u.history.length ? (
              <ul className="divide-y divide-line">
                {u.history.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span className="text-ink-800">{h.action}</span>
                    <span className="text-xs text-ink-500">
                      {formatDateTime(h.createdAt)} · {h.actor?.fullName ?? 'System'}
                      {h.actorIp ? ` · ${h.actorIp}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-ink-500">No recorded activity.</p>
            )}
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader title="Account" />
          <CardBody>
            <DescriptionList
              columns={1}
              items={[
                { label: 'Email', value: u.email ? `${u.email}${u.emailVerifiedAt ? ' (verified)' : ' (not verified)'}` : '—' },
                { label: 'Mobile', value: u.phone ?? '—' },
                { label: 'Last sign-in', value: u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never' },
                { label: 'Active sessions', value: u.activeSessions },
                { label: 'Failed sign-in attempts', value: u.failedLoginCount },
                ...(u.lockedUntil && new Date(u.lockedUntil) > new Date() ? [{ label: 'Locked until', value: formatDateTime(u.lockedUntil) }] : []),
                ...(u.employee ? [{ label: 'Employee', value: `${u.employee.employeeCode} · ${u.employee.designation?.name ?? ''} ${u.employee.department ? `(${u.employee.department.name})` : ''}` }] : []),
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent title="Grant a role" description={`Give ${u.fullName} additional access.`}>
          <div className="grid gap-4">
            <Field label="Role" htmlFor="role" required>
              <Select
                id="role"
                value={roleKey}
                onChange={(e) => {
                  setRoleKey(e.target.value);
                  setScope('');
                }}
              >
                <option value="">Select a role</option>
                <optgroup label="Platform roles">
                  {(roles.data ?? [])
                    .filter((r) => r.scope === 'PLATFORM')
                    .map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.name}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Organisation roles">
                  {(roles.data ?? [])
                    .filter((r) => r.scope === 'ORGANIZATION')
                    .map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.name}
                      </option>
                    ))}
                </optgroup>
              </Select>
            </Field>
            {selectedRole ? (
              <Field label="Applies to" htmlFor="scope" required={selectedRole.scope === 'ORGANIZATION'} hint={selectedRole.description ?? undefined}>
                <Select id="scope" value={scope} onChange={(e) => setScope(e.target.value)}>
                  {selectedRole.scope === 'ORGANIZATION' ? <option value="">Select an organisation</option> : null}
                  {scopeOptions.map((o) => (
                    <option key={o.value || 'global'} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {selectedRole?.scope === 'ORGANIZATION' && scopeOptions.length === 0 ? <Alert tone="warning">This user is not a member of any partner organisation.</Alert> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantOpen(false)}>
              Cancel
            </Button>
            <Button loading={grant.isPending} disabled={!roleKey || (selectedRole?.scope === 'ORGANIZATION' && !scope)} onClick={() => grant.mutate(undefined)}>
              Grant role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={nameOpen} onOpenChange={setNameOpen}>
        <DialogContent title="Edit name" description="The name shown across the console, on records and in notifications. The change is recorded in the audit log.">
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim().length >= 2) rename.mutate(undefined);
            }}
          >
            <Field label="Full name" htmlFor="admin-user-name" required error={newName.trim().length > 0 && newName.trim().length < 2 ? 'Enter at least 2 characters' : undefined}>
              <Input id="admin-user-name" maxLength={100} value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
            </Field>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setNameOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={rename.isPending} disabled={newName.trim().length < 2 || newName.trim() === u.fullName}>
                Save name
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={pwOpen} onOpenChange={(o) => { setPwOpen(o); if (!o) { setPw(''); setPwResult(null); } }}>
        <DialogContent
          title={pwResult ? 'Password updated' : `Set a new password for ${u.fullName}`}
          description={pwResult ? undefined : 'They are signed out on every device straight away. The password is never stored in readable form or shown in any log.'}
        >
          {pwResult ? (
            <div className="grid gap-4">
              <Alert tone={pwResult.emailStatus === 'SENT' || pwResult.emailStatus === null ? 'success' : 'warning'} title={pwResult.emailStatus ? `${EMAIL_STATUS_TEXT[pwResult.emailStatus]}${pwResult.emailStatus === 'SENT' && pwResult.sentTo ? ` to ${pwResult.sentTo}` : ''}` : 'Not emailed'}>
                {pwResult.emailStatus === 'SENT'
                  ? 'They can sign in with the new password now.'
                  : 'Share the password with them yourself, over a channel you trust (in person or by phone).'}
                {pwResult.mustChange ? ' They will be asked to choose their own password straight after signing in.' : ''}
                {pwResult.sessionsRevoked ? ` ${pwResult.sessionsRevoked} signed-in device(s) were signed out.` : ''}
              </Alert>
              {pwResult.emailStatus !== 'SENT' ? (
                <div className="flex items-center gap-2 rounded-lg border border-line bg-ink-50 px-3 py-2">
                  <code className="flex-1 font-mono text-[15px] tracking-wide text-ink-900">{pw}</code>
                  <Button size="xs" variant="outline" onClick={() => void navigator.clipboard.writeText(pw).then(() => toast.success('Password copied'))}>
                    <Copy /> Copy
                  </Button>
                </div>
              ) : null}
              <DialogFooter>
                <Button onClick={() => setPwOpen(false)}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <form
              noValidate
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (pwValid) setPassword.mutate(undefined);
              }}
            >
              <Field label="New password" htmlFor="admin-set-password" hint="At least 10 characters with a letter and a number." error={pw && !pwValid ? 'Use at least 10 characters including a letter and a number' : undefined}>
                <div className="flex gap-2">
                  <Input id="admin-set-password" className="font-mono" autoComplete="off" spellCheck={false} value={pw} onChange={(e) => setPw(e.target.value)} />
                  <Button type="button" variant="outline" onClick={() => setPw(generatePassword())}>
                    <Sparkles /> Generate
                  </Button>
                </div>
              </Field>
              <CheckboxField
                checked={pwEmail}
                disabled={!u.email}
                onCheckedChange={(v) => setPwEmail(v === true)}
                label={u.email ? `Email the password to ${u.email}` : 'Email the password (this user has no email address)'}
              />
              <CheckboxField
                checked={pwEmail || pwMustChange}
                disabled={pwEmail}
                onCheckedChange={(v) => setPwMustChange(v === true)}
                label="Ask them to choose their own password at the next sign-in"
                description={pwEmail ? 'Always required when the password is sent by email.' : undefined}
              />
              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => setPwOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={setPassword.isPending} disabled={!pwValid}>
                  <Lock /> Set password
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={`Send a password reset link to ${u.fullName}?`}
        description={`A single-use link valid for 60 minutes is emailed to ${u.email ?? 'their email address'}. You never see the link or the new password. Their current password keeps working until they choose a new one, and all their devices are signed out when they do.`}
        confirmLabel="Send link"
        loading={sendReset.isPending}
        onConfirm={() => sendReset.mutate(undefined)}
      />

      <ConfirmDialog
        open={Boolean(statusAction)}
        onOpenChange={(o) => !o && setStatusAction(null)}
        tone={statusAction === 'SUSPENDED' ? 'danger' : 'default'}
        title={statusAction === 'SUSPENDED' ? `Suspend ${u.fullName}?` : `Reactivate ${u.fullName}?`}
        description={statusAction === 'SUSPENDED' ? 'They are signed out on every device immediately and cannot sign in until reactivated.' : 'They will be able to sign in again with their existing password.'}
        confirmLabel={statusAction === 'SUSPENDED' ? 'Suspend' : 'Reactivate'}
        loading={setStatus.isPending}
        onConfirm={() => setStatus.mutate(undefined)}
      >
        {statusAction === 'SUSPENDED' ? (
          <Field label="Reason (recorded in the audit log)" htmlFor="sreason">
            <Textarea id="sreason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
