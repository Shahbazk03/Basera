'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft, Lock, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, Field, Input, PageHeader, Skeleton, StatusBadge, Textarea } from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { PermissionMatrix, type PermissionGroup } from '@/components/admin/permission-matrix';

interface RoleDetail {
  id: string;
  key: string;
  name: string;
  description: string | null;
  scope: 'PLATFORM' | 'ORGANIZATION';
  isSystem: boolean;
  permissions: string[];
  assignments: { id: string; organizationId: string | null; organization: { name: string } | null; user: { id: string; fullName: string; email: string | null; status: string } }[];
}

export default function RoleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const q = useApi<RoleDetail>(`/admin/roles/${id}`);
  const catalog = useApi<PermissionGroup[]>('/admin/permissions');
  const r = q.data;
  const editable = Boolean(r && !r.isSystem && can('role.manage'));
  const [perms, setPerms] = React.useState<Set<string>>(new Set());
  const [meta, setMeta] = React.useState({ name: '', description: '' });
  React.useEffect(() => {
    if (r) {
      setPerms(new Set(r.permissions));
      setMeta({ name: r.name, description: r.description ?? '' });
    }
  }, [r]);
  const dirty = Boolean(r) && (meta.name !== r!.name || meta.description !== (r!.description ?? '') || perms.size !== r!.permissions.length || r!.permissions.some((p) => !perms.has(p)));
  const save = useApiMutation(() => api.patch(`/admin/roles/${id}`, { name: meta.name, description: meta.description || null, permissions: [...perms] }), { success: 'Role saved — holders get the new permissions immediately', invalidate: ['/admin/roles'] });
  const [confirm, setConfirm] = React.useState(false);
  const remove = useApiMutation(() => api.delete(`/admin/roles/${id}`), { success: 'Role deleted', invalidate: ['/admin/roles'], onSuccess: () => router.replace('/admin/roles') });

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!r) return <EmptyState title="Role not found" />;
  return (
    <>
      <PageHeader
        breadcrumbs={
          <Link href="/admin/roles" className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
            <ChevronLeft className="size-4" /> Roles
          </Link>
        }
        title={r.name}
        description={
          <span className="mt-1 flex flex-wrap items-center gap-2">
            {r.isSystem ? (
              <Badge tone="outline">
                <Lock /> System role
              </Badge>
            ) : (
              <Badge tone="brand">Custom role</Badge>
            )}
            <span className="font-mono text-xs">{r.key}</span>
            <span aria-hidden>·</span>
            <span>{r.scope === 'PLATFORM' ? 'Company staff' : 'Partner organisation members'}</span>
          </span>
        }
        actions={
          editable ? (
            <>
              <Button variant="destructive-outline" onClick={() => setConfirm(true)}>
                <Trash2 /> Delete
              </Button>
              <Button disabled={!dirty || perms.size === 0} loading={save.isPending} onClick={() => save.mutate(undefined)}>
                Save changes
              </Button>
            </>
          ) : null
        }
      />
      {r.isSystem ? (
        <Alert tone="info" className="mb-5">
          System roles are maintained with the platform and cannot be edited. Create a custom role if you need a different combination.
        </Alert>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader title={`Permissions (${perms.size})`} />
          <CardBody>
            {editable ? (
              <div className="mb-5 grid gap-4 sm:grid-cols-2">
                <Field label="Name" htmlFor="rn">
                  <Input id="rn" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
                </Field>
                <Field label="Description" htmlFor="rd">
                  <Textarea id="rd" rows={1} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
                </Field>
              </div>
            ) : r.description ? (
              <p className="mb-5 text-sm text-ink-600">{r.description}</p>
            ) : null}
            {catalog.data ? <PermissionMatrix catalog={catalog.data} value={perms} onChange={setPerms} readOnly={!editable} /> : <Skeleton className="h-64" />}
          </CardBody>
        </Card>
        <Card className="h-fit">
          <CardHeader title={`Assigned to (${r.assignments.length})`} />
          {r.assignments.length ? (
            <ul className="divide-y divide-line">
              {r.assignments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link href={`/admin/users/${a.user.id}`} className="block truncate text-sm font-medium text-ink-900 hover:underline">
                      {a.user.fullName}
                    </Link>
                    <p className="truncate text-xs text-ink-500">{a.organization?.name ?? 'Platform-wide'}</p>
                  </div>
                  <StatusBadge status={a.user.status} size="sm" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-sm text-ink-500">Nobody has this role.</p>
          )}
        </Card>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        tone="danger"
        title={`Delete ${r.name}?`}
        description={r.assignments.length ? `Remove it from ${r.assignments.length} user(s) first.` : 'This cannot be undone.'}
        confirmLabel="Delete role"
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </>
  );
}
