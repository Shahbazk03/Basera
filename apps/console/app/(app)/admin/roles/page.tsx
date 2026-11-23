'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { KeyRound, Lock, Plus } from 'lucide-react';
import { errorMessage } from '@estate/api-client';
import { Alert, Badge, Button, Card, Dialog, DialogContent, DialogFooter, Field, Input, PageHeader, Select, Table, TBody, TD, TH, THead, TR, Textarea, toast } from '@estate/ui';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { QueryState } from '@/components/query-state';
import { PermissionMatrix, type PermissionGroup } from '@/components/admin/permission-matrix';

interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  scope: 'PLATFORM' | 'ORGANIZATION';
  isSystem: boolean;
  permissions: string[];
  users: number;
}

export default function RolesPage() {
  const router = useRouter();
  const { can } = useSession();
  const q = useApi<RoleRow[]>('/admin/roles');
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="System roles ship with the platform and are read-only. Create custom roles from the permission catalogue for anything else. The API enforces every permission — hiding a menu is never relied on."
        actions={
          can('role.manage') ? (
            <Button onClick={() => setOpen(true)}>
              <Plus /> New custom role
            </Button>
          ) : null
        }
      />
      {!can('role.manage') ? (
        <Alert tone="info" className="mb-5">
          You can assign roles to users. Only a super admin can design roles.
        </Alert>
      ) : null}
      <Card>
        <QueryState query={q} isEmpty={(d) => d.length === 0} empty={{ icon: <KeyRound />, title: 'No roles found' }}>
          {(rows) => (
            <Table>
              <THead>
                <tr>
                  <TH>Role</TH>
                  <TH className="hidden md:table-cell">Scope</TH>
                  <TH align="right">Permissions</TH>
                  <TH align="right">Assignments</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id} onClick={() => router.push(`/admin/roles/${r.id}`)}>
                    <TD>
                      <Link href={`/admin/roles/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-ink-900 hover:underline">
                        {r.name}
                      </Link>{' '}
                      {r.isSystem ? (
                        <Badge tone="outline" size="sm">
                          <Lock /> System
                        </Badge>
                      ) : (
                        <Badge tone="brand" size="sm">
                          Custom
                        </Badge>
                      )}
                      {r.description ? <div className="line-clamp-1 max-w-xl text-xs text-ink-500">{r.description}</div> : null}
                    </TD>
                    <TD className="hidden md:table-cell">{r.scope === 'PLATFORM' ? 'Company staff' : 'Partner organisation'}</TD>
                    <TD align="right" className="tabular">
                      {r.permissions.length}
                    </TD>
                    <TD align="right" className="tabular">
                      {r.users}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </QueryState>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? <CreateRole onDone={(id) => (setOpen(false), id && router.push(`/admin/roles/${id}`))} /> : null}
      </Dialog>
    </>
  );
}

function CreateRole({ onDone }: { onDone: (id?: string) => void }) {
  const catalog = useApi<PermissionGroup[]>('/admin/permissions');
  const [v, setV] = React.useState({ key: '', name: '', description: '', scope: 'PLATFORM' as 'PLATFORM' | 'ORGANIZATION' });
  const [perms, setPerms] = React.useState<Set<string>>(new Set(['dashboard.view']));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <DialogContent title="New custom role" description="Pick the smallest set of permissions the role needs." size="xl">
      <div className="grid gap-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name" htmlFor="rname" required>
            <Input id="rname" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value, key: v.key || '' })} />
          </Field>
          <Field label="Key" htmlFor="rkey" required hint="Uppercase, e.g. FIELD_AGENT">
            <Input id="rkey" value={v.key} onChange={(e) => setV({ ...v, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })} />
          </Field>
          <Field label="Granted to" htmlFor="rscope" required>
            <Select id="rscope" value={v.scope} onChange={(e) => setV({ ...v, scope: e.target.value as 'PLATFORM' | 'ORGANIZATION' })}>
              <option value="PLATFORM">Company staff</option>
              <option value="ORGANIZATION">Partner organisation members</option>
            </Select>
          </Field>
        </div>
        <Field label="Description" htmlFor="rdesc">
          <Textarea id="rdesc" rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </Field>
        {catalog.data ? <PermissionMatrix catalog={catalog.data} value={perms} onChange={setPerms} /> : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button
          loading={busy}
          disabled={v.name.trim().length < 2 || v.key.length < 2}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const role = await api.post<{ id: string }>('/admin/roles', { ...v, description: v.description || null, permissions: [...perms] });
              toast.success('Role created');
              onDone(role.id);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Create role ({perms.size} permissions)
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
