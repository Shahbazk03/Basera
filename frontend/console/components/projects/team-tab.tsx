'use client';

import * as React from 'react';
import { Star, Trash2, UserPlus, Users } from 'lucide-react';
import { enumLabel, PROJECT_TEAM_ROLES } from '@estate/shared';
import { Avatar, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Select } from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import type { ManageProject } from './types';

export function TeamTab({ project, onChanged }: { project: ManageProject; onChanged: () => void }) {
  const canEdit = project.permissions.canEdit;
  const candidates = useApi<{ id: string; fullName: string; email: string | null; title: string | null }[]>(canEdit ? `/projects/${project.id}/team/candidates` : null);
  const [userId, setUserId] = React.useState('');
  const [role, setRole] = React.useState('SALES_EXECUTIVE');
  const add = useApiMutation(() => api.post(`/projects/${project.id}/team`, { userId, role, isPrimaryContact: project.team.length === 0 }), {
    success: 'Added to the project team',
    invalidate: ['/projects'],
    onSuccess: () => {
      setUserId('');
      onChanged();
    },
  });
  const update = useApiMutation((v: { id: string; role?: string; isPrimaryContact?: boolean }) => api.patch(`/projects/${project.id}/team/${v.id}`, { role: v.role, isPrimaryContact: v.isPrimaryContact }), {
    success: 'Team updated',
    invalidate: ['/projects'],
    onSuccess: onChanged,
  });
  const remove = useApiMutation((id: string) => api.delete(`/projects/${project.id}/team/${id}`), { success: 'Removed from the team', invalidate: ['/projects'], onSuccess: onChanged });
  const available = (candidates.data ?? []).filter((c) => !project.team.some((t) => t.userId === c.id));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader title="Project team" description="People who receive status notifications and handle this project's buyers. The primary contact leads enquiries." />
        {project.team.length ? (
          <ul className="divide-y divide-line">
            {project.team.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <Avatar name={m.user.fullName} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink-900">
                    {m.user.fullName}
                    {m.isPrimaryContact ? (
                      <Badge tone="brand" size="sm">
                        Primary contact
                      </Badge>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-ink-500">{m.user.email ?? m.user.phone ?? ''}</p>
                </div>
                {canEdit ? (
                  <div className="flex items-center gap-1">
                    <Select value={m.role} onChange={(e) => update.mutate({ id: m.id, role: e.target.value })} className="h-8 w-48 text-[13px]" aria-label={`Role of ${m.user.fullName}`}>
                      {PROJECT_TEAM_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {enumLabel(r)}
                        </option>
                      ))}
                    </Select>
                    {!m.isPrimaryContact ? (
                      <Button size="icon-sm" variant="ghost" aria-label="Make primary contact" title="Make primary contact" onClick={() => update.mutate({ id: m.id, isPrimaryContact: true })}>
                        <Star />
                      </Button>
                    ) : null}
                    <Button size="icon-sm" variant="ghost" className="text-danger hover:bg-danger-soft" aria-label="Remove" onClick={() => remove.mutate(m.id)}>
                      <Trash2 />
                    </Button>
                  </div>
                ) : (
                  <Badge tone="neutral">{enumLabel(m.role)}</Badge>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<Users />} title="No team members yet" description="Add the people who sell and support this project." />
        )}
      </Card>
      {canEdit ? (
        <Card>
          <CardHeader title="Add a member" description={`Members of ${project.organization.name}`} />
          <CardBody className="grid gap-4">
            <Field label="Person" htmlFor="member">
              <Select id="member" value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">{candidates.isLoading ? 'Loading…' : available.length ? 'Select a person' : 'Everyone is already on the team'}</option>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName}
                    {c.title ? ` — ${c.title}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Role" htmlFor="role">
              <Select id="role" value={role} onChange={(e) => setRole(e.target.value)}>
                {PROJECT_TEAM_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {enumLabel(r)}
                  </option>
                ))}
              </Select>
            </Field>
            <Button disabled={!userId} loading={add.isPending} onClick={() => add.mutate(undefined)}>
              <UserPlus /> Add to team
            </Button>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
