'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { HelpCircle, MapPin, Pencil, Plus, Trash2, Wrench } from 'lucide-react';
import { constructionUpdateSchema, enumLabel, formatDate, NEARBY_CATEGORIES, projectFaqSchema, projectNearbySchema, localDateString } from '@estate/shared';
import { Button, Card, CardHeader, ConfirmDialog, Dialog, DialogContent, DialogFooter, EmptyState, Field, Input, Select, Textarea } from '@estate/ui';
import { api } from '@/lib/api';
import { applyServerErrors, useApiMutation } from '@/lib/hooks';
import type { ManageProject } from './types';

type Kind = 'faqs' | 'nearby' | 'construction-updates';

function useRemove(projectId: string, kind: Kind, onChanged: () => void) {
  return useApiMutation((itemId: string) => api.delete(`/projects/${projectId}/${kind}/${itemId}`), { success: 'Removed', invalidate: ['/projects'], onSuccess: onChanged });
}

function RowActions({ canEdit, onEdit, onDelete }: { canEdit: boolean; onEdit: () => void; onDelete: () => void }) {
  if (!canEdit) return null;
  return (
    <div className="flex shrink-0 gap-1">
      <Button size="icon-sm" variant="ghost" aria-label="Edit" onClick={onEdit}>
        <Pencil />
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Delete" className="text-danger hover:bg-danger-soft" onClick={onDelete}>
        <Trash2 />
      </Button>
    </div>
  );
}

// ───────────── FAQs ─────────────

const faqForm = projectFaqSchema.omit({ sortOrder: true });

