'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { enumLabel, formatDateTime } from '@estate/shared';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, DescriptionList, EmptyState, Field, Input, PageHeader, Skeleton, Stat, StatusBadge, Table, TBody, TD, TH, THead, TR, Textarea } from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';

interface ProviderDetail {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  duplicateWindowDays: number;
  notes: string | null;
  createdAt: string;
  organization: { id: string; name: string; status: string; verificationStatus: string; createdAt: string; email: string | null; phone: string | null; members: { title: string | null; isOwner: boolean; user: { id: string; fullName: string; email: string | null; phone: string | null; lastLoginAt: string | null } }[] };
  stats: { submitted: number; accepted: number; duplicate: number; rejected: number; pending: number; converted: number };
  recentLeads: { id: string; leadNo: string; name: string; phone: string; createdAt: string; intakeStatus: string; intakeNote: string | null; status: string; assignedTo: { fullName: string } | null; project: { name: string } | null; duplicateOf: { id: string; leadNo: string } | null }[];
}

export default function LeadProviderPage() {
  const { id } = useParams<{ id: string }>();
  const q = useApi<ProviderDetail>(`/crm/lead-providers/${id}`);
  const p = q.data;
  const [confirm, setConfirm] = React.useState<'ACTIVE' | 'SUSPENDED' | null>(null);
  const [windowDays, setWindowDays] = React.useState('');
  const [notes, setNotes] = React.useState('');
  React.useEffect(() => {
    if (p) {
      setWindowDays(String(p.duplicateWindowDays));
      setNotes(p.notes ?? '');
    }
  }, [p]);
  const setStatus = useApiMutation((status: 'ACTIVE' | 'SUSPENDED') => api.patch(`/crm/lead-providers/${id}`, { status }), { success: (r) => `Partner ${(r as ProviderDetail).status === 'ACTIVE' ? 'activated' : 'suspended'}`, invalidate: ['/crm/lead-providers'], onSuccess: () => setConfirm(null) });
  const save = useApiMutation(() => api.patch(`/crm/lead-providers/${id}`, { duplicateWindowDays: Number(windowDays), notes: notes || null }), { success: 'Settings saved', invalidate: ['/crm/lead-providers'] });

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!p) return <EmptyState title="Lead provider not found" action={<Button asChild variant="outline"><Link href="/crm/lead-providers">Back</Link></Button>} />;
  const active = p.status === 'ACTIVE' && p.organization.status === 'ACTIVE';

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Link href="/crm/lead-providers" className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
            <ChevronLeft className="size-4" /> Lead providers
          </Link>
        }
        title={p.name}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={p.organization.status === 'PENDING' ? 'PENDING' : p.status} label={p.organization.status === 'PENDING' ? 'Awaiting activation' : undefined} />
            Joined {formatDateTime(p.organization.createdAt)}
          </span>
        }
        actions={
          active ? (
            <Button variant="destructive-outline" size="sm" onClick={() => setConfirm('SUSPENDED')}>
              Suspend partner
            </Button>
          ) : (
            <Button size="sm" onClick={() => setConfirm('ACTIVE')}>
              Activate partner
            </Button>
          )
        }
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Submitted" value={p.stats.submitted} />
        <Stat label="Accepted" value={p.stats.accepted} />
        <Stat label="Duplicates" value={p.stats.duplicate} />
        <Stat label="Pending review" value={p.stats.pending} tone={p.stats.pending ? 'warning' : 'default'} href="/crm/lead-providers?tab=review" />
        <Stat label="Rejected" value={p.stats.rejected} />
        <Stat label="Converted" value={p.stats.converted} tone="success" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader title="Recent submissions" />
          {p.recentLeads.length ? (
            <Table>
              <THead>
                <tr>
                  <TH>Lead</TH>
                  <TH>Intake</TH>
                  <TH className="hidden md:table-cell">Pipeline</TH>
                  <TH className="hidden lg:table-cell">Owner</TH>
                  <TH className="hidden sm:table-cell">Submitted</TH>
                </tr>
              </THead>
              <TBody>
                {p.recentLeads.map((l) => (
                  <TR key={l.id}>
                    <TD>
                      <Link href={`/crm/leads/${l.id}`} className="font-medium text-ink-900 hover:underline">
                        {l.name}
                      </Link>
                      <div className="tabular text-xs text-ink-500">
                        {l.leadNo} · {l.phone}
                      </div>
                      {l.duplicateOf ? (
                        <div className="text-xs text-warning">
                          Duplicate of{' '}
                          <Link href={`/crm/leads/${l.duplicateOf.id}`} className="underline">
                            {l.duplicateOf.leadNo}
                          </Link>
                        </div>
                      ) : null}
                    </TD>
                    <TD>
                      <StatusBadge status={l.intakeStatus} />
                    </TD>
                    <TD className="hidden md:table-cell">
                      <StatusBadge status={l.status} />
                    </TD>
                    <TD className="hidden lg:table-cell">{l.assignedTo?.fullName ?? '—'}</TD>
                    <TD className="hidden whitespace-nowrap text-xs text-ink-500 sm:table-cell">{formatDateTime(l.createdAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-ink-500">No submissions yet.</p>
          )}
        </Card>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Contact" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { label: 'Contact person', value: p.contactName ?? '—' },
                  { label: 'Email', value: p.email ?? '—' },
                  { label: 'Phone', value: p.phone ?? '—' },
                  { label: 'Verification', value: enumLabel(p.organization.verificationStatus) },
                ]}
              />
              <ul className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
                {p.organization.members.map((m) => (
                  <li key={m.user.id}>
                    <span className="font-medium text-ink-900">{m.user.fullName}</span>
                    <span className="text-ink-500"> · {m.isOwner ? 'Owner' : (m.title ?? 'Member')}</span>
                    <div className="text-xs text-ink-500">{m.user.lastLoginAt ? `Last sign-in ${formatDateTime(m.user.lastLoginAt)}` : 'Never signed in'}</div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Intake settings" />
            <CardBody className="grid gap-4">
              <Field label="Duplicate window (days)" htmlFor="lp-window" hint="A submission is a duplicate if the customer has an open lead created within this window.">
                <Input id="lp-window" type="number" min={1} max={365} value={windowDays} onChange={(e) => setWindowDays(e.target.value)} />
              </Field>
              <Field label="Internal notes" htmlFor="lp-notes">
                <Textarea id="lp-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <Button className="w-fit" loading={save.isPending} disabled={!(Number(windowDays) >= 1)} onClick={() => save.mutate(undefined)}>
                Save settings
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        tone={confirm === 'SUSPENDED' ? 'danger' : 'default'}
        title={confirm === 'SUSPENDED' ? `Suspend ${p.name}?` : `Activate ${p.name}?`}
        description={confirm === 'SUSPENDED' ? 'The partner can no longer submit leads. Existing leads are not affected.' : 'The partner can submit leads immediately and is notified by email.'}
        confirmLabel={confirm === 'SUSPENDED' ? 'Suspend' : 'Activate'}
        loading={setStatus.isPending}
        onConfirm={() => confirm && setStatus.mutate(confirm)}
      />
    </>
  );
}
