'use client';

import * as React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, FileText, ImagePlus, Trash2, UserPlus, Users } from 'lucide-react';
import { enumLabel, formatDate, formatDateTime, formatINR, memberInviteSchema, organizationUpdateSchema, ORG_DOCUMENT_TYPES } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CheckboxField,
  ConfirmDialog,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@estate/ui';
import { api } from '@/lib/api';
import { applyServerErrors, useApi, useApiMutation } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { DocumentUpload, openDocument } from '@/components/uploaders';

interface OrgProfile {
  id: string;
  name: string;
  type: string;
  status: string;
  verificationStatus: string;
  rejectionReason: string | null;
  verifiedAt: string | null;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  website: string | null;
  logoUrl: string | null;
  description: string | null;
  addressLine: string | null;
  cityId: string | null;
  pincode: string | null;
  gstin: string | null;
  panNumber: string | null;
  reraRegistrationNo: string | null;
  showContactPublicly: boolean;
  projectPublishMode: string;
  createdAt: string;
  developerProfile: { establishedYear: number | null; projectsDelivered: number | null; about: string | null } | null;
  myBrokerProfile: { id: string; displayName: string; reraAgentNumber: string | null; experienceYears: number | null; languages: string[]; specializations: string[]; about: string | null; verificationStatus: string } | null;
  listingCounts: Record<string, number>;
}

export default function OrganizationPage() {
  const { activeOrgId, activeOrg, can } = useSession();
  const orgId = activeOrg && activeOrg.organizationType !== 'PLATFORM' && can('organization.manage', activeOrgId) ? activeOrgId : null;
  const q = useApi<OrgProfile>(orgId ? `/organizations/${orgId}` : null);
  const resubmit = useApiMutation(() => api.post(`/organizations/${orgId}/resubmit`), { success: 'Resubmitted for verification', invalidate: ['/organizations', 'session'] });

  if (!orgId) {
    return (
      <>
        <PageHeader title="My organisation" />
        <Card>
          <EmptyState icon={<Building2 />} title="No organisation to manage" description="Switch to your broker, developer or partner workspace to manage its profile, documents and team." />
        </Card>
      </>
    );
  }
  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  const org = q.data;
  if (!org) return <EmptyState title="Organisation not found" />;

  return (
    <>
      <PageHeader
        title={org.name}
        description={
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge status={org.status === 'PENDING' ? 'PENDING_VERIFICATION' : org.status} label={org.status === 'PENDING' ? 'Verification pending' : undefined} />
            {org.verificationStatus === 'VERIFIED' ? <Badge tone="success">Verified{org.verifiedAt ? ` · ${formatDate(org.verifiedAt)}` : ''}</Badge> : null}
            <span>{enumLabel(org.type)}</span>
          </span>
        }
      />
      {org.status === 'PENDING' ? (
        <Alert tone="info" title="Verification in progress" className="mb-5">
          Upload your business documents under <strong>Documents</strong>. Our team reviews them before your listings can go live. You can already prepare listings as drafts.
        </Alert>
      ) : null}
      {org.status === 'REJECTED' ? (
        <Alert
          tone="danger"
          title="Registration was not approved"
          className="mb-5"
          action={
            <Button size="xs" loading={resubmit.isPending} onClick={() => resubmit.mutate(undefined)}>
              Resubmit for verification
            </Button>
          }
        >
          {org.rejectionReason ?? 'Please review your details and documents.'} Update them, then resubmit.
        </Alert>
      ) : null}
      {org.status === 'SUSPENDED' ? (
        <Alert tone="danger" title="Organisation suspended" className="mb-5">
          {org.rejectionReason ?? 'Contact support for details.'} Your listings are hidden from the website while suspended.
        </Alert>
      ) : null}

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">
            <Building2 /> Profile
          </TabsTrigger>
          <TabsTrigger value="documents">
            <FileText /> Documents
          </TabsTrigger>
          <TabsTrigger value="team">
            <Users /> Team
          </TabsTrigger>
          <TabsTrigger value="subscription">Subscription</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <ProfileForm org={org} onSaved={() => void q.refetch()} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsTab orgId={org.id} />
        </TabsContent>
        <TabsContent value="team">
          <TeamTab orgId={org.id} />
        </TabsContent>
        <TabsContent value="subscription">
          <SubscriptionTab orgId={org.id} type={org.type} />
        </TabsContent>
      </Tabs>
    </>
  );
}

