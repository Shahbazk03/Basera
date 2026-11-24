'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { BadgeCheck, ChevronLeft, ExternalLink, FileText, History, ImageIcon, MoreHorizontal, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { enumLabel, formatDateTime, formatPriceCompact, PROPERTY_DOCUMENT_TYPES } from '@estate/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
import { useApi, useApiMutation } from '@/lib/hooks';
import { PropertyForm } from '@/components/listings/property-form';
import { DocumentUpload, ImageUploader, openDocument, type MediaItem } from '@/components/uploaders';

interface ManageProperty {
  id: string;
  slug: string;
  referenceCode: string;
  title: string;
  status: string;
  verificationStatus: string;
  availability: string;
  listingType: 'SALE' | 'RENT';
  isFeatured: boolean;
  isDemo: boolean;
  price: number;
  rejectionReason: string | null;
  organizationId: string;
  organization: { id: string; name: string; type: string; status: string; verificationStatus: string };
  listedBy: { id: string; fullName: string; email: string | null };
  media: { id: string; url: string; type: string; caption: string | null; isCover: boolean }[];
  documents: { id: string; title: string; docType: string; visibility: string; createdAt: string; file: { id: string; fileName: string } }[];
  statusHistory: { id: string; fromStatus: string | null; toStatus: string; reason: string | null; createdAt: string; changedBy: { fullName: string } | null }[];
  reports: { id: string; reason: string; details: string | null; status: string; createdAt: string }[];
  amenityIds: string[];
  allowedActions: { action: string; to: string; requiresReason: boolean }[];
  canEdit: boolean;
  canReview: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
  viewCount: number;
  [key: string]: unknown;
}

const ACTION_LABELS: Record<string, string> = {
  submit: 'Submit for review',
  withdraw: 'Withdraw from review',
  approve: 'Approve',
  reject: 'Reject',
  publish: 'Publish',
  archive: 'Archive',
  revise: 'Move back to draft',
  mark_sold: 'Mark as sold',
  mark_rented: 'Mark as rented',
  expire: 'Expire now',
  resubmit: 'Resubmit for review',
  renew: 'Renew listing',
  relist: 'Relist',
  restore: 'Restore to draft',
};
const PRIMARY_ACTIONS = new Set(['submit', 'approve', 'publish', 'renew']);

function toFormInitial(p: ManageProperty) {
  const keys = [
    'title', 'description', 'propertyTypeId', 'listingType', 'cityId', 'localityId', 'addressLine', 'landmark', 'pincode', 'latitude', 'longitude', 'hideExactLocation', 'area', 'areaUnit', 'price',
    'priceNegotiable', 'maintenanceMonthly', 'securityDeposit', 'bookingAmount', 'bedrooms', 'bathrooms', 'balconies', 'furnishing', 'floorNumber', 'totalFloors', 'facing', 'possessionStatus',
    'availableFrom', 'ageYears', 'plotLengthFt', 'plotWidthFt', 'roadWidthFt', 'isCornerPlot', 'ownershipType', 'approvalAuthority', 'reraNumber', 'coveredParking', 'openParking', 'carpetAreaSqft',
    'builtUpAreaSqft', 'superAreaSqft', 'plotAreaSqft', 'attributes', 'highlights', 'ownerName', 'ownerPhone', 'ownerEmail', 'projectId',
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = p[k];
    out[k] = k === 'availableFrom' && typeof v === 'string' ? v.slice(0, 10) : v ?? null;
  }
  out.amenityIds = p.amenityIds;
  return out;
}

