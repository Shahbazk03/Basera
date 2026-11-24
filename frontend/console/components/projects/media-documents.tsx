'use client';

import * as React from 'react';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { enumLabel, formatDate, PROPERTY_DOCUMENT_TYPES } from '@estate/shared';
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Select, Table, TBody, TD, TH, THead, TR, toast } from '@estate/ui';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/hooks';
import { DocumentUpload, ImageUploader, openDocument, type MediaItem } from '@/components/uploaders';
import type { ManageProject } from './types';

function toItems(project: ManageProject, type: MediaItem['type']): MediaItem[] {
  return project.media.filter((m) => m.type === type).map((m, i) => ({ key: m.id, url: m.url, caption: m.caption, type: m.type, isCover: i === 0 }));
}

/** The item marked as cover leads its list (first photo in the public gallery). */
function coverFirst(items: MediaItem[]): MediaItem[] {
  const cover = items.find((m) => m.isCover);
  return cover ? [cover, ...items.filter((m) => m !== cover)] : items;
}

export function MediaTab({ project, onSaved }: { project: ManageProject; onSaved: () => void }) {
  const initial = React.useMemo(() => ({ gallery: toItems(project, 'IMAGE'), plans: toItems(project, 'FLOOR_PLAN'), videos: project.media.filter((m) => m.type === 'VIDEO').map((m) => m.url) }), [project]);
  const [gallery, setGallery] = React.useState(initial.gallery);
  const [plans, setPlans] = React.useState(initial.plans);
  const [videos, setVideos] = React.useState<string[]>(initial.videos);
  const [videoInput, setVideoInput] = React.useState('');
  React.useEffect(() => {
    setGallery(initial.gallery);
    setPlans(initial.plans);
    setVideos(initial.videos);
  }, [initial]);
  const disabled = !project.permissions.canEdit;
  const dirty =
    JSON.stringify([coverFirst(gallery).map((g) => g.url), coverFirst(plans).map((p) => p.url), videos]) !== JSON.stringify([initial.gallery.map((g) => g.url), initial.plans.map((p) => p.url), initial.videos]);
  const save = useApiMutation(
    () => {
      const item = (m: MediaItem, type: string) => ({ type, fileId: m.fileId, url: m.fileId ? undefined : m.url, caption: m.caption ?? null });
      return api.put(`/projects/${project.id}/media`, {
        items: [...coverFirst(gallery).map((m) => item(m, 'IMAGE')), ...coverFirst(plans).map((m) => item(m, 'FLOOR_PLAN')), ...videos.map((url) => ({ type: 'VIDEO', url }))],
      });
    },
    { success: 'Media saved', invalidate: ['/projects'], onSuccess: onSaved },
  );

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title="Gallery"
          description="Photos shown in the project gallery — the cover photo is shown first. The hero image and master plan are set in Details."
          actions={
            <Button size="sm" disabled={!dirty || disabled} loading={save.isPending} onClick={() => save.mutate(undefined)}>
              Save media
            </Button>
          }
        />
        <CardBody>
          <ImageUploader items={gallery} onChange={setGallery} purpose="project-media" organizationId={project.organizationId} max={60} disabled={disabled} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Floor plans" description="Unit layouts shown alongside the inventory." />
        <CardBody>
          <ImageUploader items={plans} onChange={setPlans} purpose="project-media" organizationId={project.organizationId} max={20} disabled={disabled} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Walkthrough videos" description="YouTube or Vimeo links." />
        <CardBody className="grid gap-3">
          <div className="flex gap-2">
            <Input value={videoInput} onChange={(e) => setVideoInput(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" disabled={disabled} />
            <Button
              variant="outline"
              disabled={disabled || !/^https:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com)\//.test(videoInput.trim())}
              onClick={() => {
                setVideos([...videos, videoInput.trim()]);
                setVideoInput('');
              }}
            >
              <Plus /> Add
            </Button>
          </div>
          {videos.length ? (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {videos.map((v, i) => (
                <li key={`${v}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <a href={v} target="_blank" rel="noreferrer" className="truncate text-brand hover:underline">
                    {v}
                  </a>
                  <Button size="xs" variant="ghost" disabled={disabled} onClick={() => setVideos(videos.filter((_, j) => j !== i))} aria-label="Remove video">
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-500">No videos added.</p>
          )}
          {dirty ? <Alert tone="warning">You have unsaved media changes — press “Save media”.</Alert> : null}
        </CardBody>
      </Card>
    </div>
  );
}

export function DocumentsTab({ project, onChanged }: { project: ManageProject; onChanged: () => void }) {
  const [draft, setDraft] = React.useState<{ fileId: string; fileName: string } | null>(null);
  const [docType, setDocType] = React.useState<string>('BROCHURE');
  const [title, setTitle] = React.useState('');
  const [visibility, setVisibility] = React.useState('PUBLIC');
  const canEdit = project.permissions.canEdit;
  const add = useApiMutation(() => api.post(`/projects/${project.id}/documents`, { docType, title: title || draft!.fileName, fileId: draft!.fileId, visibility }), {
    success: 'Document attached',
    invalidate: ['/projects'],
    onSuccess: () => {
      setDraft(null);
      setTitle('');
      onChanged();
    },
  });
  const update = useApiMutation((v: { id: string; visibility: string }) => api.patch(`/projects/${project.id}/documents/${v.id}`, { visibility: v.visibility }), { success: 'Visibility updated', invalidate: ['/projects'], onSuccess: onChanged });
  const remove = useApiMutation((docId: string) => api.delete(`/projects/${project.id}/documents/${docId}`), { success: 'Document removed', invalidate: ['/projects'], onSuccess: onChanged });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader title="Documents" description="Public documents can be downloaded from the project page; “on request” documents are listed and requested through an enquiry; private ones stay internal." />
        {project.documents.length ? (
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
              {project.documents.map((d) => (
                <TR key={d.id}>
                  <TD>
                    <div className="font-medium text-ink-900">{d.title}</div>
                    <div className="text-xs text-ink-500">
                      {d.file.fileName} · added {formatDate(d.createdAt)}
                    </div>
                  </TD>
                  <TD>{enumLabel(d.docType)}</TD>
                  <TD>
                    {canEdit ? (
                      <Select value={d.visibility} onChange={(e) => update.mutate({ id: d.id, visibility: e.target.value })} className="h-8 w-36 text-[13px]" aria-label="Visibility">
                        <option value="PUBLIC">Public</option>
                        <option value="ON_REQUEST">On request</option>
                        <option value="PRIVATE">Private</option>
                      </Select>
                    ) : (
                      <Badge tone={d.visibility === 'PUBLIC' ? 'info' : 'neutral'}>{enumLabel(d.visibility)}</Badge>
                    )}
                  </TD>
                  <TD align="right">
                    <div className="flex justify-end gap-1">
                      <Button size="xs" variant="ghost" onClick={() => void openDocument(d.file.id)}>
                        Open
                      </Button>
                      {canEdit ? (
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
          <EmptyState icon={<FileText />} title="No documents yet" description="Add the brochure, RERA certificate, approvals and price list." />
        )}
      </Card>
      {canEdit ? (
        <Card>
          <CardHeader title="Add a document" />
          <CardBody className="grid gap-4">
            <DocumentUpload purpose="project-document" organizationId={project.organizationId} onUploaded={(f) => setDraft({ fileId: f.id, fileName: f.fileName })} />
            <Field label="Document type" htmlFor="pdocType">
              <Select id="pdocType" value={docType} onChange={(e) => setDocType(e.target.value)}>
                {PROPERTY_DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {enumLabel(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Title" htmlFor="pdocTitle">
              <Input id="pdocTitle" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={draft?.fileName ?? 'e.g. Project brochure'} />
            </Field>
            <Field label="Visibility" htmlFor="pdocVis">
              <Select id="pdocVis" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                <option value="PUBLIC">Public — downloadable</option>
                <option value="ON_REQUEST">On request — via enquiry</option>
                <option value="PRIVATE">Private — internal only</option>
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