type ProfileValues = z.input<typeof organizationUpdateSchema>;
const nullable = { setValueAs: (v: unknown) => (v === '' || v === undefined ? null : v) };

function ProfileForm({ org, onSaved }: { org: OrgProfile; onSaved: () => void }) {
  const cities = useApi<{ id: string; name: string }[]>('/public/cities');
  const form = useForm<ProfileValues>({
    resolver: zodResolver(organizationUpdateSchema),
    defaultValues: {
      name: org.name,
      legalName: org.legalName,
      email: org.email,
      phone: org.phone,
      whatsappNumber: org.whatsappNumber,
      website: org.website,
      logoUrl: org.logoUrl,
      description: org.description,
      addressLine: org.addressLine,
      cityId: org.cityId,
      pincode: org.pincode,
      gstin: org.gstin,
      panNumber: org.panNumber,
      reraRegistrationNo: org.reraRegistrationNo,
      showContactPublicly: org.showContactPublicly,
    },
  });
  const [uploading, setUploading] = React.useState(false);
  const logoRef = React.useRef<HTMLInputElement>(null);
  const logo = form.watch('logoUrl');
  const e = form.formState.errors;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader title="Business profile" description="Shown on your listings and partner page. Contact details appear publicly only if you allow it." />
        <CardBody>
          <form
            noValidate
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={form.handleSubmit(async (v) => {
              try {
                await api.patch(`/organizations/${org.id}`, v);
                toast.success('Profile saved');
                onSaved();
              } catch (err) {
                if (!applyServerErrors(form, err)) toast.error(errorMessage(err));
              }
            })}
          >
            <div className="flex items-center gap-4 sm:col-span-2">
              <Avatar name={org.name} src={logo ?? null} size={56} />
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" loading={uploading} onClick={() => logoRef.current?.click()}>
                  <ImagePlus /> {logo ? 'Change logo' : 'Upload logo'}
                </Button>
                {logo ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => form.setValue('logoUrl', null, { shouldDirty: true })}>
                    Remove
                  </Button>
                ) : null}
              </div>
              <input
                ref={logoRef}
                type="file"
                hidden
                accept="image/jpeg,image/png,image/webp"
                onChange={async (ev) => {
                  const file = ev.target.files?.[0];
                  if (!file) return;
                  setUploading(true);
                  try {
                    const res = await api.upload(file, 'org-logo', org.id);
                    form.setValue('logoUrl', res.url, { shouldDirty: true });
                  } catch (err) {
                    toast.error(errorMessage(err));
                  } finally {
                    setUploading(false);
                  }
                }}
              />
            </div>
            <Field label="Business name" htmlFor="name" required error={e.name?.message}>
              <Input id="name" {...form.register('name')} />
            </Field>
            <Field label="Legal name" htmlFor="legalName">
              <Input id="legalName" {...form.register('legalName', nullable)} />
            </Field>
            <Field label="Email" htmlFor="email" error={e.email?.message}>
              <Input id="email" type="email" {...form.register('email', nullable)} />
            </Field>
            <Field label="Phone" htmlFor="phone" error={e.phone?.message}>
              <Input id="phone" inputMode="tel" {...form.register('phone', nullable)} />
            </Field>
            <Field label="WhatsApp number" htmlFor="whatsappNumber" error={e.whatsappNumber?.message} hint="Used for WhatsApp enquiries if you allow public contact.">
              <Input id="whatsappNumber" inputMode="tel" {...form.register('whatsappNumber', nullable)} />
            </Field>
            <Field label="Website" htmlFor="website" error={e.website?.message}>
              <Input id="website" type="url" placeholder="https://" {...form.register('website', nullable)} />
            </Field>
            <Field label="Address" htmlFor="addressLine" className="sm:col-span-2">
              <Input id="addressLine" {...form.register('addressLine', nullable)} />
            </Field>
            <Field label="City" htmlFor="cityId">
              <Controller
                control={form.control}
                name="cityId"
                render={({ field }) => (
                  <Select id="cityId" value={(field.value as string) ?? ''} onChange={(ev) => field.onChange(ev.target.value || null)}>
                    <option value="">Select city</option>
                    {(cities.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}
              />
            </Field>
            <Field label="PIN code" htmlFor="pincode">
              <Input id="pincode" inputMode="numeric" maxLength={6} {...form.register('pincode', nullable)} />
            </Field>
            <Field label="GSTIN" htmlFor="gstin" error={e.gstin?.message}>
              <Input id="gstin" {...form.register('gstin', nullable)} />
            </Field>
            <Field label="PAN" htmlFor="panNumber" error={e.panNumber?.message}>
              <Input id="panNumber" {...form.register('panNumber', nullable)} />
            </Field>
            <Field label="RERA registration" htmlFor="reraRegistrationNo" className="sm:col-span-2">
              <Input id="reraRegistrationNo" {...form.register('reraRegistrationNo', nullable)} />
            </Field>
            <Field label="About" htmlFor="description" className="sm:col-span-2">
              <Textarea id="description" rows={4} {...form.register('description', nullable)} />
            </Field>
            <div className="sm:col-span-2">
              <Controller
                control={form.control}
                name="showContactPublicly"
                render={({ field }) => (
                  <CheckboxField checked={Boolean(field.value)} onCheckedChange={(v) => field.onChange(Boolean(v))} label="Show our phone/WhatsApp to customers who enquire" description="When off, customers reach you only through enquiry forms (their details come to your leads)." />
                )}
              />
            </div>
            <div className="flex justify-end sm:col-span-2">
              <Button type="submit" loading={form.formState.isSubmitting}>
                Save profile
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="At a glance" />
          <CardBody>
            <DescriptionList
              columns={2}
              items={[
                { label: 'Live listings', value: org.listingCounts.PUBLISHED ?? 0 },
                { label: 'In review', value: org.listingCounts.PENDING_REVIEW ?? 0 },
                { label: 'Drafts', value: org.listingCounts.DRAFT ?? 0 },
                { label: 'Member since', value: formatDate(org.createdAt) },
              ]}
            />
          </CardBody>
        </Card>
        {org.type === 'BROKERAGE' || org.type === 'PARTNER' ? <BrokerProfileCard orgId={org.id} profile={org.myBrokerProfile} onSaved={onSaved} /> : null}
        {org.type === 'DEVELOPER' ? <DeveloperProfileCard orgId={org.id} profile={org.developerProfile} onSaved={onSaved} /> : null}
      </div>
    </div>
  );
}

function BrokerProfileCard({ orgId, profile, onSaved }: { orgId: string; profile: OrgProfile['myBrokerProfile']; onSaved: () => void }) {
  const [v, setV] = React.useState({
    displayName: profile?.displayName ?? '',
    reraAgentNumber: profile?.reraAgentNumber ?? '',
    experienceYears: profile?.experienceYears?.toString() ?? '',
    languages: (profile?.languages ?? []).join(', '),
    about: profile?.about ?? '',
  });
  const save = useApiMutation(
    () =>
      api.put(`/organizations/${orgId}/broker-profile`, {
        displayName: v.displayName || undefined,
        reraAgentNumber: v.reraAgentNumber || null,
        experienceYears: v.experienceYears ? Number(v.experienceYears) : null,
        languages: v.languages.split(',').map((s) => s.trim()).filter((s) => s.length >= 2),
        about: v.about || null,
      }),
    { success: 'Broker profile saved', onSuccess: onSaved },
  );
  return (
    <Card>
      <CardHeader title="My broker profile" description="Shown on listings you publish." />
      <CardBody className="grid gap-3">
        <Field label="Display name" htmlFor="bp-name">
          <Input id="bp-name" value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} />
        </Field>
        <Field label="RERA agent number" htmlFor="bp-rera">
          <Input id="bp-rera" value={v.reraAgentNumber} onChange={(e) => setV({ ...v, reraAgentNumber: e.target.value })} />
        </Field>
        <Field label="Years of experience" htmlFor="bp-exp">
          <Input id="bp-exp" type="number" min={0} max={70} value={v.experienceYears} onChange={(e) => setV({ ...v, experienceYears: e.target.value })} />
        </Field>
        <Field label="Languages" htmlFor="bp-lang" hint="Comma separated">
          <Input id="bp-lang" value={v.languages} onChange={(e) => setV({ ...v, languages: e.target.value })} />
        </Field>
        <Field label="About" htmlFor="bp-about">
          <Textarea id="bp-about" rows={3} value={v.about} onChange={(e) => setV({ ...v, about: e.target.value })} />
        </Field>
        <Button className="w-fit" size="sm" loading={save.isPending} onClick={() => save.mutate(undefined)}>
          Save broker profile
        </Button>
      </CardBody>
    </Card>
  );
}

