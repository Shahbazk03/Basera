'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { CalendarClock, CalendarPlus, ChevronDown, ChevronLeft, Handshake, Mail, MessageCircle, NotebookPen, Phone, UserPlus } from 'lucide-react';
import { enumLabel, formatDate, formatDateTime, formatINR, formatPriceRange, formatRelative, whatsappLink } from '@estate/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  EmptyState,
  PageHeader,
  Skeleton,
  StatusBadge,
} from '@estate/ui';
import { useApi } from '@/lib/hooks';
import { ActivityDialog, AssignDialog, CompleteFollowUpDialog, DealDialog, FollowUpDialog, ScheduleVisitDialog, StatusDialog, UpdateVisitDialog } from '@/components/crm/dialogs';
import { ActivityTimeline } from '@/components/crm/timeline';
import type { LeadDetail } from '@/components/crm/types';

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useApi<LeadDetail>(`/crm/leads/${id}`);
  const lead = q.data;
  const [statusTo, setStatusTo] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<'assign' | 'activity' | 'followup' | 'visit' | 'deal' | null>(null);
  const [closing, setClosing] = React.useState<{ id: string; type: string } | null>(null);
  const [visit, setVisit] = React.useState<LeadDetail['siteVisits'][number] | null>(null);
  const refresh = () => void q.refetch();

  if (q.isLoading) return <Skeleton className="h-[480px] w-full" />;
  if (!lead)
    return (
      <EmptyState
        title="Lead not found"
        description="It may belong to another team, or you no longer have access."
        action={
          <Button asChild variant="outline">
            <Link href="/crm/leads">Back to leads</Link>
          </Button>
        }
      />
    );

  const closed = ['CONVERTED', 'LOST'].includes(lead.status);
  const pendingFollowUps = lead.followUps.filter((f) => f.status === 'PENDING' || f.status === 'MISSED');
  const subject = lead.property ? lead.property.title : lead.project ? `${lead.project.name}${lead.unit ? ` · unit ${lead.unit.code}` : ''}` : 'General requirement';
  const digits = (lead.phone ?? '').replace(/\D/g, '');

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Link href="/crm/leads" className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
            <ChevronLeft className="size-4" /> Leads
          </Link>
        }
        title={lead.name}
        description={
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <StatusBadge status={lead.status} />
            <StatusBadge status={lead.priority} label={`${enumLabel(lead.priority)} priority`} />
            {lead.intakeStatus !== 'ACCEPTED' ? <StatusBadge status={lead.intakeStatus} label={`Intake: ${enumLabel(lead.intakeStatus).toLowerCase()}`} /> : null}
            {lead.isDemo ? <Badge tone="outline">Demo data</Badge> : null}
            <span className="tabular">{lead.leadNo}</span>
            <span aria-hidden>·</span>
            <span>{lead.source.name}</span>
            <span aria-hidden>·</span>
            <span>created {formatRelative(lead.createdAt)}</span>
          </span>
        }
        actions={
          <>
            {lead.canEdit && lead.allowedStatuses.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    Move stage <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Change stage to</DropdownMenuLabel>
                  {lead.allowedStatuses
                    .filter((s) => s !== 'CONVERTED')
                    .map((s) => (
                      <DropdownMenuItem key={s} tone={s === 'LOST' ? 'danger' : undefined} onSelect={() => setStatusTo(s)}>
                        {enumLabel(s)}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {lead.canAssign && !closed ? (
              <Button variant="outline" size="sm" onClick={() => setDialog('assign')}>
                <UserPlus /> {lead.assignedTo ? 'Reassign' : 'Assign'}
              </Button>
            ) : null}
            {lead.canEdit ? (
              <Button variant="outline" size="sm" onClick={() => setDialog('activity')}>
                <NotebookPen /> Log activity
              </Button>
            ) : null}
            {lead.canEdit && !closed ? (
              <Button variant="outline" size="sm" onClick={() => setDialog('followup')}>
                <CalendarClock /> Follow-up
              </Button>
            ) : null}
            {lead.canManageVisits && lead.canEdit && lead.status !== 'CONVERTED' ? (
              <Button variant="outline" size="sm" onClick={() => setDialog('visit')}>
                <CalendarPlus /> Site visit
              </Button>
            ) : null}
            {lead.canCreateDeal && !closed ? (
              <Button size="sm" onClick={() => setDialog('deal')}>
                <Handshake /> Record deal
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-5 flex flex-col gap-3">
        {lead.duplicateOf ? (
          <Alert tone="warning" title="Duplicate submission">
            This lead was recorded as a duplicate of{' '}
            <Link href={`/crm/leads/${lead.duplicateOf.id}`} className="font-medium underline">
              {lead.duplicateOf.leadNo}
            </Link>
            . {lead.intakeNote}
          </Alert>
        ) : lead.intakeNote ? (
          <Alert tone="info">{lead.intakeNote}</Alert>
        ) : null}
        {lead.status === 'LOST' && lead.lostReason ? <Alert tone="warning" title="Marked as lost">{lead.lostReason}</Alert> : null}
        {pendingFollowUps.some((f) => new Date(f.dueAt).getTime() < Date.now()) ? <Alert tone="danger">A follow-up for this lead is overdue.</Alert> : null}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title="Requirement" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'Interested in', value: lead.property ? <Link className="text-brand hover:underline" href={`/listings/${lead.property.id}`}>{subject}</Link> : subject },
                  { label: 'Enquiry type', value: enumLabel(lead.enquiryType) },
                  { label: 'Looking to', value: lead.listingType ? (lead.listingType === 'RENT' ? 'Rent' : 'Buy') : '—' },
                  { label: 'Budget', value: lead.budgetMin || lead.budgetMax ? formatPriceRange(lead.budgetMin, lead.budgetMax) : '—' },
                  { label: 'Preferred location', value: [lead.preferredLocality?.name, lead.preferredCity?.name, lead.locationPreference].filter(Boolean).join(' · ') || '—' },
                  { label: 'Campaign', value: lead.campaign ? `${lead.campaign.name} (${lead.campaign.code})` : '—' },
                  { label: 'Lead partner', value: lead.leadProvider?.name ?? '—' },
                  { label: 'Organisation', value: lead.organization.name },
                ]}
              />
              {lead.requirement ? <p className="mt-5 whitespace-pre-line rounded-lg bg-ink-50 px-4 py-3 text-sm text-ink-700">{lead.requirement}</p> : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Timeline"
              description="Calls, messages, visits, assignments and status changes."
              actions={
                lead.canEdit ? (
                  <Button size="xs" variant="outline" onClick={() => setDialog('activity')}>
                    <NotebookPen /> Log activity
                  </Button>
                ) : null
              }
            />
            <ActivityTimeline items={lead.activities} />
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Contact" />
            <CardBody className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline">
                  <a href={`tel:${lead.phone}`}>
                    <Phone /> {lead.phone}
                  </a>
                </Button>
                {digits ? (
                  <Button asChild size="sm" variant="whatsapp">
                    <a href={whatsappLink(lead.phone, `Hello ${lead.name.split(' ')[0]}, this is regarding your enquiry about ${subject}.`)} target="_blank" rel="noreferrer">
                      <MessageCircle /> WhatsApp
                    </a>
                  </Button>
                ) : null}
                {lead.email ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={`mailto:${lead.email}`}>
                      <Mail /> Email
                    </a>
                  </Button>
                ) : null}
              </div>
              <DescriptionList
                columns={1}
                items={[
                  { label: 'Customer record', value: <Link href={`/crm/customers/${lead.customer.id}`} className="text-brand hover:underline">{lead.customer.fullName}</Link> },
                  { label: 'Email', value: lead.email ?? '—' },
                  { label: 'Alternate phone', value: lead.customer.alternatePhone ?? '—' },
                  { label: 'Last contacted', value: lead.lastContactedAt ? formatDateTime(lead.lastContactedAt) : 'Not yet' },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Ownership" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { label: 'Assigned to', value: lead.assignedTo ? lead.assignedTo.fullName : <span className="text-warning">Unassigned</span> },
                  { label: 'Team', value: lead.assignedTeam?.name ?? '—' },
                  { label: 'Created by', value: lead.createdBy?.fullName ?? 'Website / system' },
                ]}
              />
              {lead.assignments.length ? (
                <ul className="mt-4 space-y-2 border-t border-line pt-4 text-xs text-ink-600">
                  {lead.assignments.map((a) => (
                    <li key={a.id}>
                      <span className="font-medium text-ink-800">{a.assignedTo.fullName}</span> · {enumLabel(a.method).toLowerCase()}
                      {a.rule ? ` (${a.rule.name})` : ''} · {formatDateTime(a.assignedAt)}
                      {a.assignedBy ? ` by ${a.assignedBy.fullName}` : ''}
                      {a.isCurrent ? <Badge tone="brand" size="sm" className="ml-1.5">Current</Badge> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Follow-ups"
              actions={
                lead.canEdit && !closed ? (
                  <Button size="xs" variant="outline" onClick={() => setDialog('followup')}>
                    Add
                  </Button>
                ) : null
              }
            />
            {lead.followUps.length ? (
              <ul className="divide-y divide-line">
                {lead.followUps.map((f) => {
                  const overdue = (f.status === 'PENDING' || f.status === 'MISSED') && new Date(f.dueAt).getTime() < Date.now();
                  return (
                    <li key={f.id} className="flex items-start justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink-900">
                          {enumLabel(f.type)} · <span className={overdue ? 'text-danger' : ''}>{formatDateTime(f.dueAt)}</span>
                        </p>
                        <p className="text-xs text-ink-500">
                          {f.assignedTo.fullName}
                          {f.notes ? ` · ${f.notes}` : ''}
                          {f.outcome ? ` · ${f.outcome}` : ''}
                        </p>
                      </div>
                      {(f.status === 'PENDING' || f.status === 'MISSED') && lead.canEdit ? (
                        <Button size="xs" variant="outline" onClick={() => setClosing({ id: f.id, type: f.type })}>
                          Close
                        </Button>
                      ) : (
                        <StatusBadge status={f.status} size="sm" />
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-5 py-6 text-center text-sm text-ink-500">No follow-ups scheduled.</p>
            )}
          </Card>

          <Card>
            <CardHeader title="Site visits" />
            {lead.siteVisits.length ? (
              <ul className="divide-y divide-line">
                {lead.siteVisits.map((v) => (
                  <li key={v.id} className="flex items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink-900">{formatDateTime(v.scheduledAt)}</p>
                      <p className="truncate text-xs text-ink-500">
                        {v.property?.title ?? v.project?.name ?? 'Property'}
                        {v.unit ? ` · ${v.unit.code}` : ''}
                        {v.assignedTo ? ` · ${v.assignedTo.fullName}` : ''}
                      </p>
                      {v.outcome ? <p className="mt-1 text-xs text-ink-600">{v.outcome}</p> : null}
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <StatusBadge status={v.status} size="sm" />
                      {lead.canManageVisits && !['COMPLETED'].includes(v.status) ? (
                        <Button size="xs" variant="ghost" onClick={() => setVisit(v)}>
                          Update
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-center text-sm text-ink-500">No site visits yet.</p>
            )}
          </Card>

          {lead.deals.length || lead.reservations.length ? (
            <Card>
              <CardHeader title="Deals & reservations" />
              <ul className="divide-y divide-line">
                {lead.deals.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <Link href={`/crm/deals/${d.id}`} className="text-sm font-medium text-brand hover:underline">
                      {d.dealNo}
                    </Link>
                    <span className="tabular text-sm text-ink-800">{formatINR(d.dealValue)}</span>
                    <StatusBadge status={d.status} size="sm" />
                  </li>
                ))}
                {lead.reservations.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span>
                      Unit {r.unit.code} · {r.unit.project.name}
                    </span>
                    <span className="text-xs text-ink-500">{r.expiresAt ? `until ${formatDateTime(r.expiresAt)}` : ''}</span>
                    <StatusBadge status={r.status === 'ACTIVE' ? 'RESERVED' : r.status} size="sm" />
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {lead.enquiries.length ? (
            <Card>
              <CardHeader title="Enquiries" />
              <ul className="divide-y divide-line">
                {lead.enquiries.map((e) => (
                  <li key={e.id} className="px-5 py-3">
                    <p className="text-sm font-medium text-ink-900">
                      {e.referenceNo} · {enumLabel(e.type)}
                    </p>
                    <p className="text-xs text-ink-500">
                      {formatDateTime(e.createdAt)}
                      {e.preferredDate ? ` · visit on ${formatDate(e.preferredDate)}` : ''}
                    </p>
                    {e.message ? <p className="mt-1 text-xs text-ink-700">{e.message}</p> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>

      <StatusDialog open={Boolean(statusTo)} onOpenChange={(o) => !o && setStatusTo(null)} leadId={lead.id} to={statusTo} onDone={refresh} />
      <AssignDialog open={dialog === 'assign'} onOpenChange={(o) => setDialog(o ? 'assign' : null)} leadIds={[lead.id]} organizationId={lead.organization.id} onDone={refresh} title={lead.assignedTo ? 'Reassign lead' : 'Assign lead'} />
      <ActivityDialog open={dialog === 'activity'} onOpenChange={(o) => setDialog(o ? 'activity' : null)} leadId={lead.id} onDone={refresh} />
      <FollowUpDialog open={dialog === 'followup'} onOpenChange={(o) => setDialog(o ? 'followup' : null)} leadId={lead.id} organizationId={lead.organization.id} defaultAssigneeId={lead.assignedTo?.id} onDone={refresh} />
      <ScheduleVisitDialog open={dialog === 'visit'} onOpenChange={(o) => setDialog(o ? 'visit' : null)} lead={{ id: lead.id, organizationId: lead.organization.id, assignedTo: lead.assignedTo, project: lead.project, property: lead.property, unit: lead.unit }} onDone={refresh} />
      <DealDialog open={dialog === 'deal'} onOpenChange={(o) => setDialog(o ? 'deal' : null)} lead={{ id: lead.id, property: lead.property, project: lead.project, unit: lead.unit }} onDone={(dealId) => router.push(`/crm/deals/${dealId}`)} />
      <CompleteFollowUpDialog followUp={closing} onOpenChange={(o) => !o && setClosing(null)} onDone={refresh} />
      <UpdateVisitDialog visit={visit} onOpenChange={(o) => !o && setVisit(null)} onDone={refresh} />
    </>
  );
}
