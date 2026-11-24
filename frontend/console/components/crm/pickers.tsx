'use client';

import * as React from 'react';
import { Select } from '@estate/ui';
import { useApi } from '@/lib/hooks';
import type { Assignee } from './types';

/** People who can receive leads in an organisation (with their open-lead load). */
export function useAssignees(organizationId?: string | null, enabled = true) {
  return useApi<Assignee[]>(enabled ? '/crm/assignees' : null, organizationId ? { organizationId } : undefined, { staleTime: 60_000 });
}

export function AssigneeSelect({ organizationId, value, onChange, placeholder = 'Select a person', id, includeEmpty = true, invalid }: { organizationId?: string | null; value: string; onChange: (v: string) => void; placeholder?: string; id?: string; includeEmpty?: boolean; invalid?: boolean }) {
  const q = useAssignees(organizationId);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid}>
      {includeEmpty ? <option value="">{q.isLoading ? 'Loading…' : placeholder}</option> : null}
      {(q.data ?? []).map((u) => (
        <option key={u.id} value={u.id}>
          {u.fullName} · {u.openLeads} open
        </option>
      ))}
    </Select>
  );
}

export interface SourceOption {
  id: string;
  key: string;
  name: string;
  isActive: boolean;
  isSystem: boolean;
}

export function useLeadSources() {
  return useApi<SourceOption[]>('/crm/lead-sources', undefined, { staleTime: 300_000 });
}

export interface ProjectOption {
  id: string;
  name: string;
  slug: string;
}

/** Public project list (published projects) for pickers. */
export function useProjectOptions() {
  const q = useApi<{ data: ProjectOption[] }>('/public/projects', { pageSize: 48 }, { staleTime: 300_000 });
  return { ...q, options: q.data?.data ?? [] };
}

/** Datetime-local input value for "now + minutes" in the browser's timezone. */
export function localInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toIso(local: string): string {
  return new Date(local).toISOString();
}
