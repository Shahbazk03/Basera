'use client';

import * as React from 'react';
import { CalendarClock, Info } from 'lucide-react';
import { enumLabel, formatDateTime, formatPriceRange, formatRelative } from '@estate/shared';
import { Alert, Button, Card, CardBody, CardHeader, DescriptionList, Field, Select, StatusBadge, Textarea } from '@estate/ui';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/hooks';
import type { ManageProject } from './types';

const UNIT_ORDER = ['AVAILABLE', 'ON_HOLD', 'RESERVED', 'BOOKED', 'SOLD', 'NOT_RELEASED', 'BLOCKED'];

export function OverviewTab({ project }: { project: ManageProject }) {
  const [target, setTarget] = React.useState('');
  const [reason, setReason] = React.useState('');
  const change = useApiMutation(() => api.post(`/projects/${project.id}/status`, { status: target, reason: reason || undefined }), {
    success: 'Status updated',
    invalidate: ['/projects'],
    onSuccess: () => {
      setTarget('');
      setReason('');
    },
  });
  const inv = project.inventory;
  const differs = project.computedStatus !== project.status;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="Status & booking window" description={project.autoStatus ? 'Automatic: the server derives the sales status from the booking window and live inventory every minute.' : 'Manual: the status changes only when someone changes it.'} />
          <CardBody className="grid gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={project.computedStatus} />
              {differs ? <span className="text-xs text-ink-500">Stored as {enumLabel(project.status).toLowerCase()} — the scheduler will update it within a minute.</span> : null}
              {project.isBookable ? <span className="text-xs font-medium text-success">Accepting reservations</span> : null}
            </div>
            <DescriptionList
              columns={3}
              items={[
                { label: 'Booking opens', value: project.bookingOpensAt ? `${formatDateTime(project.bookingOpensAt)} (${formatRelative(project.bookingOpensAt)})` : 'Not scheduled' },
                { label: 'Booking closes', value: project.bookingClosesAt ? `${formatDateTime(project.bookingClosesAt)} (${formatRelative(project.bookingClosesAt)})` : 'Not scheduled' },
                { label: '“Closing soon” window', value: `${project.closingSoonHours} hours` },
                { label: 'Automatic status', value: project.autoStatus ? 'On' : 'Off' },
                { label: 'Possession', value: project.possessionDate ? formatDateTime(project.possessionDate).split(',')[0] : '—' },
                { label: 'RERA', value: project.reraNumber ?? '—' },
              ]}
            />
            {project.permissions.canEdit && project.statusTargets.length ? (
              <div className="grid gap-3 rounded-lg border border-line bg-ink-50/50 p-4 sm:grid-cols-[220px_minmax(0,1fr)_auto] sm:items-end">
                <Field label="Change status to" htmlFor="target">
                  <Select id="target" value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="">Select</option>
                    {project.statusTargets.map((s) => (
                      <option key={s} value={s}>
                        {enumLabel(s)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Reason (optional)" htmlFor="reason">
                  <Textarea id="reason" rows={1} className="min-h-10" value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                <Button disabled={!target} loading={change.isPending} onClick={() => change.mutate(undefined)}>
                  Apply
                </Button>
              </div>
            ) : null}
            {project.autoStatusLocksDerived ? (
              <Alert tone="info">
                Booking open, closing soon, sold out and closed are derived automatically while automatic status is on. Edit the booking window in <strong>Details</strong>, or turn automatic status off to set them by hand.
              </Alert>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Status history" />
          <CardBody>
            {project.statusHistory.length ? (
              <ol className="relative space-y-4 border-l border-line pl-5">
                {project.statusHistory.map((h) => (
                  <li key={h.id} className="relative">
                    <span className="absolute -left-[25px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-ink-400" />
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {h.fromStatus ? <StatusBadge status={h.fromStatus} size="sm" /> : null}
                      {h.fromStatus ? <span className="text-ink-400">→</span> : null}
                      <StatusBadge status={h.toStatus} size="sm" />
                    </div>
                    <p className="mt-1 text-xs text-ink-500">
                      {formatDateTime(h.createdAt)} · {h.changedBy?.fullName ?? 'Automatic (scheduler)'}
                    </p>
                    {h.reason ? <p className="mt-0.5 text-sm text-ink-700">{h.reason}</p> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-ink-500">No changes recorded yet.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="Inventory" description={inv.total ? `${inv.released} of ${inv.total} units released` : 'No units yet'} />
          <CardBody className="grid gap-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[12.5px] text-ink-500">Available now</p>
                <p className="tabular font-display text-3xl font-semibold text-ink-900">{inv.available}</p>
              </div>
              <div className="text-right">
                <p className="text-[12.5px] text-ink-500">Price range</p>
                <p className="tabular text-sm font-medium text-ink-900">{formatPriceRange(inv.priceMin ?? project.priceMinOverride, inv.priceMax ?? project.priceMaxOverride)}</p>
              </div>
            </div>
            {inv.total ? (
              <ul className="grid gap-1.5">
                {UNIT_ORDER.filter((s) => inv.byStatus[s]).map((s) => (
                  <li key={s} className="flex items-center justify-between text-sm">
                    <StatusBadge status={s} size="sm" />
                    <span className="tabular text-ink-800">{inv.byStatus[s]}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Activity" />
          <CardBody>
            <DescriptionList
              columns={2}
              items={[
                { label: 'Enquiries', value: project._count.enquiries },
                { label: 'Leads', value: project._count.leads },
                { label: 'Domains', value: project._count.domains },
                { label: 'Page revision', value: project.page?.revision ?? 0 },
                { label: 'Created by', value: project.createdBy?.fullName ?? '—' },
                { label: 'Last updated', value: formatRelative(project.updatedAt) },
              ]}
            />
          </CardBody>
        </Card>
        {project.reviewStatus === 'REJECTED' && project.reviewNote ? (
          <Alert tone="danger" title="Changes requested">
            {project.reviewNote}
          </Alert>
        ) : null}
        {!project.isPublished ? (
          <Alert tone="info" title="Not visible to the public">
            <span className="inline-flex items-start gap-1">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              {project.organization.projectPublishMode === 'DIRECT' ? 'Publish the project when it is ready.' : 'Submit the project for review; a reviewer approves and publishes it.'}
            </span>
          </Alert>
        ) : (
          <Alert tone="success" title="Live">
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3.5" /> Published {project.publishedAt ? formatRelative(project.publishedAt) : ''}
            </span>
          </Alert>
        )}
      </div>
    </div>
  );
}