function FaqDialog({ projectId, item, onClose, onSaved }: { projectId: string; item: ManageProject['faqs'][number] | 'new'; onClose: () => void; onSaved: () => void }) {
  const form = useForm<z.input<typeof faqForm>>({ resolver: zodResolver(faqForm), defaultValues: item === 'new' ? { question: '', answer: '' } : { question: item.question, answer: item.answer } });
  const submit = form.handleSubmit(async (v) => {
    try {
      if (item === 'new') await api.post(`/projects/${projectId}/faqs`, v);
      else await api.patch(`/projects/${projectId}/faqs/${item.id}`, v);
      onSaved();
      onClose();
    } catch (err) {
      applyServerErrors(form, err);
    }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={item === 'new' ? 'Add FAQ' : 'Edit FAQ'}>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Field label="Question" htmlFor="q" required error={form.formState.errors.question?.message}>
            <Input id="q" {...form.register('question')} />
          </Field>
          <Field label="Answer" htmlFor="a" required error={form.formState.errors.answer?.message}>
            <Textarea id="a" rows={5} {...form.register('answer')} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Nearby ─────────────

const nearbyForm = projectNearbySchema.omit({ sortOrder: true });

function NearbyDialog({ projectId, item, onClose, onSaved }: { projectId: string; item: ManageProject['nearbyPlaces'][number] | 'new'; onClose: () => void; onSaved: () => void }) {
  const form = useForm<z.input<typeof nearbyForm>>({
    resolver: zodResolver(nearbyForm),
    defaultValues: item === 'new' ? { category: 'SCHOOL', name: '', distanceKm: 1 } : { category: item.category as never, name: item.name, distanceKm: item.distanceKm, travelMinutes: item.travelMinutes },
  });
  const submit = form.handleSubmit(async (v) => {
    try {
      if (item === 'new') await api.post(`/projects/${projectId}/nearby`, v);
      else await api.patch(`/projects/${projectId}/nearby/${item.id}`, v);
      onSaved();
      onClose();
    } catch (err) {
      applyServerErrors(form, err);
    }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={item === 'new' ? 'Add nearby place' : 'Edit nearby place'} description="Use real places and approximate road distances.">
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Category" htmlFor="cat">
            <Select id="cat" {...form.register('category')}>
              {NEARBY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {enumLabel(c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Name" htmlFor="nm" required error={form.formState.errors.name?.message}>
            <Input id="nm" {...form.register('name')} />
          </Field>
          <Field label="Distance" htmlFor="dk" required error={form.formState.errors.distanceKm?.message}>
            <Input id="dk" type="number" step="0.1" trailing={<span className="text-xs">km</span>} {...form.register('distanceKm')} />
          </Field>
          <Field label="Travel time" htmlFor="tm" error={form.formState.errors.travelMinutes?.message}>
            <Input id="tm" type="number" trailing={<span className="text-xs">min</span>} {...form.register('travelMinutes', { setValueAs: (v) => (v === '' ? null : Number(v)) })} />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Construction updates ─────────────

const updateForm = constructionUpdateSchema.omit({ imageUrls: true });

function UpdateDialog({ projectId, item, onClose, onSaved }: { projectId: string; item: ManageProject['constructionUpdates'][number] | 'new'; onClose: () => void; onSaved: () => void }) {
  const form = useForm<z.input<typeof updateForm>>({
    resolver: zodResolver(updateForm),
    defaultValues:
      item === 'new'
        ? { title: '', description: '', updateDate: localDateString(new Date()) }
        : { title: item.title, description: item.description ?? '', progressPercent: item.progressPercent, updateDate: item.updateDate.slice(0, 10) },
  });
  const submit = form.handleSubmit(async (v) => {
    try {
      if (item === 'new') await api.post(`/projects/${projectId}/construction-updates`, v);
      else await api.patch(`/projects/${projectId}/construction-updates/${item.id}`, v);
      onSaved();
      onClose();
    } catch (err) {
      applyServerErrors(form, err);
    }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={item === 'new' ? 'Add construction update' : 'Edit construction update'}>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Title" htmlFor="ut" required className="sm:col-span-2" error={form.formState.errors.title?.message}>
            <Input id="ut" {...form.register('title')} />
          </Field>
          <Field label="Date" htmlFor="ud" required error={form.formState.errors.updateDate?.message}>
            <Input id="ud" type="date" {...form.register('updateDate')} />
          </Field>
          <Field label="Overall progress" htmlFor="up" error={form.formState.errors.progressPercent?.message}>
            <Input id="up" type="number" min={0} max={100} trailing={<span className="text-xs">%</span>} {...form.register('progressPercent', { setValueAs: (v) => (v === '' ? null : Number(v)) })} />
          </Field>
          <Field label="Details" htmlFor="udesc" className="sm:col-span-2">
            <Textarea id="udesc" rows={4} {...form.register('description', { setValueAs: (v) => v || null })} />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ContentTab({ project, onChanged }: { project: ManageProject; onChanged: () => void }) {
  const canEdit = project.permissions.canEdit;
  const [faq, setFaq] = React.useState<ManageProject['faqs'][number] | 'new' | null>(null);
  const [nearby, setNearby] = React.useState<ManageProject['nearbyPlaces'][number] | 'new' | null>(null);
  const [update, setUpdate] = React.useState<ManageProject['constructionUpdates'][number] | 'new' | null>(null);
  const [confirm, setConfirm] = React.useState<{ kind: Kind; id: string; label: string } | null>(null);
  const removeFaq = useRemove(project.id, 'faqs', onChanged);
  const removeNearby = useRemove(project.id, 'nearby', onChanged);
  const removeUpdate = useRemove(project.id, 'construction-updates', onChanged);
  const remover = { faqs: removeFaq, nearby: removeNearby, 'construction-updates': removeUpdate };

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card className="xl:col-span-2">
        <CardHeader
          title="Frequently asked questions"
          description="Shown in the FAQ section of the project page."
          actions={
            canEdit ? (
              <Button size="sm" variant="outline" onClick={() => setFaq('new')}>
                <Plus /> Add FAQ
              </Button>
            ) : null
          }
        />
        {project.faqs.length ? (
          <ul className="divide-y divide-line">
            {project.faqs.map((f) => (
              <li key={f.id} className="flex items-start gap-4 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink-900">{f.question}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-ink-600">{f.answer}</p>
                </div>
                <RowActions canEdit={canEdit} onEdit={() => setFaq(f)} onDelete={() => setConfirm({ kind: 'faqs', id: f.id, label: 'this FAQ' })} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<HelpCircle />} title="No FAQs yet" description="Answer the questions buyers ask most — booking process, approvals, possession." />
        )}
      </Card>

      <Card>
        <CardHeader
          title="Nearby places"
          actions={
            canEdit ? (
              <Button size="sm" variant="outline" onClick={() => setNearby('new')}>
                <Plus /> Add
              </Button>
            ) : null
          }
        />
        {project.nearbyPlaces.length ? (
          <ul className="divide-y divide-line">
            {project.nearbyPlaces.map((n) => (
              <li key={n.id} className="flex items-center gap-3 px-5 py-3">
                <MapPin className="size-4 shrink-0 text-ink-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-900">{n.name}</p>
                  <p className="text-xs text-ink-500">
                    {enumLabel(n.category)} · {n.distanceKm} km{n.travelMinutes ? ` · ${n.travelMinutes} min` : ''}
                  </p>
                </div>
                <RowActions canEdit={canEdit} onEdit={() => setNearby(n)} onDelete={() => setConfirm({ kind: 'nearby', id: n.id, label: n.name })} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<MapPin />} title="No nearby places" description="Add schools, hospitals, transport and markets around the project." />
        )}
      </Card>

      <Card>
        <CardHeader
          title="Construction updates"
          actions={
            canEdit ? (
              <Button size="sm" variant="outline" onClick={() => setUpdate('new')}>
                <Plus /> Add
              </Button>
            ) : null
          }
        />
        {project.constructionUpdates.length ? (
          <ul className="divide-y divide-line">
            {project.constructionUpdates.map((u) => (
              <li key={u.id} className="flex items-start gap-3 px-5 py-3">
                <Wrench className="mt-0.5 size-4 shrink-0 text-ink-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink-900">{u.title}</p>
                  <p className="text-xs text-ink-500">
                    {formatDate(u.updateDate)}
                    {u.progressPercent != null ? ` · ${u.progressPercent}% complete` : ''}
                  </p>
                  {u.description ? <p className="mt-1 line-clamp-2 text-sm text-ink-600">{u.description}</p> : null}
                </div>
                <RowActions canEdit={canEdit} onEdit={() => setUpdate(u)} onDelete={() => setConfirm({ kind: 'construction-updates', id: u.id, label: u.title })} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<Wrench />} title="No construction updates" description="Post progress as work happens on site." />
        )}
      </Card>

      {faq ? <FaqDialog projectId={project.id} item={faq} onClose={() => setFaq(null)} onSaved={onChanged} /> : null}
      {nearby ? <NearbyDialog projectId={project.id} item={nearby} onClose={() => setNearby(null)} onSaved={onChanged} /> : null}
      {update ? <UpdateDialog projectId={project.id} item={update} onClose={() => setUpdate(null)} onSaved={onChanged} /> : null}
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        tone="danger"
        title="Delete this item?"
        description={confirm ? `“${confirm.label}” will be removed from the project page.` : undefined}
        confirmLabel="Delete"
        loading={confirm ? remover[confirm.kind].isPending : false}
        onConfirm={() => confirm && remover[confirm.kind].mutate(confirm.id, { onSuccess: () => setConfirm(null) })}
      />
    </div>
  );
}
