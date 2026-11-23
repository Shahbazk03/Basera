'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { BadgeCheck, Ban, ChevronLeft, CircleCheck, FileText, RotateCcw, XCircle } from 'lucide-react';
import { enumLabel, formatDate, formatDateTime, formatINR, localDateString } from '@estate/shared';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CheckboxField,
  DescriptionList,
  Dialog,
  DialogContent,
  DialogFooter,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
} from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { openDocument } from '@/components/uploaders';

interface PartnerDetail {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: string;
  verificationStatus: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  website: string | null;
  logoUrl: string | null;
  description: string | null;
  addressLine: string | null;
  pincode: string | null;
  gstin: string | null;
  panNumber: string | null;
  reraRegistrationNo: string | null;
  projectPublishMode: 'REQUIRES_APPROVAL' | 'DIRECT';
  showContactPublicly: boolean;
  rejectionReason: string | null;
  verifiedAt: string | null;
  createdAt: string;
  isDemo: boolean;
  city: { id: string; name: string } | null;
  verifiedBy: { fullName: string } | null;
  members: { id: string; userId: string; title: string | null; isOwner: boolean; status: string; user: { id: string; fullName: string; email: string | null; phone: string | null; status: string; lastLoginAt: string | null }; roles: { key: string; name: string }[] }[];
  documents: { id: string; docType: string; title: string; status: string; reviewNote: string | null; reviewedAt: string | null; createdAt: string; file: { id: string; fileName: string; mimeType: string; sizeBytes: number }; reviewedBy: { fullName: string } | null }[];
  brokerProfiles: { id: string; displayName: string; reraAgentNumber: string | null; experienceYears: number | null; verificationStatus: string }[];
  developerProfile: { establishedYear: number | null; projectsDelivered: number | null; about: string | null } | null;
  subscriptions: { id: string; status: string; startsAt: string; endsAt: string; amount: number; paymentReference: string | null; notes: string | null; createdAt: string; plan: { id: string; name: string; code: string; listingQuota: number | null }; createdBy: { fullName: string } | null }[];
  listingCounts: Record<string, number>;
  projectCount: number;
  leadCount: number;
  history: { id: string; action: string; createdAt: string; metadata: Record<string, unknown> | null; actor: { fullName: string } | null }[];
  canVerify: boolean;
  canManageSubscriptions: boolean;
}

type Decision = 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REACTIVATE';
const DECISION_COPY: Record<Decision, { title: string; description: string; confirm: string; needsReason: boolean }> = {
  APPROVE: { title: 'Approve organisation', description: 'Marks the organisation verified. Its listings can then be approved and published.', confirm: 'Approve', needsReason: false },
  REJECT: { title: 'Reject registration', description: 'The owner is told why and can correct the details and resubmit.', confirm: 'Reject', needsReason: true },
  SUSPEND: { title: 'Suspend organisation', description: 'All of its listings and projects disappear from the website immediately. Members can still sign in to see the reason.', confirm: 'Suspend', needsReason: true },
  REACTIVATE: { title: 'Reactivate organisation', description: 'Its published listings become visible again.', confirm: 'Reactivate', needsReason: false },
};

