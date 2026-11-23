'use client';

import * as React from 'react';
import { Input, Select } from '@estate/ui';
import { useApi } from '@/lib/hooks';
import type { Department, EmployeeOption } from './types';

/** Native select of active employees (value = employee id, or user id with valueKey="userId"). */
export const EmployeeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { placeholder?: string; valueKey?: 'id' | 'userId'; exclude?: string }>(function EmployeeSelect({ placeholder = 'Select employee', valueKey = 'id', exclude, ...props }, ref) {
  const q = useApi<EmployeeOption[]>('/hr/employees/options');
  return (
    <Select ref={ref} {...props}>
      <option value="">{q.isLoading ? 'Loading…' : placeholder}</option>
      {(q.data ?? [])
        .filter((e) => e[valueKey] !== exclude)
        .map((e) => (
          <option key={e.id} value={e[valueKey]}>
            {e.user.fullName} · {e.employeeCode}
            {e.designation ? ` · ${e.designation.name}` : ''}
          </option>
        ))}
    </Select>
  );
});

export function DepartmentFilter({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const q = useApi<Department[]>('/hr/departments');
  return (
    <div className="w-full sm:w-52">
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} aria-label="Department">
        <option value="">All departments</option>
        {(q.data ?? []).map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function MonthInput({ value, onChange, max }: { value: string; onChange: (v: string) => void; max?: string }) {
  return (
    <div className="w-full sm:w-44">
      <Input type="month" value={value} max={max} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label="Month" />
    </div>
  );
}

export function DateInput({ value, onChange, max }: { value: string; onChange: (v: string) => void; max?: string }) {
  return (
    <div className="w-full sm:w-44">
      <Input type="date" value={value} max={max} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label="Date" />
    </div>
  );
}