function DeveloperProfileCard({ orgId, profile, onSaved }: { orgId: string; profile: OrgProfile['developerProfile']; onSaved: () => void }) {
  const [v, setV] = React.useState({ establishedYear: profile?.establishedYear?.toString() ?? '', projectsDelivered: profile?.projectsDelivered?.toString() ?? '', about: profile?.about ?? '' });
  const save = useApiMutation(
    () => api.put(`/organizations/${orgId}/developer-profile`, { establishedYear: v.establishedYear ? Number(v.establishedYear) : null, projectsDelivered: v.projectsDelivered ? Number(v.projectsDelivered) : null, about: v.about || null }),
    { success: 'Developer profile saved', onSuccess: onSaved },
  );
  return (
    <Card>
      <CardHeader title="Developer profile" description="Shown on your project pages. Delivered projects are displayed as self-declared." />
      <CardBody className="grid gap-3">
        <Field label="Established (year)" htmlFor="dp-year">
          <Input id="dp-year" type="number" value={v.establishedYear} onChange={(e) => setV({ ...v, establishedYear: e.target.value })} />
        </Field>
        <Field label="Projects delivered" htmlFor="dp-delivered">
          <Input id="dp-delivered" type="number" value={v.projectsDelivered} onChange={(e) => setV({ ...v, projectsDelivered: e.target.value })} />
        </Field>
        <Field label="About" htmlFor="dp-about">
          <Textarea id="dp-about" rows={4} value={v.about} onChange={(e) => setV({ ...v, about: e.target.value })} />
        </Field>
        <Button className="w-fit" size="sm" loading={save.isPending} onClick={() => save.mutate(undefined)}>
          Save developer profile
        </Button>
      </CardBody>
    </Card>
  );
}

