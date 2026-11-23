'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FileUp } from 'lucide-react';
import {
  ACTIVITY_DIRECTIONS,
  DEAL_TYPES,
  enumLabel,
  ENQUIRY_TYPES,
  FOLLOW_UP_TYPES,
  formatINR,
  LEAD_PRIORITIES,
  LISTING_TYPES,
  MANUAL_ACTIVITY_TYPES,
  PAYMENT_METHODS,
  PAYMENT_RECEIVERS,
  phoneSchema,
  localDateString,
} from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Alert, Badge, Button, Dialog, DialogContent, DialogFooter, Field, Input, Segmented, Select, StatusBadge, Table, TBody, TD, TH, THead, TR, Textarea, toast } from '@estate/ui';
import { api } from '@/lib/api';
import { applyServerErrors, useApiMutation } from '@/lib/hooks';
import { AssigneeSelect, localInputValue, toIso, useLeadSources, useProjectOptions } from './pickers';

const numOrNull = { setValueAs: (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v)) };
const strOrNull = { setValueAs: (v: unknown) => (v === '' || v === undefined ? null : v) };

// ───────────────────────── Create lead ─────────────────────────

const createLeadForm = z.object({
  name: z.string().trim().min(2, 'Enter the name').max(100),
  phone: phoneSchema,
  email: z.email('Enter a valid email').optional().or(z.literal('')),
  sourceKey: z.string().min(2, 'Choose a source'),
  projectId: z.string().optional().nullable(),
  enquiryType: z.enum(ENQUIRY_TYPES),
  listingType: z.enum(LISTING_TYPES).optional().nullable(),
  budgetMin: z.number().min(0).optional().nullable(),
  budgetMax: z.number().min(0).optional().nullable(),
  locationPreference: z.string().max(300).optional().nullable(),
  requirement: z.string().max(2000).optional().nullable(),
  priority: z.enum(LEAD_PRIORITIES),
  assignToUserId: z.string().optional().nullable(),
});

