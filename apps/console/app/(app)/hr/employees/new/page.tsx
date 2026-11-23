'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ChevronLeft } from 'lucide-react';
import { employeeCreateSchema, localDateString } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Alert, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, PageHeader, Skeleton, toast } from '@estate/ui';
import { api } from '@/lib/api';
import { applyServerErrors, useApi } from '@/lib/hooks';
import { JobFields, PersonalFields, useJobOptionsReady } from '@/components/hr/employee-form-fields';

type Values = z.input<typeof employeeCreateSchema>;
interface AssignableRole {
  key: string;
  name: string;
  description: string | null;
}

export default function NewEmployeePage() {
  const router = useRouter();
  const roles = useApi<AssignableRole[]>('/hr/employees/assignable-roles');
  const optionsReady = useJobOptionsReady();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(employeeCreateSchema),
    defaultValues: { employmentType: 'FULL_TIME', employmentStatus: 'PROBATION', roleKeys: [], joiningDate: localDateString(new Date()) },
  });
  const errors = form.formState.errors as Record<string, { message?: string }>;

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const payload = { ...values, password: values.password || undefined };
      const created = await api.post<{ id: string }>('/hr/employees', payload);
      toast.success(values.password ? 'Employee added' : 'Employee added — an email with a link to set their password was queued');
      router.push(`/hr/employees/${created.id}`);
    } catch (err) {
      if (!applyServerErrors(form, err)) setError(errorMessage(err));
      else setError('Please correct the highlighted fields.');
    }
  });

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Link href="/hr/employees" className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
            <ChevronLeft className="size-4" /> Employees
          </Link>
        }
        title="Add employee"
        description="Creates the staff login, the employee record and this year's leave balances."
      />
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Card>
          <CardHeader title="Personal details" />
          <CardBody className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <PersonalFields register={form.register} errors={form.formState.errors as never} />
            <Field label="Work email (login)" htmlFor="email" required error={errors.email?.message}>
              <Input id="email" type="email" autoComplete="off" aria-invalid={Boolean(errors.email)} {...form.register('email')} />
            </Field>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Job" />
          <CardBody className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {optionsReady ? <JobFields register={form.register} errors={form.formState.errors as never} /> : <Skeleton className="h-48 sm:col-span-2 lg:col-span-3" />}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Access" description="Roles are granted within the company organisation. Administrator roles are managed separately by user administration." />
          <CardBody className="grid gap-5">
            <Controller
              control={form.control}
              name="roleKeys"
              render={({ field }) => {
                const selected = new Set(field.value ?? []);
                return (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(roles.data ?? []).map((r) => (
                      <label key={r.key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line px-3.5 py-3 transition-colors hover:border-ink-300">
                        <Checkbox
                          className="mt-0.5"
                          checked={selected.has(r.key)}
                          onCheckedChange={(v) => {
                            const next = new Set(selected);
                            if (v) next.add(r.key);
                            else next.delete(r.key);
                            field.onChange([...next]);
                          }}
                        />
                        <span>
                          <span className="block text-sm font-medium text-ink-900">{r.name}</span>
                          {r.description ? <span className="block text-[12.5px] text-ink-500">{r.description}</span> : null}
                        </span>
                      </label>
                    ))}
                    {roles.data && roles.data.length === 0 ? <p className="text-sm text-ink-500">You cannot grant any roles. The employee will have self-service access only.</p> : null}
                  </div>
                );
              }}
            />
            <Field label="Initial password" htmlFor="password" hint="Optional. Leave blank to email the employee a link to set their own password (valid for 72 hours)." error={errors.password?.message}>
              <Input id="password" type="password" autoComplete="new-password" className="max-w-sm" {...form.register('password', { setValueAs: (v) => (v ? v : undefined) })} />
            </Field>
          </CardBody>
        </Card>
        <div className="flex justify-end gap-2">
          <Button variant="outline" asChild>
            <Link href="/hr/employees">Cancel</Link>
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting}>
            Add employee
          </Button>
        </div>
      </form>
    </>
  );
}
