'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ExternalLink, FileText, Globe, Image as ImageIcon, LayoutTemplate, ListChecks, MoreHorizontal, Pencil, Rows3, Sparkles, Trash2, Users } from 'lucide-react';
import { enumLabel } from '@estate/shared';
import {
  Badge,
  Button,
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
  PageHeader,
  Skeleton,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  CheckboxField,
} from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { ProjectForm } from '@/components/projects/project-form';
import { OverviewTab } from '@/components/projects/overview-tab';
import { MediaTab, DocumentsTab } from '@/components/projects/media-documents';
import { ContentTab } from '@/components/projects/content-tab';
import { TeamTab } from '@/components/projects/team-tab';
import { InventoryTab } from '@/components/projects/inventory-tab';
import { PageBuilderTab } from '@/components/projects/page-builder-tab';
import { DomainsTab } from '@/components/projects/domains-tab';
import type { ManageProject } from '@/components/projects/types';

const TABS = ['overview', 'details', 'media', 'inventory', 'page', 'domains', 'team', 'documents', 'content'] as const;
type Tab = (typeof TABS)[number];

function toFormInitial(p: ManageProject) {
  const date = (v: string | null) => (v ? v.slice(0, 10) : null);
  return {
    name: p.name,
    slug: p.slug,
    tagline: p.tagline,
    projectType: p.projectType,
    organizationId: p.organizationId,
    developerOrgId: p.developerOrgId,
    cityId: p.cityId,
    localityId: p.localityId,
    addressLine: p.addressLine,
    pincode: p.pincode,
    latitude: p.latitude,
    longitude: p.longitude,
    description: p.description,
    heroImageUrl: p.heroImageUrl,
    logoUrl: p.logoUrl,
    masterPlanUrl: p.masterPlanUrl,
    videoUrls: p.videoUrls,
    totalAreaAcres: p.totalAreaAcres,
    totalUnitsPlanned: p.totalUnitsPlanned,
    launchDate: date(p.launchDate),
    possessionDate: date(p.possessionDate),
    priceMinOverride: p.priceMinOverride,
    priceMaxOverride: p.priceMaxOverride,
    reraNumber: p.reraNumber,
    reraValidUntil: date(p.reraValidUntil),
    approvalDetails: p.approvalDetails,
    legalInformation: p.legalInformation,
    autoStatus: p.autoStatus,
    bookingOpensAt: p.bookingOpensAt,
    bookingClosesAt: p.bookingClosesAt,
    closingSoonHours: p.closingSoonHours,
    whatsappNumber: p.whatsappNumber,
    salesPhone: p.salesPhone,
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
    ogImageUrl: p.ogImageUrl,
    amenityIds: p.amenityIds,
  };
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const tab = (TABS.includes(search.get('tab') as Tab) ? search.get('tab') : 'overview') as Tab;
  const setTab = (t: string) => router.replace(`${pathname}?tab=${t}`, { scroll: false });
  const q = useApi<ManageProject>(`/projects/${id}`);
  const p = q.data;
  const refetch = () => void q.refetch();

  const [review, setReview] = React.useState<'APPROVE' | 'REJECT' | null>(null);
  const [note, setNote] = React.useState('');
  const [publishToo, setPublishToo] = React.useState(true);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = React.useState(false);

  const submit = useApiMutation(() => api.post(`/projects/${id}/review/submit`), { success: 'Submitted for review', invalidate: ['/projects'] });
  const decide = useApiMutation(() => api.post(`/projects/${id}/review/decision`, { decision: review, note: note || undefined, publish: review === 'APPROVE' && publishToo && p?.permissions.canPublish ? true : undefined }), {
    success: review === 'APPROVE' ? 'Project approved' : 'Changes requested',
    invalidate: ['/projects'],
    onSuccess: () => {
      setReview(null);
      setNote('');
    },
  });
  const publish = useApiMutation((on: boolean) => api.post(`/projects/${id}/${on ? 'publish' : 'unpublish'}`), {
    success: (r: unknown) => ((r as ManageProject).isPublished ? 'Project is live' : 'Project unpublished'),
    invalidate: ['/projects'],
    onSuccess: () => setConfirmUnpublish(false),
  });
  const feature = useApiMutation((on: boolean) => api.post(`/projects/${id}/feature`, { featured: on }), { success: 'Updated', invalidate: ['/projects'] });
  const remove = useApiMutation(() => api.delete(`/projects/${id}`), { success: 'Project deleted', invalidate: ['/projects'], onSuccess: () => router.replace('/projects') });
  const save = useApiMutation((values: Record<string, unknown>) => api.patch<ManageProject>(`/projects/${id}`, values), { success: 'Changes saved', invalidate: ['/projects'], silent: true });

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!p) {
    return (
      <EmptyState
        title="Project not found"
        description="It may have been deleted, or you no longer have access."
        action={
          <Button asChild variant="outline">
            <Link href="/projects">Back to projects</Link>
          </Button>
        }
      />
    );
  }

  const perms = p.permissions;
  const needsReview = p.organization.projectPublishMode !== 'DIRECT';

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Link href="/projects" className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
            <ChevronLeft className="size-4" /> Projects
          </Link>
        }
        title={p.name}
        description={
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <StatusBadge status={p.computedStatus} />
            <StatusBadge status={p.reviewStatus} label={p.reviewStatus === 'NOT_SUBMITTED' ? 'Not reviewed' : enumLabel(p.reviewStatus)} />
            {p.isPublished ? <Badge tone="success">Live</Badge> : <Badge tone="neutral">Not published</Badge>}
            {p.isFeatured ? <Badge tone="brand">Featured</Badge> : null}
            {p.isDemo ? <Badge tone="outline">Demo data</Badge> : null}
            <span>{enumLabel(p.projectType)}</span>
            <span aria-hidden>·</span>
            <span>
              {p.locality.name}, {p.city.name}
            </span>
            <span aria-hidden>·</span>
            <span>{p.organization.name}</span>
          </span>
        }
        actions={
          <>
            {p.isPublished ? (
              <Button asChild variant="outline" size="sm">
                <a href={p.publicUrl} target="_blank" rel="noreferrer">
                  <ExternalLink /> View live
                </a>
              </Button>
            ) : null}
            {perms.canEdit && needsReview && ['NOT_SUBMITTED', 'REJECTED'].includes(p.reviewStatus) ? (
              <Button size="sm" loading={submit.isPending} onClick={() => submit.mutate(undefined)}>
                Submit for review
              </Button>
            ) : null}
            {perms.canApprove && p.reviewStatus === 'PENDING_REVIEW' ? (
              <>
                <Button size="sm" variant="destructive-outline" onClick={() => setReview('REJECT')}>
                  Request changes
                </Button>
                <Button size="sm" onClick={() => setReview('APPROVE')}>
                  Approve
                </Button>
              </>
            ) : null}
            {perms.canPublish && !p.isPublished && p.status !== 'ARCHIVED' && (!needsReview || p.reviewStatus === 'APPROVED') ? (
              <Button size="sm" loading={publish.isPending} onClick={() => publish.mutate(true)}>
                Publish
              </Button>
            ) : null}
            {perms.canPublish || perms.canFeature || perms.canDelete ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon-sm" aria-label="More actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {perms.canFeature && p.isPublished ? (
                    <DropdownMenuItem onSelect={() => feature.mutate(!p.isFeatured)}>
                      <Sparkles /> {p.isFeatured ? 'Remove from featured' : 'Feature on the homepage'}
                    </DropdownMenuItem>
                  ) : null}
                  {perms.canPublish && p.isPublished ? <DropdownMenuItem onSelect={() => setConfirmUnpublish(true)}>Unpublish</DropdownMenuItem> : null}
                  {perms.canDelete && !p.isPublished ? (
                    <DropdownMenuItem tone="danger" onSelect={() => setConfirmDelete(true)}>
                      <Trash2 /> Delete project
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">
            <ListChecks /> Overview
          </TabsTrigger>
          <TabsTrigger value="details">
            <Pencil /> Details
          </TabsTrigger>
          <TabsTrigger value="media">
            <ImageIcon /> Media
          </TabsTrigger>
          <TabsTrigger value="inventory">
            <Rows3 /> Inventory ({p.inventory.total})
          </TabsTrigger>
          <TabsTrigger value="page">
            <LayoutTemplate /> Page builder
          </TabsTrigger>
          <TabsTrigger value="domains">
            <Globe /> Domains
          </TabsTrigger>
          <TabsTrigger value="team">
            <Users /> Team
          </TabsTrigger>
          <TabsTrigger value="documents">
            <FileText /> Documents ({p.documents.length})
          </TabsTrigger>
          <TabsTrigger value="content">FAQs & updates</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab project={p} />
        </TabsContent>
        <TabsContent value="details">
          <ProjectForm
            key={String(q.dataUpdatedAt)}
            mode="edit"
            initial={toFormInitial(p) as never}
            disabled={!perms.canEdit || p.status === 'ARCHIVED'}
            onSubmit={async (values) => {
              await save.mutateAsync(values);
            }}
          />
        </TabsContent>
        <TabsContent value="media">
          <MediaTab project={p} onSaved={refetch} />
        </TabsContent>
        <TabsContent value="inventory">
          <InventoryTab project={p} onChanged={refetch} />
        </TabsContent>
        <TabsContent value="page">
          <PageBuilderTab project={p} />
        </TabsContent>
        <TabsContent value="domains">
          <DomainsTab project={p} />
        </TabsContent>
        <TabsContent value="team">
          <TeamTab project={p} onChanged={refetch} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsTab project={p} onChanged={refetch} />
        </TabsContent>
        <TabsContent value="content">
          <ContentTab project={p} onChanged={refetch} />
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(review)} onOpenChange={(o) => !o && setReview(null)}>
        {review ? (
          <DialogContent title={review === 'APPROVE' ? 'Approve project' : 'Request changes'} description={review === 'APPROVE' ? 'The developer is notified. Approved projects can be published.' : 'Explain what needs to change — the developer sees this note.'}>
            <div className="grid gap-4">
              <Field label={review === 'REJECT' ? 'What needs to change' : 'Note (optional)'} htmlFor="note" required={review === 'REJECT'}>
                <Textarea id="note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              {review === 'APPROVE' && perms.canPublish ? <CheckboxField label="Publish the project now" description="Makes the project page and its domains live." checked={publishToo} onCheckedChange={(v) => setPublishToo(Boolean(v))} /> : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReview(null)}>
                Cancel
              </Button>
              <Button variant={review === 'REJECT' ? 'destructive' : 'primary'} loading={decide.isPending} disabled={review === 'REJECT' && note.trim().length < 3} onClick={() => decide.mutate(undefined)}>
                {review === 'APPROVE' ? 'Approve' : 'Request changes'}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={confirmUnpublish}
        onOpenChange={setConfirmUnpublish}
        title="Unpublish this project?"
        description="The project page and all its domains stop being publicly available. Inventory and leads are kept."
        confirmLabel="Unpublish"
        loading={publish.isPending}
        onConfirm={() => publish.mutate(false)}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        tone="danger"
        title="Delete this project?"
        description="The project is removed from all lists and its domains are released. Its history stays in the audit log."
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </>
  );
}
