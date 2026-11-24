'use client';

import * as React from 'react';
import type { FieldErrors, FieldValues, UseFormRegister } from 'react-hook-form';
import { EMPLOYMENT_STATUSES, EMPLOYMENT_TYPES, enumLabel } from '@estate/shared';
import { Field, Input, Select } from '@estate/ui';
import { useApi } from '@/lib/hooks';
import { EmployeeSelect } from './pickers';
import type { Department, Designation, Shift } from './types';

export const nullable = { setValueAs: (v: unknown) => (v === '' || v === undefined ? null : v) };

type AnyErrors = FieldErrors<FieldValues>;

export function PersonalFields<T extends FieldValues>({ register: reg, errors, disabled }: { register: UseFormRegister<T>; errors: AnyErrors; disabled?: boolean }) {
  const register = reg as unknown as UseFormRegister<FieldValues>;
  const e = (k: string) => (errors[k]?.message as string | undefined) ?? undefined;
  return (
    <>
      <Field label="Full name" htmlFor="fullName" required error={e('fullName')}>
        <Input id="fullName" disabled={disabled} aria-invalid={Boolean(errors.fullName)} {...register('fullName')} />
      </Field>
      <Field label="Mobile number" htmlFor="phone" error={e('phone')}>
        <Input id="phone" inputMode="tel" disabled={disabled} aria-invalid={Boolean(errors.phone)} {...register('phone', nullable)} />
      </Field>
      <Field label="Date of birth" htmlFor="dateOfBirth" error={e('dateOfBirth')}>
        <Input id="dateOfBirth" type="date" disabled={disabled} {...register('dateOfBirth', nullable)} />
      </Field>
      <Field label="Gender" htmlFor="gender">
        <Select id="gender" disabled={disabled} {...register('gender', nullable)}>
          <option value="">Prefer not to say</option>
          <option value="Female">Female</option>
          <option value="Male">Male</option>
          <option value="Non-binary">Non-binary</option>
        </Select>
      </Field>
      <Field label="Personal email" htmlFor="personalEmail" error={e('personalEmail')}>
        <Input id="personalEmail" type="email" disabled={disabled} aria-invalid={Boolean(errors.personalEmail)} {...register('personalEmail', nullable)} />
      </Field>
      <Field label="Emergency contact" htmlFor="emergencyContact" hint="Name, relation and phone">
        <Input id="emergencyContact" disabled={disabled} {...register('emergencyContact', nullable)} />
      </Field>
    </>
  );
}

/**
 * Native selects only show their registered value if the matching <option> exists when they mount,
 * so editors must wait for every option list before rendering JobFields.
 */
export function useJobOptionsReady(): boolean {
  const departments = useApi<Department[]>('/hr/departments');
  const designations = useApi<Designation[]>('/hr/designations');
  const shifts = useApi<Shift[]>('/hr/shifts');
  const employees = useApi<unknown[]>('/hr/employees/options');
  return Boolean(departments.data && designations.data && shifts.data && employees.data);
}

export function JobFields<T extends FieldValues>({ register: reg, errors, disabled, selfId }: { register: UseFormRegister<T>; errors: AnyErrors; disabled?: boolean; selfId?: string }) {
  const register = reg as unknown as UseFormRegister<FieldValues>;
  const departments = useApi<Department[]>('/hr/departments');
  const designations = useApi<Designation[]>('/hr/designations');
  const shifts = useApi<Shift[]>('/hr/shifts');
  const e = (k: string) => (errors[k]?.message as string | undefined) ?? undefined;
  return (
    <>
      <Field label="Employee code" htmlFor="employeeCode" required error={e('employeeCode')}>
        <Input id="employeeCode" disabled={disabled} aria-invalid={Boolean(errors.employeeCode)} {...register('employeeCode')} />
      </Field>
      <Field label="Department" htmlFor="departmentId" error={e('departmentId')}>
        <Select id="departmentId" disabled={disabled} {...register('departmentId', nullable)}>
          <option value="">No department</option>
          {(departments.data ?? []).filter((d) => d.isActive).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Designation" htmlFor="designationId" error={e('designationId')}>
        <Select id="designationId" disabled={disabled} {...register('designationId', nullable)}>
          <option value="">No designation</option>
          {(designations.data ?? []).filter((d) => d.isActive).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Reports to" htmlFor="managerId" error={e('managerId')}>
        <EmployeeSelect id="managerId" placeholder="No manager" exclude={selfId} disabled={disabled} {...register('managerId', nullable)} />
      </Field>
      <Field label="Shift" htmlFor="shiftId" hint="Defaults to the organisation's default shift">
        <Select id="shiftId" disabled={disabled} {...register('shiftId', nullable)}>
          <option value="">Default shift</option>
          {(shifts.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.startTime}–{s.endTime})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Joining date" htmlFor="joiningDate" required error={e('joiningDate')}>
        <Input id="joiningDate" type="date" disabled={disabled} aria-invalid={Boolean(errors.joiningDate)} {...register('joiningDate')} />
      </Field>
      <Field label="Employment type" htmlFor="employmentType">
        <Select id="employmentType" disabled={disabled} {...register('employmentType')}>
          {EMPLOYMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {enumLabel(t)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Employment status" htmlFor="employmentStatus" hint="Use “Record exit” to mark an employee as exited">
        <Select id="employmentStatus" disabled={disabled} {...register('employmentStatus')}>
          {EMPLOYMENT_STATUSES.filter((s) => s !== 'EXITED').map((s) => (
            <option key={s} value={s}>
              {enumLabel(s)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Work location" htmlFor="workLocation">
        <Input id="workLocation" disabled={disabled} {...register('workLocation', nullable)} />
      </Field>
    </>
  );
}