export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const [tab, setTab] = React.useState(search.get('tab') ?? 'details');
  const q = useApi<ManageProperty>(`/properties/${id}`);
  const p = q.data;
  const webUrl = process.env.NEXT_PUBLIC_WEB_URL ?? '';

  const [pending, setPending] = React.useState<{ action: string; requiresReason: boolean } | null>(null);
  const [reason, setReason] = React.useState('');
  const transition = useApiMutation((vars: { action: string; reason?: string }) => api.post<ManageProperty>(`/properties/${id}/transition`, vars), {
    success: (r) => `Listing is now ${enumLabel(r.status).toLowerCase()}`,
    invalidate: ['/properties'],
    onSuccess: () => {
      setPending(null);
      setReason('');
    },
  });
  const save = useApiMutation((values: Record<string, unknown>) => api.patch<ManageProperty>(`/properties/${id}`, values), {
    success: (r) => (r.status === 'PENDING_REVIEW' && p?.status === 'PUBLISHED' ? 'Saved — the listing will be reviewed again before going live' : 'Changes saved'),
    invalidate: ['/properties'],
    silent: true,
  });
  const verify = useApiMutation((status: string) => api.post(`/properties/${id}/verification`, { status }), { success: 'Verification updated', invalidate: ['/properties'] });
  const feature = useApiMutation((featured: boolean) => api.post(`/properties/${id}/feature`, { featured, days: 30 }), { success: 'Updated', invalidate: ['/properties'] });
  const remove = useApiMutation(() => api.delete(`/properties/${id}`), { success: 'Listing deleted', invalidate: ['/properties'], onSuccess: () => router.replace('/listings') });
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!p) return <EmptyState title="Listing not found" description="It may have been deleted, or you no longer have access." action={<Button asChild variant="outline"><Link href="/listings">Back to listings</Link></Button>} />;

  const closed = ['SOLD', 'RENTED', 'ARCHIVED'].includes(p.status);
  const actions = p.allowedActions;

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Link href="/listings" className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
            <ChevronLeft className="size-4" /> Listings
          </Link>
        }
        title={p.title}
        description={
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <StatusBadge status={p.status} />
            {p.verificationStatus === 'VERIFIED' ? (
              <Badge tone="success">
                <BadgeCheck /> Verified
              </Badge>
            ) : null}
            {p.isDemo ? <Badge tone="outline">Demo data</Badge> : null}
            <span className="tabular">{p.referenceCode}</span>
            <span aria-hidden>·</span>
            <span>{p.organization.name}</span>
            <span aria-hidden>·</span>
            <span className="tabular">
              {formatPriceCompact(p.price)}
              {p.listingType === 'RENT' ? '/month' : ''}
            </span>
          </span>
        }
        actions={
          <>
            {p.status === 'PUBLISHED' ? (
              <Button asChild variant="outline" size="sm">
                <a href={`${webUrl}/property/${p.slug}`} target="_blank" rel="noreferrer">
                  <ExternalLink /> View live
                </a>
              </Button>
            ) : null}
            {actions.map((a) => (
              <Button key={a.action} size="sm" variant={PRIMARY_ACTIONS.has(a.action) ? 'primary' : a.action === 'reject' ? 'destructive-outline' : 'outline'} onClick={() => setPending(a)}>
                {ACTION_LABELS[a.action] ?? enumLabel(a.action)}
              </Button>
            ))}
            {p.canReview || p.canEdit ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon-sm" aria-label="More actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {p.canReview ? (
                    <>
                      <DropdownMenuItem onSelect={() => verify.mutate(p.verificationStatus === 'VERIFIED' ? 'PENDING' : 'VERIFIED')}>
                        <BadgeCheck /> {p.verificationStatus === 'VERIFIED' ? 'Remove verified badge' : 'Mark documents verified'}
                      </DropdownMenuItem>
                      {p.status === 'PUBLISHED' ? (
                        <DropdownMenuItem onSelect={() => feature.mutate(!p.isFeatured)}>
                          <Sparkles /> {p.isFeatured ? 'Remove from featured' : 'Feature for 30 days'}
                        </DropdownMenuItem>
                      ) : null}
                    </>
                  ) : null}
                  {p.canEdit && p.status !== 'PUBLISHED' ? (
                    <DropdownMenuItem tone="danger" onSelect={() => setConfirmDelete(true)}>
                      <Trash2 /> Delete listing
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
      />

      <div className="mb-5 flex flex-col gap-3">
        {p.status === 'REJECTED' && p.rejectionReason ? (
          <Alert tone="danger" title="Changes requested by the review team">
            {p.rejectionReason}
          </Alert>
        ) : null}
        {p.organization.status !== 'ACTIVE' ? (
          <Alert tone="warning" title="Organisation not verified">
            {p.organization.name} is awaiting verification. You can prepare and submit listings, but they cannot be approved or published until the organisation is approved.
          </Alert>
        ) : null}
        {p.status === 'DRAFT' && p.media.length === 0 ? <Alert tone="info">Add at least one photo before submitting this listing for review.</Alert> : null}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="details">
            <Pencil /> Details
          </TabsTrigger>
          <TabsTrigger value="photos">
            <ImageIcon /> Photos ({p.media.length})
          </TabsTrigger>
          <TabsTrigger value="documents">
            <FileText /> Documents ({p.documents.length})
          </TabsTrigger>
          <TabsTrigger value="history">
            <History /> History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <PropertyForm key={String(q.dataUpdatedAt)} mode="edit" initial={toFormInitial(p) as never} disabled={!p.canEdit || closed} submitting={save.isPending} onSubmit={(values) => save.mutateAsync(values)} />
        </TabsContent>

        <TabsContent value="photos">
          <PhotosEditor property={p} onSaved={() => void q.refetch()} />
        </TabsContent>

        <TabsContent value="documents">
          <DocumentsEditor property={p} onChanged={() => void q.refetch()} />
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader title="Status history" description="Every lifecycle change with who made it and why." />
            <CardBody>
              <ol className="relative space-y-5 border-l border-line pl-5">
                {p.statusHistory.map((h) => (
                  <li key={h.id} className="relative">
                    <span className="absolute -left-[25px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-ink-400" />
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {h.fromStatus ? <StatusBadge status={h.fromStatus} size="sm" /> : null}
                      {h.fromStatus ? <span className="text-ink-400">→</span> : null}
                      <StatusBadge status={h.toStatus} size="sm" />
                    </div>
                    <p className="mt-1 text-xs text-ink-500">
                      {formatDateTime(h.createdAt)} · {h.changedBy?.fullName ?? 'System'}
                    </p>
                    {h.reason ? <p className="mt-1 text-sm text-ink-700">{h.reason}</p> : null}
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(pending)} onOpenChange={(o) => !o && setPending(null)}>
        {pending ? (
          <DialogContent title={ACTION_LABELS[pending.action] ?? enumLabel(pending.action)} description={pending.action === 'reject' ? 'Tell the lister what needs to change. They will see this note.' : 'Confirm this change to the listing.'}>
            <Field label={pending.requiresReason ? 'Reason' : 'Note (optional)'} htmlFor="reason" required={pending.requiresReason}>
              <Textarea id="reason" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button
                variant={pending.action === 'reject' ? 'destructive' : 'primary'}
                loading={transition.isPending}
                disabled={pending.requiresReason && reason.trim().length < 3}
                onClick={() => transition.mutate({ action: pending.action, reason: reason.trim() || undefined })}
              >
                {ACTION_LABELS[pending.action] ?? 'Confirm'}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        tone="danger"
        title="Delete this listing?"
        description="The listing is removed from all lists. Its history is kept in the audit log."
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </>
  );
}

function PhotosEditor({ property, onSaved }: { property: ManageProperty; onSaved: () => void }) {
  const initial = React.useMemo<MediaItem[]>(() => property.media.filter((m) => m.type === 'IMAGE').map((m) => ({ key: m.id, url: m.url, isCover: m.isCover, caption: m.caption, type: 'IMAGE' })), [property.media]);
  const [items, setItems] = React.useState<MediaItem[]>(initial);
  React.useEffect(() => setItems(initial), [initial]);
  const dirty = JSON.stringify(items.map((i) => [i.url, i.isCover])) !== JSON.stringify(initial.map((i) => [i.url, i.isCover]));
  const save = useApiMutation(() => api.put(`/properties/${property.id}/media`, { items: items.map((i) => ({ type: 'IMAGE', fileId: i.fileId, url: i.fileId ? undefined : i.url, caption: i.caption ?? null, isCover: i.isCover })) }), {
    success: 'Photos saved',
    invalidate: ['/properties'],
    onSuccess: onSaved,
  });
  const disabled = !property.canEdit || ['SOLD', 'RENTED', 'ARCHIVED'].includes(property.status);
  return (
    <Card>
      <CardHeader
        title="Photos"
        description="The first photo marked as cover is shown in search results. Use real photographs of this property."
        actions={
          <Button size="sm" disabled={!dirty || disabled} loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Save photos
          </Button>
        }
      />
      <CardBody>
        {property.status === 'PUBLISHED' && !property.canReview ? <Alert tone="info" className="mb-4">Changing photos on a live listing sends it back for a quick review.</Alert> : null}
        <ImageUploader items={items} onChange={setItems} purpose="property-media" organizationId={property.organizationId} disabled={disabled} />
      </CardBody>
    </Card>
  );
}

function DocumentsEditor({ property, onChanged }: { property: ManageProperty; onChanged: () => void }) {
  const [draft, setDraft] = React.useState<{ fileId: string; fileName: string } | null>(null);
  const [docType, setDocType] = React.useState<string>('TITLE_DEED');
  const [title, setTitle] = React.useState('');
  const [visibility, setVisibility] = React.useState('PRIVATE');
  const add = useApiMutation(() => api.post(`/properties/${property.id}/documents`, { docType, title: title || draft!.fileName, fileId: draft!.fileId, visibility }), {
    success: 'Document attached',
    invalidate: ['/properties'],
    onSuccess: () => {
      setDraft(null);
      setTitle('');
      onChanged();
    },
  });
  const remove = useApiMutation((docId: string) => api.delete(`/properties/${property.id}/documents/${docId}`), { success: 'Document removed', invalidate: ['/properties'], onSuccess: onChanged });
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader title="Documents" description="Private documents are only visible to your team and our verification staff." />
        {property.documents.length ? (
          <Table>
            <THead>
              <tr>
                <TH>Document</TH>
                <TH>Type</TH>
                <TH>Visibility</TH>
                <TH align="right">Actions</TH>
              </tr>
            </THead>
            <TBody>
              {property.documents.map((d) => (
                <TR key={d.id}>
                  <TD>
                    <div className="font-medium text-ink-900">{d.title}</div>
                    <div className="text-xs text-ink-500">{d.file.fileName}</div>
                  </TD>
                  <TD>{enumLabel(d.docType)}</TD>
                  <TD>
                    <Badge tone={d.visibility === 'PUBLIC' ? 'info' : 'neutral'}>{enumLabel(d.visibility)}</Badge>
                  </TD>
                  <TD align="right">
                    <div className="flex justify-end gap-1">
                      <Button size="xs" variant="ghost" onClick={() => void openDocument(d.file.id)}>
                        Open
                      </Button>
                      {property.canEdit ? (
                        <Button size="xs" variant="ghost" className="text-danger" onClick={() => remove.mutate(d.id)}>
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState icon={<FileText />} title="No documents yet" description="Upload ownership or approval documents to get the Verified badge." />
        )}
      </Card>
      {property.canEdit ? (
        <Card>
          <CardHeader title="Add a document" />
          <CardBody className="grid gap-4">
            <DocumentUpload purpose="property-document" organizationId={property.organizationId} onUploaded={(f) => setDraft({ fileId: f.id, fileName: f.fileName })} />
            <Field label="Document type" htmlFor="docType">
              <Select id="docType" value={docType} onChange={(e) => setDocType(e.target.value)}>
                {PROPERTY_DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {enumLabel(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Title" htmlFor="docTitle">
              <Input id="docTitle" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={draft?.fileName ?? 'e.g. Registered sale deed'} />
            </Field>
            <Field label="Visibility" htmlFor="docVisibility" hint="Public documents can be downloaded from the listing page.">
              <Select id="docVisibility" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                <option value="PRIVATE">Private</option>
                <option value="ON_REQUEST">On request</option>
                <option value="PUBLIC">Public</option>
              </Select>
            </Field>
            <Button disabled={!draft} loading={add.isPending} onClick={() => (draft ? add.mutate(undefined) : toast.error('Upload a file first'))}>
              Attach document
            </Button>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