export default function PartnerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useApi<PartnerDetail>(`/partners/${id}`);
  const p = q.data;
  const [decision, setDecision] = React.useState<Decision | null>(null);
  const [reason, setReason] = React.useState('');
  const [mode, setMode] = React.useState<'REQUIRES_APPROVAL' | 'DIRECT'>('REQUIRES_APPROVAL');
  const decide = useApiMutation(
    () => api.post(`/partners/${id}/decision`, { decision, reason: reason.trim() || undefined, ...(decision === 'APPROVE' && p?.type === 'DEVELOPER' ? { projectPublishMode: mode } : {}) }),
    {
      success: 'Decision recorded and the owner notified',
      invalidate: ['/partners'],
      onSuccess: () => {
        setDecision(null);
        setReason('');
      },
    },
  );
  const publishMode = useApiMutation((m: string) => api.put(`/partners/${id}/publish-mode`, { projectPublishMode: m }), { success: 'Publishing setting updated', invalidate: ['/partners'] });

  const [docReview, setDocReview] = React.useState<{ id: string; title: string } | null>(null);
  const [docNote, setDocNote] = React.useState('');
  const reviewDoc = useApiMutation((v: { docId: string; status: 'APPROVED' | 'REJECTED'; note?: string }) => api.post(`/partners/${id}/documents/${v.docId}/review`, { status: v.status, note: v.note }), {
    success: 'Document reviewed',
    invalidate: ['/partners'],
    onSuccess: () => {
      setDocReview(null);
      setDocNote('');
    },
  });

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!p) return <EmptyState title="Organisation not found" action={<Button asChild variant="outline"><Link href="/partners">Back to partners</Link></Button>} />;

  const available: Decision[] = p.canVerify
    ? p.status === 'PENDING'
      ? ['APPROVE', 'REJECT']
      : p.status === 'REJECTED'
        ? ['APPROVE']
        : p.status === 'ACTIVE'
          ? ['SUSPEND']
          : ['REACTIVATE']
    : [];
  const live = p.listingCounts.PUBLISHED ?? 0;
  const totalListings = Object.values(p.listingCounts).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Link href="/partners" className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
            <ChevronLeft className="size-4" /> Partners
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <Avatar name={p.name} src={p.logoUrl} size={40} />
            {p.name}
          </span>
        }
        description={
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge status={p.status === 'PENDING' ? 'PENDING_VERIFICATION' : p.status} label={p.status === 'PENDING' ? 'Awaiting verification' : undefined} />
            {p.verificationStatus === 'VERIFIED' ? (
              <Badge tone="success">
                <BadgeCheck /> Verified
              </Badge>
            ) : null}
            {p.isDemo ? <Badge tone="outline">Demo data</Badge> : null}
            <span>{enumLabel(p.type)}</span>
            <span aria-hidden>·</span>
            <span>Registered {formatDate(p.createdAt)}</span>
          </span>
        }
        actions={available.map((d) => (
          <Button
            key={d}
            variant={d === 'APPROVE' || d === 'REACTIVATE' ? 'primary' : 'destructive-outline'}
            onClick={() => {
              setMode(p.projectPublishMode);
              setDecision(d);
            }}
          >
            {d === 'APPROVE' ? <CircleCheck /> : d === 'REJECT' ? <XCircle /> : d === 'SUSPEND' ? <Ban /> : <RotateCcw />}
            {DECISION_COPY[d].confirm}
          </Button>
        ))}
      />

      {p.rejectionReason && (p.status === 'REJECTED' || p.status === 'SUSPENDED') ? (
        <Alert tone={p.status === 'SUSPENDED' ? 'danger' : 'warning'} title={p.status === 'SUSPENDED' ? 'Suspended' : 'Registration rejected'} className="mb-5">
          {p.rejectionReason}
        </Alert>
      ) : null}
      {p.status === 'PENDING' && p.documents.length === 0 ? (
        <Alert tone="info" className="mb-5">
          This organisation has not uploaded verification documents yet.
        </Alert>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Business details" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'Legal name', value: p.legalName ?? '—' },
                  { label: 'Email', value: p.email ?? '—' },
                  { label: 'Phone', value: p.phone ?? '—' },
                  { label: 'WhatsApp', value: p.whatsappNumber ?? '—' },
                  { label: 'Website', value: p.website ? <a href={p.website} target="_blank" rel="noreferrer" className="text-brand hover:underline">{p.website}</a> : '—' },
                  { label: 'Address', value: [p.addressLine, p.city?.name, p.pincode].filter(Boolean).join(', ') || '—' },
                  { label: 'GSTIN', value: p.gstin ?? '—' },
                  { label: 'PAN', value: p.panNumber ?? '—' },
                  { label: 'RERA registration', value: p.reraRegistrationNo ?? '—' },
                  { label: 'Contact shown on listings', value: p.showContactPublicly ? 'Yes' : 'No' },
                  { label: 'Verified', value: p.verifiedAt ? `${formatDate(p.verifiedAt)}${p.verifiedBy ? ` by ${p.verifiedBy.fullName}` : ''}` : 'Not yet' },
                  ...(p.developerProfile ? [{ label: 'Established', value: p.developerProfile.establishedYear ?? '—' }, { label: 'Projects delivered (self-declared)', value: p.developerProfile.projectsDelivered ?? '—' }] : []),
                ]}
              />
              {p.description ? <p className="mt-5 whitespace-pre-line border-t border-line pt-4 text-sm text-ink-700">{p.description}</p> : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Verification documents" description="Open a document to inspect it; links expire after five minutes." />
            {p.documents.length ? (
              <Table>
                <THead>
                  <tr>
                    <TH>Document</TH>
                    <TH>Status</TH>
                    <TH align="right">Actions</TH>
                  </tr>
                </THead>
                <TBody>
                  {p.documents.map((d) => (
                    <TR key={d.id}>
                      <TD>
                        <div className="font-medium text-ink-900">{d.title}</div>
                        <div className="text-xs text-ink-500">
                          {enumLabel(d.docType)} · {d.file.fileName} · uploaded {formatDate(d.createdAt)}
                        </div>
                        {d.reviewNote ? <div className="mt-1 text-xs text-ink-600">Note: {d.reviewNote}</div> : null}
                      </TD>
                      <TD>
                        <StatusBadge status={d.status} />
                        {d.reviewedBy ? <div className="mt-1 text-[11px] text-ink-500">{d.reviewedBy.fullName}</div> : null}
                      </TD>
                      <TD align="right">
                        <div className="flex justify-end gap-1">
                          <Button size="xs" variant="ghost" onClick={() => void openDocument(d.file.id)}>
                            <FileText /> Open
                          </Button>
                          {p.canVerify && d.status !== 'APPROVED' ? (
                            <Button size="xs" variant="ghost" className="text-success" loading={reviewDoc.isPending} onClick={() => reviewDoc.mutate({ docId: d.id, status: 'APPROVED' })}>
                              Approve
                            </Button>
                          ) : null}
                          {p.canVerify && d.status !== 'REJECTED' ? (
                            <Button size="xs" variant="ghost" className="text-danger" onClick={() => setDocReview({ id: d.id, title: d.title })}>
                              Reject
                            </Button>
                          ) : null}
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <EmptyState icon={<FileText />} title="No documents uploaded" description="The organisation uploads documents from its own console." />
            )}
          </Card>

          <Card>
            <CardHeader title="Team" description={`${p.members.length} member${p.members.length === 1 ? '' : 's'}`} />
            <Table>
              <THead>
                <tr>
                  <TH>Member</TH>
                  <TH>Role</TH>
                  <TH className="hidden md:table-cell">Last sign-in</TH>
                </tr>
              </THead>
              <TBody>
                {p.members.map((m) => (
                  <TR key={m.id}>
                    <TD>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={m.user.fullName} size={28} />
                        <div className="min-w-0">
                          <div className="font-medium text-ink-900">
                            {m.user.fullName} {m.isOwner ? <Badge tone="dark" size="sm">Owner</Badge> : null}
                          </div>
                          <div className="truncate text-xs text-ink-500">{m.user.email ?? m.user.phone}</div>
                        </div>
                      </div>
                    </TD>
                    <TD className="text-ink-700">{m.roles.map((r) => r.name).join(', ') || '—'}</TD>
                    <TD className="hidden text-xs text-ink-500 md:table-cell">{m.user.lastLoginAt ? formatDateTime(m.user.lastLoginAt) : 'Never'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Activity" />
            <CardBody>
              <DescriptionList
                columns={2}
                items={[
                  { label: 'Live listings', value: live.toLocaleString('en-IN') },
                  { label: 'All listings', value: totalListings.toLocaleString('en-IN') },
                  { label: 'In review', value: (p.listingCounts.PENDING_REVIEW ?? 0).toLocaleString('en-IN') },
                  { label: 'Projects', value: p.projectCount.toLocaleString('en-IN') },
                  { label: 'Leads', value: p.leadCount.toLocaleString('en-IN') },
                ]}
              />
              {p.type === 'DEVELOPER' && p.canVerify ? (
                <div className="mt-5 border-t border-line pt-4">
                  <Field label="Project publishing" htmlFor="publishMode" hint="Direct publishing lets this developer publish approved project pages without a second review.">
                    <Select id="publishMode" value={p.projectPublishMode} onChange={(e) => publishMode.mutate(e.target.value)} disabled={publishMode.isPending}>
                      <option value="REQUIRES_APPROVAL">Requires platform approval</option>
                      <option value="DIRECT">Direct publishing</option>
                    </Select>
                  </Field>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <SubscriptionsCard partner={p} onChanged={() => void q.refetch()} />

          <Card>
            <CardHeader title="Verification history" />
            {p.history.length ? (
              <ol className="space-y-4 px-5 py-4">
                {p.history.map((h) => (
                  <li key={h.id} className="text-sm">
                    <p className="font-medium text-ink-900">{enumLabel(h.action.replace(/^partner\.|^subscription\./, '').replace(/\./g, '_'))}</p>
                    <p className="text-xs text-ink-500">
                      {formatDateTime(h.createdAt)} · {h.actor?.fullName ?? 'System'}
                    </p>
                    {h.metadata && typeof h.metadata.reason === 'string' ? <p className="mt-0.5 text-xs text-ink-600">{h.metadata.reason}</p> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="px-5 py-6 text-sm text-ink-500">No verification actions yet.</p>
            )}
          </Card>
        </div>
      </div>

      <Dialog open={Boolean(decision)} onOpenChange={(o) => !o && setDecision(null)}>
        {decision ? (
          <DialogContent title={DECISION_COPY[decision].title} description={DECISION_COPY[decision].description}>
            <div className="grid gap-4">
              {decision === 'APPROVE' && p.type === 'DEVELOPER' ? (
                <Field label="Project publishing" htmlFor="mode">
                  <Select id="mode" value={mode} onChange={(e) => setMode(e.target.value as 'REQUIRES_APPROVAL' | 'DIRECT')}>
                    <option value="REQUIRES_APPROVAL">Projects require platform approval</option>
                    <option value="DIRECT">Allow direct publishing</option>
                  </Select>
                </Field>
              ) : null}
              <Field label={DECISION_COPY[decision].needsReason ? 'Reason (shown to the organisation)' : 'Note (optional)'} htmlFor="reason" required={DECISION_COPY[decision].needsReason}>
                <Textarea id="reason" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDecision(null)}>
                Cancel
              </Button>
              <Button
                variant={decision === 'APPROVE' || decision === 'REACTIVATE' ? 'primary' : 'destructive'}
                loading={decide.isPending}
                disabled={DECISION_COPY[decision].needsReason && reason.trim().length < 3}
                onClick={() => decide.mutate(undefined)}
              >
                {DECISION_COPY[decision].confirm}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={Boolean(docReview)} onOpenChange={(o) => !o && setDocReview(null)}>
        {docReview ? (
          <DialogContent title="Reject document" description={docReview.title}>
            <Field label="Reason" htmlFor="docNote" required hint="Tell the organisation what to upload instead.">
              <Textarea id="docNote" rows={3} value={docNote} onChange={(e) => setDocNote(e.target.value)} />
            </Field>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDocReview(null)}>
                Cancel
              </Button>
              <Button variant="destructive" loading={reviewDoc.isPending} disabled={docNote.trim().length < 3} onClick={() => reviewDoc.mutate({ docId: docReview.id, status: 'REJECTED', note: docNote.trim() })}>
                Reject document
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

function SubscriptionsCard({ partner, onChanged }: { partner: PartnerDetail; onChanged: () => void }) {
  const plans = useApi<{ id: string; name: string; code: string; price: number; billingPeriod: string; isActive: boolean }[]>(partner.canManageSubscriptions ? '/partners/plans' : null);
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ planId: '', startsAt: localDateString(new Date()), paymentReference: '', notes: '', activate: true });
  const assign = useApiMutation(() => api.post(`/partners/${partner.id}/subscriptions`, { ...form, paymentReference: form.paymentReference || undefined, notes: form.notes || undefined }), {
    success: 'Subscription recorded',
    invalidate: ['/partners'],
    onSuccess: () => {
      setOpen(false);
      onChanged();
    },
  });
  const activate = useApiMutation((subId: string) => api.post(`/partners/subscriptions/${subId}/activate`, {}), { success: 'Subscription activated', invalidate: ['/partners'], onSuccess: onChanged });
  const cancel = useApiMutation((subId: string) => api.post(`/partners/subscriptions/${subId}/cancel`, {}), { success: 'Subscription cancelled', invalidate: ['/partners'], onSuccess: onChanged });
  const now = Date.now();
  return (
    <Card>
      <CardHeader
        title="Subscription"
        description="Payments are recorded manually — there is no online payment gateway."
        actions={
          partner.canManageSubscriptions ? (
            <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
              Assign plan
            </Button>
          ) : null
        }
      />
      {partner.subscriptions.length ? (
        <ul className="divide-y divide-line">
          {partner.subscriptions.map((s) => {
            const current = s.status === 'ACTIVE' && new Date(s.endsAt).getTime() >= now;
            return (
              <li key={s.id} className="px-5 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-900">
                      {s.plan.name} {current ? <Badge tone="success" size="sm">Current</Badge> : null}
                    </p>
                    <p className="text-xs text-ink-500">
                      {formatDate(s.startsAt)} – {formatDate(s.endsAt)} · {formatINR(s.amount)}
                      {s.paymentReference ? ` · Ref ${s.paymentReference}` : ''}
                    </p>
                  </div>
                  <StatusBadge status={s.status} size="sm" />
                </div>
                {partner.canManageSubscriptions && (s.status === 'PENDING' || s.status === 'ACTIVE') ? (
                  <div className="mt-2 flex gap-1">
                    {s.status === 'PENDING' ? (
                      <Button size="xs" variant="soft" loading={activate.isPending} onClick={() => activate.mutate(s.id)}>
                        Mark paid & activate
                      </Button>
                    ) : null}
                    <Button size="xs" variant="ghost" className="text-danger" loading={cancel.isPending} onClick={() => cancel.mutate(s.id)}>
                      Cancel
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-5 py-6 text-sm text-ink-500">No subscription on record.</p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Assign subscription plan" description={partner.name}>
          <div className="grid gap-4">
            <Field label="Plan" htmlFor="planId" required>
              <Select id="planId" value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })}>
                <option value="">Select a plan</option>
                {(plans.data ?? [])
                  .filter((pl) => pl.isActive)
                  .map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.name} — {formatINR(pl.price)} / {enumLabel(pl.billingPeriod).toLowerCase()}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Starts on" htmlFor="startsAt" required hint="The end date follows from the plan's billing period.">
              <Input id="startsAt" type="date" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
            </Field>
            <Field label="Payment reference" htmlFor="paymentReference" hint="UTR, cheque number or receipt number for the payment received.">
              <Input id="paymentReference" value={form.paymentReference} onChange={(e) => setForm({ ...form, paymentReference: e.target.value })} />
            </Field>
            <Field label="Notes" htmlFor="subNotes">
              <Textarea id="subNotes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
            <CheckboxField checked={form.activate} onCheckedChange={(v) => setForm({ ...form, activate: Boolean(v) })} label="Payment received — activate now" description="Leave unticked to record the plan as pending until payment arrives. Activating replaces the current subscription." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={assign.isPending} disabled={!form.planId || !form.startsAt} onClick={() => assign.mutate(undefined)}>
              Save subscription
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