export function CreateLeadDialog({ open, onOpenChange, organizationId }: { open: boolean; onOpenChange: (o: boolean) => void; organizationId?: string | null }) {
  const router = useRouter();
  const sources = useLeadSources();
  const projects = useProjectOptions();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<z.input<typeof createLeadForm>>({
    resolver: zodResolver(createLeadForm),
    defaultValues: { name: '', phone: '', email: '', sourceKey: 'WALK_IN', enquiryType: 'GENERAL', priority: 'MEDIUM', assignToUserId: '' },
  });
  const errors = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const res = await api.post<{ created: boolean; lead: { id: string; leadNo: string; name: string } }>('/crm/leads', {
        ...v,
        email: v.email || '',
        projectId: v.projectId || null,
        assignToUserId: v.assignToUserId || null,
        autoAssign: !v.assignToUserId,
        organizationId: organizationId ?? undefined,
      });
      onOpenChange(false);
      form.reset();
      if (res.created) toast.success(`Lead ${res.lead.leadNo} created`);
      else toast.info(`This customer already has an open lead (${res.lead.leadNo}) — opening it`);
      router.push(`/crm/leads/${res.lead.id}`);
    } catch (err) {
      if (!applyServerErrors(form, err)) setError(errorMessage(err));
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add a lead" description="Walk-ins, phone calls and referrals. Duplicate phone numbers are matched to the existing open lead." size="lg">
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          {error ? <Alert tone="danger" className="sm:col-span-2">{error}</Alert> : null}
          <Field label="Name" htmlFor="lead-name" required error={errors.name?.message}>
            <Input id="lead-name" {...form.register('name')} aria-invalid={Boolean(errors.name)} />
          </Field>
          <Field label="Mobile number" htmlFor="lead-phone" required error={errors.phone?.message}>
            <Input id="lead-phone" inputMode="tel" {...form.register('phone')} aria-invalid={Boolean(errors.phone)} />
          </Field>
          <Field label="Email" htmlFor="lead-email" error={errors.email?.message}>
            <Input id="lead-email" type="email" {...form.register('email')} />
          </Field>
          <Field label="Source" htmlFor="lead-source" required error={errors.sourceKey?.message}>
            <Select id="lead-source" {...form.register('sourceKey')}>
              {(sources.data ?? []).filter((s) => s.isActive && s.key !== 'LEAD_PROVIDER').map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Interested in project" htmlFor="lead-project">
            <Select id="lead-project" {...form.register('projectId', strOrNull)}>
              <option value="">No specific project</option>
              {projects.options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Enquiry type" htmlFor="lead-type">
            <Select id="lead-type" {...form.register('enquiryType')}>
              {ENQUIRY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {enumLabel(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Looking to" htmlFor="lead-listing">
            <Select id="lead-listing" {...form.register('listingType', strOrNull)}>
              <option value="">Not specified</option>
              <option value="SALE">Buy</option>
              <option value="RENT">Rent</option>
            </Select>
          </Field>
          <Field label="Priority" htmlFor="lead-priority">
            <Select id="lead-priority" {...form.register('priority')}>
              {LEAD_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {enumLabel(p)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Budget from (₹)" htmlFor="lead-bmin" error={errors.budgetMin?.message}>
            <Input id="lead-bmin" type="number" min={0} {...form.register('budgetMin', numOrNull)} />
          </Field>
          <Field label="Budget up to (₹)" htmlFor="lead-bmax" error={errors.budgetMax?.message}>
            <Input id="lead-bmax" type="number" min={0} {...form.register('budgetMax', numOrNull)} />
          </Field>
          <Field label="Preferred location" htmlFor="lead-loc" className="sm:col-span-2">
            <Input id="lead-loc" placeholder="e.g. Gomti Nagar or near Shaheed Path" {...form.register('locationPreference', strOrNull)} />
          </Field>
          <Field label="Requirement" htmlFor="lead-req" className="sm:col-span-2">
            <Textarea id="lead-req" rows={3} {...form.register('requirement', strOrNull)} />
          </Field>
          <Field label="Assign to" htmlFor="lead-assignee" hint="Leave empty to use the assignment rules." className="sm:col-span-2">
            <Controller control={form.control} name="assignToUserId" render={({ field }) => <AssigneeSelect id="lead-assignee" organizationId={organizationId} value={field.value ?? ''} onChange={field.onChange} placeholder="Automatic (assignment rules)" />} />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Create lead
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Assign ─────────────────────────

export function AssignDialog({ open, onOpenChange, leadIds, organizationId, onDone, title }: { open: boolean; onOpenChange: (o: boolean) => void; leadIds: string[]; organizationId?: string | null; onDone?: () => void; title?: string }) {
  const [mode, setMode] = React.useState<'person' | 'auto'>('person');
  const [userId, setUserId] = React.useState('');
  const [reason, setReason] = React.useState('');
  const single = leadIds.length === 1;
  const mutate = useApiMutation(
    async () => {
      if (single && mode === 'person') return api.post(`/crm/leads/${leadIds[0]}/assign`, { userId, reason: reason || undefined });
      return api.post<{ assigned: number; skipped: number; results: { leadNo?: string; outcome: string; detail: string }[] }>('/crm/leads/bulk-assign', { leadIds, userId: mode === 'person' ? userId : undefined, auto: mode === 'auto' });
    },
    {
      invalidate: ['/crm/leads', '/crm/assignees'],
      onSuccess: (r) => {
        const res = r as { assigned?: number; skipped?: number; results?: { detail: string }[] };
        if (typeof res.assigned === 'number') {
          if (res.assigned) toast.success(`${res.assigned} lead(s) assigned${res.skipped ? `, ${res.skipped} skipped` : ''}`);
          else toast.warning(`No leads were assigned. ${res.results?.[0]?.detail ?? ''}`);
        } else toast.success('Lead assigned');
        onOpenChange(false);
        setUserId('');
        setReason('');
        onDone?.();
      },
    },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title ?? (single ? 'Assign lead' : `Assign ${leadIds.length} leads`)} description="Every assignment is recorded in the lead's history and the assignee is notified.">
        <div className="grid gap-4">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'person', label: 'Choose a person' },
              { value: 'auto', label: 'Use assignment rules' },
            ]}
          />
          {mode === 'person' ? (
            <>
              <Field label="Assign to" htmlFor="assign-user" required>
                <AssigneeSelect id="assign-user" organizationId={organizationId} value={userId} onChange={setUserId} />
              </Field>
              {single ? (
                <Field label="Reason (optional)" htmlFor="assign-reason">
                  <Input id="assign-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer prefers Hindi-speaking executive" />
                </Field>
              ) : null}
            </>
          ) : (
            <Alert tone="info">Only unassigned leads are routed. Each lead goes through the active rules in priority order; leads that match no rule stay unassigned.</Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={mutate.isPending} disabled={mode === 'person' && !userId} onClick={() => mutate.mutate(undefined)}>
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Status change ─────────────────────────

export function StatusDialog({ open, onOpenChange, leadId, to, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; leadId: string; to: string | null; onDone?: () => void }) {
  const [note, setNote] = React.useState('');
  const mutate = useApiMutation(() => api.post(`/crm/leads/${leadId}/status`, to === 'LOST' ? { status: to, lostReason: note, note: undefined } : { status: to, note: note || undefined }), {
    success: `Status updated to ${enumLabel(to ?? '').toLowerCase()}`,
    invalidate: ['/crm/leads'],
    onSuccess: () => {
      setNote('');
      onOpenChange(false);
      onDone?.();
    },
  });
  if (!to) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Mark as ${enumLabel(to).toLowerCase()}`} description={to === 'LOST' ? 'Record why the lead was lost — this helps the team improve.' : 'Add a note for the timeline (optional).'}>
        <Field label={to === 'LOST' ? 'Reason' : 'Note'} htmlFor="status-note" required={to === 'LOST'}>
          <Textarea id="status-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={to === 'LOST' ? 'destructive' : 'primary'} loading={mutate.isPending} disabled={to === 'LOST' && note.trim().length < 3} onClick={() => mutate.mutate(undefined)}>
            Update status
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Activity ─────────────────────────

const activityForm = z.object({
  type: z.enum(MANUAL_ACTIVITY_TYPES),
  direction: z.enum(ACTIVITY_DIRECTIONS).optional().nullable(),
  outcome: z.string().max(80).optional(),
  summary: z.string().trim().min(2, 'Add a short summary').max(300),
  details: z.string().max(4000).optional(),
  durationMinutes: z.number().min(0).max(600).optional().nullable(),
});

export function ActivityDialog({ open, onOpenChange, leadId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; leadId: string; onDone?: () => void }) {
  const form = useForm<z.input<typeof activityForm>>({ resolver: zodResolver(activityForm), defaultValues: { type: 'CALL', direction: 'OUTBOUND', outcome: 'Connected', summary: '', details: '' } });
  const type = form.watch('type');
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post(`/crm/leads/${leadId}/activities`, {
        type: v.type,
        direction: v.type === 'NOTE' ? undefined : v.direction ?? undefined,
        outcome: v.outcome || undefined,
        summary: v.summary,
        details: v.details || undefined,
        durationSeconds: v.durationMinutes ? Math.round(v.durationMinutes * 60) : undefined,
      });
      toast.success('Activity logged');
      form.reset();
      onOpenChange(false);
      onDone?.();
    } catch (err) {
      if (!applyServerErrors(form, err)) toast.error(errorMessage(err));
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Log activity" description="Calls, messages, meetings and notes appear on the lead timeline.">
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="act-type">
            <Select id="act-type" {...form.register('type')}>
              {MANUAL_ACTIVITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {enumLabel(t)}
                </option>
              ))}
            </Select>
          </Field>
          {type !== 'NOTE' ? (
            <Field label="Direction" htmlFor="act-dir">
              <Select id="act-dir" {...form.register('direction', strOrNull)}>
                <option value="OUTBOUND">Outbound</option>
                <option value="INBOUND">Inbound</option>
              </Select>
            </Field>
          ) : (
            <span />
          )}
          {type === 'CALL' ? (
            <>
              <Field label="Outcome" htmlFor="act-outcome">
                <Select id="act-outcome" {...form.register('outcome')}>
                  {['Connected', 'Not reachable', 'Busy', 'Switched off', 'Wrong number', 'Call back later'].map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Duration (minutes)" htmlFor="act-dur">
                <Input id="act-dur" type="number" min={0} step="0.5" {...form.register('durationMinutes', numOrNull)} />
              </Field>
            </>
          ) : null}
          <Field label="Summary" htmlFor="act-summary" required error={form.formState.errors.summary?.message} className="sm:col-span-2">
            <Input id="act-summary" placeholder="e.g. Discussed 3 BHK options and budget" {...form.register('summary')} aria-invalid={Boolean(form.formState.errors.summary)} />
          </Field>
          <Field label="Details" htmlFor="act-details" className="sm:col-span-2">
            <Textarea id="act-details" rows={3} {...form.register('details')} />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Log activity
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Follow-up ─────────────────────────

export function FollowUpDialog({ open, onOpenChange, leadId, organizationId, defaultAssigneeId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; leadId: string; organizationId: string; defaultAssigneeId?: string | null; onDone?: () => void }) {
  const [type, setType] = React.useState('CALL');
  const [dueAt, setDueAt] = React.useState(() => localInputValue(new Date(Date.now() + 24 * 3_600_000)));
  const [notes, setNotes] = React.useState('');
  const [assignee, setAssignee] = React.useState(defaultAssigneeId ?? '');
  React.useEffect(() => setAssignee(defaultAssigneeId ?? ''), [defaultAssigneeId]);
  const mutate = useApiMutation(() => api.post(`/crm/leads/${leadId}/follow-ups`, { type, dueAt: toIso(dueAt), notes: notes || undefined, assignedToId: assignee || undefined }), {
    success: 'Follow-up scheduled',
    invalidate: ['/crm/leads', '/crm/follow-ups'],
    onSuccess: () => {
      setNotes('');
      onOpenChange(false);
      onDone?.();
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Schedule follow-up" description="The assignee gets a reminder before it is due.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="fu-type">
            <Select id="fu-type" value={type} onChange={(e) => setType(e.target.value)}>
              {FOLLOW_UP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {enumLabel(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due" htmlFor="fu-due" required>
            <Input id="fu-due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </Field>
          <Field label="Assign to" htmlFor="fu-assignee" className="sm:col-span-2">
            <AssigneeSelect id="fu-assignee" organizationId={organizationId} value={assignee} onChange={setAssignee} placeholder="Me" />
          </Field>
          <Field label="Notes" htmlFor="fu-notes" className="sm:col-span-2">
            <Textarea id="fu-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={mutate.isPending} disabled={!dueAt} onClick={() => mutate.mutate(undefined)}>
            Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CompleteFollowUpDialog({ followUp, onOpenChange, onDone }: { followUp: { id: string; type: string } | null; onOpenChange: (o: boolean) => void; onDone?: () => void }) {
  const [outcome, setOutcome] = React.useState('');
  const [status, setStatus] = React.useState<'COMPLETED' | 'CANCELLED'>('COMPLETED');
  const mutate = useApiMutation(() => api.post(`/crm/follow-ups/${followUp!.id}/complete`, { outcome, status }), {
    success: status === 'COMPLETED' ? 'Follow-up completed' : 'Follow-up cancelled',
    invalidate: ['/crm/leads', '/crm/follow-ups'],
    onSuccess: () => {
      setOutcome('');
      onOpenChange(false);
      onDone?.();
    },
  });
  return (
    <Dialog open={Boolean(followUp)} onOpenChange={onOpenChange}>
      {followUp ? (
        <DialogContent title="Close follow-up" description={`${enumLabel(followUp.type)} follow-up`}>
          <div className="grid gap-4">
            <Segmented
              value={status}
              onChange={setStatus}
              options={[
                { value: 'COMPLETED', label: 'Completed' },
                { value: 'CANCELLED', label: 'Cancelled' },
              ]}
            />
            <Field label="Outcome" htmlFor="fu-outcome" required>
              <Textarea id="fu-outcome" rows={3} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="What happened? Next step?" />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button loading={mutate.isPending} disabled={outcome.trim().length < 2} onClick={() => mutate.mutate(undefined)}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

// ───────────────────────── Site visit ─────────────────────────

export function ScheduleVisitDialog({
  open,
  onOpenChange,
  lead,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lead: { id: string; organizationId: string; assignedTo: { id: string } | null; project: { id: string; name: string } | null; property: { id: string; title: string } | null; unit: { id: string; code: string } | null };
  onDone?: () => void;
}) {
  const [when, setWhen] = React.useState(() => localInputValue(new Date(Date.now() + 2 * 86_400_000)));
  const [assignee, setAssignee] = React.useState(lead.assignedTo?.id ?? '');
  const [meetingPoint, setMeetingPoint] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const mutate = useApiMutation(
    () =>
      api.post('/crm/site-visits', {
        leadId: lead.id,
        scheduledAt: toIso(when),
        projectId: lead.property ? null : lead.project?.id ?? null,
        propertyId: lead.property?.id ?? null,
        unitId: lead.unit?.id ?? null,
        assignedToId: assignee || null,
        meetingPoint: meetingPoint || null,
        notes: notes || null,
      }),
    {
      success: 'Site visit scheduled — the customer has been notified',
      invalidate: ['/crm/leads', '/crm/site-visits'],
      onSuccess: () => {
        onOpenChange(false);
        onDone?.();
      },
    },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Schedule site visit" description={lead.property ? lead.property.title : lead.project ? `${lead.project.name}${lead.unit ? ` · unit ${lead.unit.code}` : ''}` : 'No property linked to this lead yet'}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date & time" htmlFor="sv-when" required>
            <Input id="sv-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Field label="Accompanied by" htmlFor="sv-assignee">
            <AssigneeSelect id="sv-assignee" organizationId={lead.organizationId} value={assignee} onChange={setAssignee} placeholder="Me" />
          </Field>
          <Field label="Meeting point" htmlFor="sv-meet" className="sm:col-span-2">
            <Input id="sv-meet" value={meetingPoint} onChange={(e) => setMeetingPoint(e.target.value)} placeholder="e.g. Project site office" />
          </Field>
          <Field label="Notes" htmlFor="sv-notes" className="sm:col-span-2">
            <Textarea id="sv-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={mutate.isPending} disabled={!when} onClick={() => mutate.mutate(undefined)}>
            Schedule visit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const VISIT_NEXT: Record<string, { status: string; label: string }[]> = {
  REQUESTED: [
    { status: 'CONFIRMED', label: 'Confirm' },
    { status: 'CANCELLED', label: 'Cancel' },
  ],
  SCHEDULED: [
    { status: 'CONFIRMED', label: 'Confirm' },
    { status: 'COMPLETED', label: 'Complete' },
    { status: 'NO_SHOW', label: 'No-show' },
    { status: 'CANCELLED', label: 'Cancel' },
  ],
  CONFIRMED: [
    { status: 'COMPLETED', label: 'Complete' },
    { status: 'NO_SHOW', label: 'No-show' },
    { status: 'CANCELLED', label: 'Cancel' },
  ],
  CANCELLED: [],
  NO_SHOW: [],
  COMPLETED: [],
};

export function UpdateVisitDialog({ visit, onOpenChange, onDone }: { visit: { id: string; status: string; scheduledAt: string; outcome: string | null } | null; onOpenChange: (o: boolean) => void; onDone?: () => void }) {
  const [status, setStatus] = React.useState('');
  const [when, setWhen] = React.useState('');
  const [outcome, setOutcome] = React.useState('');
  const [feedback, setFeedback] = React.useState('');
  React.useEffect(() => {
    if (visit) {
      setStatus('');
      setWhen(localInputValue(new Date(visit.scheduledAt)));
      setOutcome(visit.outcome ?? '');
      setFeedback('');
    }
  }, [visit]);
  const mutate = useApiMutation(
    () => {
      const rescheduled = visit && toIso(when) !== new Date(visit.scheduledAt).toISOString();
      return api.patch(`/crm/site-visits/${visit!.id}`, {
        ...(status ? { status } : {}),
        ...(rescheduled ? { scheduledAt: toIso(when) } : {}),
        ...(outcome ? { outcome } : {}),
        ...(feedback ? { customerFeedback: feedback } : {}),
      });
    },
    {
      success: 'Site visit updated',
      invalidate: ['/crm/leads', '/crm/site-visits'],
      onSuccess: () => {
        onOpenChange(false);
        onDone?.();
      },
    },
  );
  const options = visit ? VISIT_NEXT[visit.status] ?? [] : [];
  return (
    <Dialog open={Boolean(visit)} onOpenChange={onOpenChange}>
      {visit ? (
        <DialogContent title="Update site visit" description={<span className="inline-flex items-center gap-2">Current status <StatusBadge status={visit.status} size="sm" /></span>}>
          <div className="grid gap-4">
            {options.length ? (
              <Field label="Outcome of the visit">
                <div className="flex flex-wrap gap-2">
                  {options.map((o) => (
                    <Button key={o.status} size="sm" variant={status === o.status ? 'primary' : 'outline'} onClick={() => setStatus(status === o.status ? '' : o.status)}>
                      {o.label}
                    </Button>
                  ))}
                </div>
              </Field>
            ) : null}
            {visit.status !== 'COMPLETED' ? (
              <Field label="Date & time" htmlFor="uv-when" hint={['CANCELLED', 'NO_SHOW'].includes(visit.status) ? 'Choose a new time to reschedule this visit.' : 'Change to reschedule — the customer is notified.'}>
                <Input id="uv-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              </Field>
            ) : null}
            {status === 'COMPLETED' || visit.status === 'COMPLETED' ? (
              <>
                <Field label="Visit outcome" htmlFor="uv-outcome" required>
                  <Textarea id="uv-outcome" rows={3} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="What did the customer think? Next step?" />
                </Field>
                <Field label="Customer feedback" htmlFor="uv-fb">
                  <Textarea id="uv-fb" rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
                </Field>
              </>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button loading={mutate.isPending} disabled={status === 'COMPLETED' && outcome.trim().length < 2} onClick={() => mutate.mutate(undefined)}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

// ───────────────────────── Deal ─────────────────────────

const dealForm = z.object({
  dealType: z.enum(DEAL_TYPES),
  dealValue: z.number({ error: 'Enter the deal value' }).positive('Enter the deal value'),
  expectedRevenue: z.number().min(0).optional().nullable(),
  bookingDate: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  useUnit: z.boolean(),
  useProperty: z.boolean(),
});

export function DealDialog({ open, onOpenChange, lead, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; lead: { id: string; property: { id: string; title: string; price: number } | null; project: { id: string; name: string } | null; unit: { id: string; code: string; status: string; totalPrice: number } | null }; onDone?: (dealId: string) => void }) {
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<z.input<typeof dealForm>>({
    resolver: zodResolver(dealForm),
    defaultValues: { dealType: 'SALE', dealValue: lead.unit ? Number(lead.unit.totalPrice) : lead.property ? Number(lead.property.price) : undefined, useUnit: Boolean(lead.unit), useProperty: Boolean(lead.property), bookingDate: '' },
  });
  const useUnit = form.watch('useUnit');
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const deal = await api.post<{ id: string; dealNo: string }>('/crm/deals', {
        leadId: lead.id,
        dealType: v.dealType,
        dealValue: v.dealValue,
        expectedRevenue: v.expectedRevenue ?? null,
        bookingDate: v.bookingDate || null,
        notes: v.notes || null,
        unitId: v.useUnit && lead.unit ? lead.unit.id : null,
        projectId: lead.project?.id ?? null,
        propertyId: v.useProperty && lead.property ? lead.property.id : null,
      });
      toast.success(`Deal ${deal.dealNo} recorded`);
      onOpenChange(false);
      onDone?.(deal.id);
    } catch (err) {
      if (!applyServerErrors(form, err)) setError(errorMessage(err));
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Record a deal" description="Bookings are recorded manually — no payment is taken online. Customer payments are tracked separately from company revenue." size="lg">
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          {error ? <Alert tone="danger" className="sm:col-span-2">{error}</Alert> : null}
          {lead.unit ? (
            <label className="flex items-start gap-2.5 rounded-lg border border-line p-3 text-sm sm:col-span-2">
              <input type="checkbox" className="mt-1" {...form.register('useUnit')} />
              <span>
                <span className="font-medium text-ink-900">
                  Book unit {lead.unit.code} ({lead.project?.name})
                </span>
                <span className="block text-xs text-ink-500">
                  Currently <StatusBadge status={lead.unit.status} size="sm" /> · list price {formatINR(lead.unit.totalPrice)}. The unit is locked atomically — if someone else books it first, you will be told.
                </span>
              </span>
            </label>
          ) : null}
          {lead.property ? (
            <label className="flex items-start gap-2.5 rounded-lg border border-line p-3 text-sm sm:col-span-2">
              <input type="checkbox" className="mt-1" {...form.register('useProperty')} />
              <span>
                <span className="font-medium text-ink-900">Linked listing: {lead.property.title}</span>
                <span className="block text-xs text-ink-500">The listing is marked “under offer” until the deal closes.</span>
              </span>
            </label>
          ) : null}
          <Field label="Deal type" htmlFor="deal-type">
            <Select id="deal-type" {...form.register('dealType')}>
              {DEAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {{ SALE: 'Sale', RENT: 'Rent', LEASE: 'Lease' }[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Deal value (₹)" htmlFor="deal-value" required error={form.formState.errors.dealValue?.message}>
            <Input id="deal-value" type="number" min={0} {...form.register('dealValue', numOrNull)} aria-invalid={Boolean(form.formState.errors.dealValue)} />
          </Field>
          <Field label="Expected company revenue (₹)" htmlFor="deal-rev" hint="Brokerage or margin the company expects to earn.">
            <Input id="deal-rev" type="number" min={0} {...form.register('expectedRevenue', numOrNull)} />
          </Field>
          <Field label="Booking date" htmlFor="deal-date" hint={useUnit ? 'Defaults to today.' : 'Leave empty to record an open deal.'}>
            <Input id="deal-date" type="date" {...form.register('bookingDate')} />
          </Field>
          <Field label="Notes" htmlFor="deal-notes" className="sm:col-span-2">
            <Textarea id="deal-notes" rows={3} {...form.register('notes')} />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Record deal
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PaymentDialog({ open, onOpenChange, dealId, balance, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; dealId: string; balance: number; onDone?: () => void }) {
  const [amount, setAmount] = React.useState('');
  const [receivedOn, setReceivedOn] = React.useState(() => localDateString(new Date()));
  const [receivedBy, setReceivedBy] = React.useState('DEVELOPER');
  const [method, setMethod] = React.useState('BANK_TRANSFER');
  const [referenceNo, setReferenceNo] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const mutate = useApiMutation(() => api.post(`/crm/deals/${dealId}/payments`, { amount: Number(amount), receivedOn, receivedBy, method, referenceNo: referenceNo || null, notes: notes || null }), {
    success: 'Payment recorded',
    invalidate: ['/crm/deals'],
    onSuccess: () => {
      setAmount('');
      setReferenceNo('');
      setNotes('');
      onOpenChange(false);
      onDone?.();
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Record customer payment" description={`Money paid by the customer towards this deal (balance ${formatINR(balance)}). This is not company revenue.`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount (₹)" htmlFor="pay-amount" required>
            <Input id="pay-amount" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Received on" htmlFor="pay-date" required>
            <Input id="pay-date" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
          </Field>
          <Field label="Received by" htmlFor="pay-by">
            <Select id="pay-by" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)}>
              {PAYMENT_RECEIVERS.map((r) => (
                <option key={r} value={r}>
                  {enumLabel(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Method" htmlFor="pay-method">
            <Select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {enumLabel(m)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reference number" htmlFor="pay-ref" className="sm:col-span-2">
            <Input id="pay-ref" value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} placeholder="UTR / cheque number" />
          </Field>
          <Field label="Notes" htmlFor="pay-notes" className="sm:col-span-2">
            <Textarea id="pay-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={mutate.isPending} disabled={!(Number(amount) > 0) || !receivedOn} onClick={() => mutate.mutate(undefined)}>
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── CSV import (preview → commit) ─────────────────────────

interface ImportResult {
  committed: boolean;
  summary: Record<string, number>;
  results: { row: number; name: string; phone: string; outcome: string; message: string; leadNo?: string }[];
}

const OUTCOME_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  READY: 'info',
  CREATED: 'success',
  ACCEPTED: 'success',
  DUPLICATE: 'warning',
  PENDING_REVIEW: 'info',
  INVALID: 'danger',
};

export function CsvImportDialog({
  open,
  onOpenChange,
  endpoint,
  extraBody,
  title,
  description,
  columns,
  onDone,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  endpoint: string;
  extraBody?: Record<string, unknown>;
  title: string;
  description: string;
  columns: readonly string[];
  onDone?: () => void;
  children?: React.ReactNode;
}) {
  const [csv, setCsv] = React.useState<string | null>(null);
  const [fileName, setFileName] = React.useState('');
  const [result, setResult] = React.useState<ImportResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) {
      setCsv(null);
      setFileName('');
      setResult(null);
      setError(null);
    }
  }, [open]);

  async function run(commit: boolean) {
    if (!csv) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<ImportResult>(endpoint, { csv, commit, ...extraBody });
      setResult(res);
      if (commit) {
        toast.success('Import finished');
        onDone?.();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const counts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const r of result?.results ?? []) m.set(r.outcome, (m.get(r.outcome) ?? 0) + 1);
    return [...m.entries()];
  }, [result]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description} size="xl">
        <div className="grid gap-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="flex flex-col gap-3 rounded-lg border border-dashed border-line-strong bg-ink-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <p className="font-medium text-ink-900">{fileName || 'Choose a CSV file'}</p>
              <p className="mt-0.5 text-xs text-ink-500">
                Columns: <span className="font-mono">{columns.join(', ')}</span> — name and phone are required.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
              <FileUp /> Select file
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 600_000) {
                  setError('The file is too large (max ~600 KB).');
                  return;
                }
                setFileName(f.name);
                setResult(null);
                setCsv(await f.text());
                if (inputRef.current) inputRef.current.value = '';
              }}
            />
          </div>
          {children}
          {result ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-ink-500">{result.committed ? 'Imported:' : 'Preview:'}</span>
                {counts.map(([k, v]) => (
                  <Badge key={k} tone={OUTCOME_TONE[k] ?? 'neutral'}>
                    {enumLabel(k)} {v}
                  </Badge>
                ))}
              </div>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
                <Table>
                  <THead>
                    <tr>
                      <TH>Row</TH>
                      <TH>Name</TH>
                      <TH>Phone</TH>
                      <TH>Result</TH>
                      <TH>Details</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {result.results.map((r) => (
                      <TR key={r.row}>
                        <TD className="tabular text-ink-500">{r.row}</TD>
                        <TD>{r.name || '—'}</TD>
                        <TD className="tabular">{r.phone || '—'}</TD>
                        <TD>
                          <Badge tone={OUTCOME_TONE[r.outcome] ?? 'neutral'} size="sm">
                            {enumLabel(r.outcome)}
                          </Badge>
                        </TD>
                        <TD className="text-xs text-ink-600">
                          {r.message}
                          {r.leadNo ? <span className="ml-1 font-medium text-ink-900">{r.leadNo}</span> : null}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {result?.committed ? 'Close' : 'Cancel'}
          </Button>
          {!result?.committed ? (
            <>
              <Button variant="outline" disabled={!csv} loading={busy && !result} onClick={() => void run(false)}>
                Preview
              </Button>
              <Button disabled={!csv || !result} loading={busy && Boolean(result)} onClick={() => void run(true)}>
                Import
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