interface OrgDoc {
  id: string;
  docType: string;
  title: string;
  status: string;
  reviewNote: string | null;
  createdAt: string;
  file: { id: string; fileName: string };
}

function DocumentsTab({ orgId }: { orgId: string }) {
  const q = useApi<OrgDoc[]>(`/organizations/${orgId}/documents`);
  const [draft, setDraft] = React.useState<{ id: string; fileName: string } | null>(null);
  const [docType, setDocType] = React.useState<string>('IDENTITY_PROOF');
  const [title, setTitle] = React.useState('');
  const add = useApiMutation(() => api.post(`/organizations/${orgId}/documents`, { docType, title: title || draft!.fileName, fileId: draft!.id }), {
    success: 'Document submitted for review',
    invalidate: [`/organizations/${orgId}/documents`],
    onSuccess: () => {
      setDraft(null);
      setTitle('');
    },
  });
  const remove = useApiMutation((docId: string) => api.delete(`/organizations/${orgId}/documents/${docId}`), { success: 'Document removed', invalidate: [`/organizations/${orgId}/documents`] });
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader title="Verification documents" description="Private — visible only to your organisation and our verification team." />
        {q.data?.length ? (
          <Table>
            <THead>
              <tr>
                <TH>Document</TH>
                <TH>Status</TH>
                <TH align="right">Actions</TH>
              </tr>
            </THead>
            <TBody>
              {q.data.map((d) => (
                <TR key={d.id}>
                  <TD>
                    <div className="font-medium text-ink-900">{d.title}</div>
                    <div className="text-xs text-ink-500">
                      {enumLabel(d.docType)} · {formatDate(d.createdAt)}
                    </div>
                    {d.reviewNote ? <div className="mt-1 text-xs text-danger">{d.reviewNote}</div> : null}
                  </TD>
                  <TD>
                    <StatusBadge status={d.status} label={d.status === 'PENDING' ? 'In review' : undefined} />
                  </TD>
                  <TD align="right">
                    <div className="flex justify-end gap-1">
                      <Button size="xs" variant="ghost" onClick={() => void openDocument(d.file.id)}>
                        Open
                      </Button>
                      {d.status !== 'APPROVED' ? (
                        <Button size="xs" variant="ghost" className="text-danger" onClick={() => remove.mutate(d.id)} aria-label={`Remove ${d.title}`}>
                          <Trash2 />
                        </Button>
                      ) : null}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : q.isLoading ? (
          <Skeleton className="m-4 h-24" />
        ) : (
          <EmptyState icon={<FileText />} title="No documents uploaded" description="Upload identity, address and business registration documents to get verified." />
        )}
      </Card>
      <Card>
        <CardHeader title="Upload a document" />
        <CardBody className="grid gap-4">
          <DocumentUpload purpose="org-document" organizationId={orgId} onUploaded={(f) => setDraft(f)} />
          <Field label="Document type" htmlFor="docType">
            <Select id="docType" value={docType} onChange={(e) => setDocType(e.target.value)}>
              {ORG_DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {enumLabel(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title" htmlFor="docTitle">
            <Input id="docTitle" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={draft?.fileName ?? 'e.g. GST registration certificate'} />
          </Field>
          <Button disabled={!draft} loading={add.isPending} onClick={() => add.mutate(undefined)}>
            Submit document
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

interface Member {
  id: string;
  userId: string;
  title: string | null;
  isOwner: boolean;
  isSelf: boolean;
  status: string;
  user: { id: string; fullName: string; email: string | null; phone: string | null; status: string; lastLoginAt: string | null };
  roles: { key: string; name: string }[];
}

type InviteValues = z.input<typeof memberInviteSchema>;

function TeamTab({ orgId }: { orgId: string }) {
  const q = useApi<{ members: Member[]; assignableRoles: { id: string; key: string; name: string; description: string | null }[] }>(`/organizations/${orgId}/members`);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState<Member | null>(null);
  const remove = useApiMutation((userId: string) => api.delete(`/organizations/${orgId}/members/${userId}`), { success: 'Member removed', invalidate: [`/organizations/${orgId}/members`], onSuccess: () => setRemoving(null) });
  const changeRole = useApiMutation((v: { userId: string; roleKey: string }) => api.patch(`/organizations/${orgId}/members/${v.userId}`, { roleKey: v.roleKey }), { success: 'Role updated', invalidate: [`/organizations/${orgId}/members`] });
  const roles = q.data?.assignableRoles ?? [];
  return (
    <Card>
      <CardHeader
        title="Team members"
        description="Members sign in to this console. Agents see their own listings and assigned leads."
        actions={
          <Button size="sm" onClick={() => setInviteOpen(true)} disabled={!roles.length}>
            <UserPlus /> Add member
          </Button>
        }
      />
      {q.isLoading ? (
        <Skeleton className="m-4 h-24" />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Member</TH>
              <TH>Role</TH>
              <TH className="hidden md:table-cell">Last sign-in</TH>
              <TH align="right">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {(q.data?.members ?? []).map((m) => (
              <TR key={m.id}>
                <TD>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={m.user.fullName} size={30} />
                    <div className="min-w-0">
                      <div className="font-medium text-ink-900">
                        {m.user.fullName} {m.isOwner ? <Badge tone="dark" size="sm">Owner</Badge> : null} {m.isSelf ? <Badge tone="outline" size="sm">You</Badge> : null}
                      </div>
                      <div className="truncate text-xs text-ink-500">{m.user.email ?? m.user.phone}</div>
                    </div>
                  </div>
                </TD>
                <TD>
                  {m.isOwner || m.isSelf ? (
                    <span className="text-ink-700">{m.roles.map((r) => r.name).join(', ') || '—'}</span>
                  ) : (
                    <Select aria-label={`Role for ${m.user.fullName}`} className="h-8 w-44 text-[13px]" value={m.roles[0]?.key ?? ''} onChange={(e) => changeRole.mutate({ userId: m.userId, roleKey: e.target.value })}>
                      {!m.roles.length ? <option value="">No role</option> : null}
                      {roles.map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </TD>
                <TD className="hidden text-xs text-ink-500 md:table-cell">{m.user.lastLoginAt ? formatDateTime(m.user.lastLoginAt) : 'Never'}</TD>
                <TD align="right">
                  {!m.isOwner && !m.isSelf ? (
                    <Button size="xs" variant="ghost" className="text-danger" onClick={() => setRemoving(m)}>
                      Remove
                    </Button>
                  ) : null}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        {inviteOpen ? <InviteForm orgId={orgId} roles={roles} onDone={() => setInviteOpen(false)} /> : null}
      </Dialog>
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        tone="danger"
        title={`Remove ${removing?.user.fullName ?? 'member'}?`}
        description="They lose access to this organisation immediately. Their listings and leads stay with the organisation."
        confirmLabel="Remove member"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.userId)}
      />
    </Card>
  );
}

function InviteForm({ orgId, roles, onDone }: { orgId: string; roles: { key: string; name: string; description: string | null }[]; onDone: () => void }) {
  const form = useForm<InviteValues>({ resolver: zodResolver(memberInviteSchema), defaultValues: { fullName: '', email: '', roleKey: roles.find((r) => r.key === 'BROKER_AGENT')?.key ?? roles[0]?.key ?? '', title: '', password: '' } });
  const e = form.formState.errors;
  return (
    <DialogContent title="Add a team member" description="Creates a sign-in for a new colleague, or adds an existing account to your organisation.">
      <form
        noValidate
        className="grid gap-4"
        onSubmit={form.handleSubmit(async (v) => {
          try {
            const res = await api.post<{ message: string }>(`/organizations/${orgId}/members`, { ...v, phone: v.phone || undefined });
            toast.success(res.message);
            onDone();
          } catch (err) {
            if (!applyServerErrors(form, err)) toast.error(errorMessage(err));
          }
        })}
      >
        <Field label="Full name" htmlFor="fullName" required error={e.fullName?.message}>
          <Input id="fullName" {...form.register('fullName')} />
        </Field>
        <Field label="Email" htmlFor="inv-email" required error={e.email?.message}>
          <Input id="inv-email" type="email" {...form.register('email')} />
        </Field>
        <Field label="Mobile" htmlFor="inv-phone" error={e.phone?.message}>
          <Input id="inv-phone" inputMode="tel" {...form.register('phone')} />
        </Field>
        <Field label="Role" htmlFor="roleKey" required error={e.roleKey?.message}>
          <Select id="roleKey" {...form.register('roleKey')}>
            {roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Job title" htmlFor="inv-title">
          <Input id="inv-title" {...form.register('title')} />
        </Field>
        <Field label="Initial password" htmlFor="inv-pw" required hint="Share it with them securely; ignored if the account already exists." error={e.password?.message}>
          <Input id="inv-pw" type="password" autoComplete="new-password" {...form.register('password')} />
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting}>
            Add member
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

interface SubscriptionView {
  current: { id: string; status: string; startsAt: string; endsAt: string; amount: number; plan: { name: string; listingQuota: number | null; featuredQuota: number | null; features: string[] } } | null;
  history: { id: string; status: string; startsAt: string; endsAt: string; amount: number; paymentReference: string | null; plan: { name: string } }[];
  usage: { liveListings: number; featuredListings: number };
  plans: { id: string; name: string; price: number; billingPeriod: string; listingQuota: number | null; featuredQuota: number | null; features: string[] }[];
}

function SubscriptionTab({ orgId, type }: { orgId: string; type: string }) {
  const q = useApi<SubscriptionView>(`/organizations/${orgId}/subscription`);
  if (q.isLoading) return <Skeleton className="h-48 w-full" />;
  const s = q.data;
  if (!s) return null;
  const quota = s.current?.plan.listingQuota ?? null;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Current plan" />
        <CardBody>
          {s.current ? (
            <>
              <p className="font-display text-xl font-semibold text-ink-900">{s.current.plan.name}</p>
              <p className="mt-1 text-sm text-ink-500">
                {formatDate(s.current.startsAt)} – {formatDate(s.current.endsAt)} · {formatINR(s.current.amount)}
              </p>
              <div className="mt-5">
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="text-ink-600">Live listings</span>
                  <span className="tabular font-medium text-ink-900">
                    {s.usage.liveListings}
                    {quota !== null ? ` / ${quota}` : ' (no limit)'}
                  </span>
                </div>
                {quota !== null ? (
                  <div className="h-2 overflow-hidden rounded-full bg-ink-100" role="meter" aria-valuemin={0} aria-valuemax={quota} aria-valuenow={s.usage.liveListings} aria-label="Live listings used">
                    <div className={`h-full rounded-full ${s.usage.liveListings >= quota ? 'bg-danger' : 'bg-brand'}`} style={{ width: `${Math.min(100, (s.usage.liveListings / Math.max(quota, 1)) * 100)}%` }} />
                  </div>
                ) : null}
              </div>
              {s.current.plan.features.length ? (
                <ul className="mt-5 list-disc space-y-1 pl-5 text-sm text-ink-700">
                  {s.current.plan.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-ink-600">
              No active subscription. {type === 'BROKERAGE' ? 'Contact our partner team to choose a plan; payment is arranged offline and recorded by our team.' : 'Subscriptions are optional for your account type.'}
            </p>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Available plans" description="To change plans, contact our partner team — there is no online payment." />
        {s.plans.length ? (
          <ul className="divide-y divide-line">
            {s.plans.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 px-5 py-3.5">
                <div>
                  <p className="text-sm font-medium text-ink-900">{p.name}</p>
                  <p className="text-xs text-ink-500">{p.listingQuota === null ? 'Unlimited live listings' : `Up to ${p.listingQuota} live listings`}</p>
                </div>
                <p className="tabular text-sm text-ink-900">
                  {formatINR(p.price)}
                  <span className="text-xs text-ink-500"> / {enumLabel(p.billingPeriod).toLowerCase()}</span>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-6 text-sm text-ink-500">No plans are published yet.</p>
        )}
      </Card>
      {s.history.length > 0 ? (
        <Card className="lg:col-span-2">
          <CardHeader title="Subscription history" />
          <Table>
            <THead>
              <tr>
                <TH>Plan</TH>
                <TH>Period</TH>
                <TH align="right">Amount</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {s.history.map((h) => (
                <TR key={h.id}>
                  <TD className="font-medium text-ink-900">{h.plan.name}</TD>
                  <TD className="text-xs text-ink-600">
                    {formatDate(h.startsAt)} – {formatDate(h.endsAt)}
                  </TD>
                  <TD align="right" className="tabular">
                    {formatINR(h.amount)}
                  </TD>
                  <TD>
                    <StatusBadge status={h.status} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}
    </div>
  );
}
