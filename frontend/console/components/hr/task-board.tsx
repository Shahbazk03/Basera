'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ListChecks, Plus } from 'lucide-react';
import { enumLabel, formatDateTime, TASK_PRIORITIES, TASK_STATUSES, taskSchema, type Paginated } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Badge, Button, Card, Dialog, DialogContent, DialogFooter, Field, Input, Pagination, Select, StatusBadge, Table, TBody, TD, TH, THead, TR, Textarea, toast } from '@estate/ui';
import { api } from '@/lib/api';
import { applyServerErrors, useApi, useApiMutation, useListParams } from '@/lib/hooks';
import { SearchBox, StatusTabs, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';
import { EmployeeSelect } from './pickers';

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  overdue: boolean;
  canEdit: boolean;
  canUpdateStatus: boolean;
  assignedTo: { id: string; fullName: string };
  createdBy: { id: string; fullName: string } | null;
  lead: { id: string; leadNo: string; name: string } | null;
}

const PRIORITY_TONE: Record<string, 'neutral' | 'warning' | 'danger' | 'info'> = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warning', URGENT: 'danger' };

/** Task list used for "My tasks" (scope=mine) and the HR task board (scope=all). */
export function TaskBoard({ scope, canCreate }: { scope: 'mine' | 'all'; canCreate: boolean }) {
  const { values, set, page, setPage } = useListParams<{ tstatus?: string; q?: string; assignee?: string }>();
  const q = useApi<Paginated<TaskRow> & { statusCounts: Record<string, number> }>('/hr/tasks', { scope, status: values.tstatus, q: values.q, assignedToId: values.assignee, page, pageSize: 25 });
  const [creating, setCreating] = React.useState(false);
  const update = useApiMutation((v: { id: string; status: string }) => api.patch(`/hr/tasks/${v.id}`, { status: v.status }), { success: 'Task updated', invalidate: ['/hr/tasks'] });

  return (
    <Card>
      <StatusTabs
        tabs={[
          { value: undefined, label: scope === 'mine' ? 'Open & done' : 'All' },
          { value: 'TODO', label: 'To do' },
          { value: 'IN_PROGRESS', label: 'In progress' },
          { value: 'DONE', label: 'Done' },
          { value: 'CANCELLED', label: 'Cancelled' },
        ]}
        value={values.tstatus}
        onChange={(v) => set({ tstatus: v })}
        counts={q.data?.statusCounts}
      />
      <Toolbar>
        <SearchBox value={values.q} onChange={(v) => set({ q: v })} placeholder="Search tasks" />
        {scope === 'all' ? (
          <div className="w-full sm:w-64">
            <EmployeeSelect valueKey="userId" placeholder="All assignees" value={values.assignee ?? ''} onChange={(e) => set({ assignee: e.target.value || undefined })} aria-label="Assignee" />
          </div>
        ) : null}
        {canCreate ? (
          <Button size="sm" className="sm:ml-auto" onClick={() => setCreating(true)}>
            <Plus /> New task
          </Button>
        ) : null}
      </Toolbar>
      <QueryState query={q} isEmpty={(d) => d.data.length === 0} empty={{ icon: <ListChecks />, title: scope === 'mine' ? 'No tasks assigned to you' : 'No tasks match these filters' }}>
        {(d) => (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Task</TH>
                  {scope === 'all' ? <TH className="hidden md:table-cell">Assignee</TH> : null}
                  <TH className="hidden sm:table-cell">Due</TH>
                  <TH>Priority</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <TBody>
                {d.data.map((t) => (
                  <TR key={t.id}>
                    <TD>
                      <div className="font-medium text-ink-900">{t.title}</div>
                      {t.description ? <div className="line-clamp-1 max-w-md text-xs text-ink-500">{t.description}</div> : null}
                      <div className="mt-0.5 text-[11.5px] text-ink-400">
                        {t.lead ? (
                          <Link href={`/crm/leads/${t.lead.id}`} className="text-brand hover:underline">
                            {t.lead.leadNo} · {t.lead.name}
                          </Link>
                        ) : null}
                        {t.createdBy ? `${t.lead ? ' · ' : ''}from ${t.createdBy.fullName}` : ''}
                      </div>
                    </TD>
                    {scope === 'all' ? <TD className="hidden md:table-cell">{t.assignedTo.fullName}</TD> : null}
                    <TD className="hidden whitespace-nowrap sm:table-cell">
                      {t.dueAt ? <span className={t.overdue ? 'font-medium text-danger' : ''}>{formatDateTime(t.dueAt)}</span> : <span className="text-ink-400">—</span>}
                      {t.overdue ? <Badge tone="danger" size="sm" className="ml-1.5">Overdue</Badge> : null}
                    </TD>
                    <TD>
                      <Badge tone={PRIORITY_TONE[t.priority] ?? 'neutral'}>{enumLabel(t.priority)}</Badge>
                    </TD>
                    <TD>
                      {t.canUpdateStatus ? (
                        <Select
                          aria-label={`Status of ${t.title}`}
                          value={t.status}
                          disabled={update.isPending}
                          onChange={(e) => update.mutate({ id: t.id, status: e.target.value })}
                          className="h-8 w-36 text-[13px]"
                        >
                          {TASK_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {enumLabel(s)}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <StatusBadge status={t.status} />
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <div className="border-t border-line px-4 py-3">
              <Pagination page={page} totalPages={d.meta.totalPages} total={d.meta.total} pageSize={d.meta.pageSize} onPageChange={setPage} />
            </div>
          </>
        )}
      </QueryState>
      {creating ? <TaskDialog onClose={() => setCreating(false)} onSaved={() => void q.refetch()} /> : null}
    </Card>
  );
}

function TaskDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const form = useForm<z.input<typeof taskSchema>>({ resolver: zodResolver(taskSchema), defaultValues: { title: '', priority: 'MEDIUM' } });
  const errors = form.formState.errors;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="New task">
        <form
          noValidate
          className="grid gap-4"
          onSubmit={form.handleSubmit(async (v) => {
            try {
              await api.post('/hr/tasks', v);
              toast.success('Task assigned');
              onSaved();
              onClose();
            } catch (err) {
              if (!applyServerErrors(form, err)) toast.error(errorMessage(err));
            }
          })}
        >
          <Field label="Title" htmlFor="tTitle" required error={errors.title?.message}>
            <Input id="tTitle" {...form.register('title')} />
          </Field>
          <Field label="Details" htmlFor="tDesc">
            <Textarea id="tDesc" rows={3} {...form.register('description')} />
          </Field>
          <Field label="Assign to" htmlFor="tAssignee" required error={errors.assignedToId?.message}>
            <EmployeeSelect id="tAssignee" valueKey="userId" {...form.register('assignedToId')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Due (IST)" htmlFor="tDue" error={errors.dueAt?.message}>
              <Input id="tDue" type="datetime-local" {...form.register('dueAt', { setValueAs: (x) => (x ? `${x}:00+05:30` : null) })} />
            </Field>
            <Field label="Priority" htmlFor="tPriority">
              <Select id="tPriority" {...form.register('priority')}>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {enumLabel(p)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Assign task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
