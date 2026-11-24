'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, ExternalLink, History, LayoutTemplate, Plus, Trash2, X } from 'lucide-react';
import { CTA_ACTIONS, defaultSectionData, enumLabel, formatDateTime, newSectionId, pageSectionsSchema, SECTION_LABELS, SECTION_TYPES, type PageSection, type SectionType } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  cn,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  Switch,
  Textarea,
  toast,
} from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { SingleImageField } from './single-image-field';
import type { ManageProject, PageState } from './types';

type ItemField = { key: string; label: string; kind: 'text' | 'textarea'; max: number; required?: boolean };
type FieldSpec =
  | { key: string; label: string; kind: 'text' | 'textarea'; max: number; hint?: string; placeholder?: string; required?: boolean }
  | { key: string; label: string; kind: 'number'; min: number; max: number; hint?: string }
  | { key: string; label: string; kind: 'bool'; hint?: string }
  | { key: string; label: string; kind: 'select'; options: readonly string[] }
  | { key: string; label: string; kind: 'image'; hint?: string }
  | { key: string; label: string; kind: 'strings'; max: number; itemMax: number; placeholder?: string }
  | { key: string; label: string; kind: 'items'; max: number; fields: ItemField[]; itemLabel: string };

const heading = (fallback: string): FieldSpec => ({ key: 'heading', label: 'Heading', kind: 'text', max: 120, placeholder: fallback });

const SPECS: Record<SectionType, FieldSpec[]> = {
  HERO: [
    { key: 'headline', label: 'Headline', kind: 'text', max: 120, placeholder: 'Defaults to the project name' },
    { key: 'subheadline', label: 'Sub-headline', kind: 'textarea', max: 240 },
    { key: 'imageUrl', label: 'Background image', kind: 'image', hint: 'Defaults to the project hero image' },
    { key: 'ctaLabel', label: 'Button label', kind: 'text', max: 40 },
    { key: 'ctaAction', label: 'Button action', kind: 'select', options: CTA_ACTIONS },
    { key: 'showPrice', label: 'Show price range', kind: 'bool' },
    { key: 'showStatus', label: 'Show booking status', kind: 'bool' },
  ],
  OVERVIEW: [heading('Project overview'), { key: 'body', label: 'Text', kind: 'textarea', max: 6000, hint: 'Leave empty to use the project description' }, { key: 'highlights', label: 'Highlights', kind: 'strings', max: 12, itemMax: 160, placeholder: 'e.g. 40 ft wide internal roads' }],
  STATS: [heading('Key facts'), { key: 'items', label: 'Facts', kind: 'items', max: 8, itemLabel: 'fact', fields: [{ key: 'label', label: 'Label', kind: 'text', max: 60, required: true }, { key: 'value', label: 'Value', kind: 'text', max: 40, required: true }] }],
  GALLERY: [heading('Gallery'), { key: 'limit', label: 'Photos to show', kind: 'number', min: 1, max: 60 }],
  MASTER_PLAN: [heading('Master plan'), { key: 'description', label: 'Description', kind: 'textarea', max: 2000 }],
  INVENTORY: [heading('Available inventory'), { key: 'showPrices', label: 'Show prices of available units', kind: 'bool' }, { key: 'showUnavailable', label: 'Show booked and sold units', kind: 'bool' }],
  AMENITIES: [heading('Amenities')],
  MAP: [heading('Location'), { key: 'zoom', label: 'Map zoom', kind: 'number', min: 8, max: 19, hint: '8 = region, 19 = street' }],
  NEARBY: [heading('Nearby')],
  DEVELOPER: [heading('About the developer')],
  DOCUMENTS: [heading('Approvals & documents')],
  CONSTRUCTION_UPDATES: [heading('Construction updates')],
  FAQ: [heading('Frequently asked questions')],
  TESTIMONIALS: [
    heading('What buyers say'),
    { key: 'items', label: 'Testimonials', kind: 'items', max: 12, itemLabel: 'testimonial', fields: [{ key: 'name', label: 'Name', kind: 'text', max: 80, required: true }, { key: 'detail', label: 'Detail (e.g. “Plot owner, Sector A”)', kind: 'text', max: 80 }, { key: 'text', label: 'Quote', kind: 'textarea', max: 800, required: true }] },
  ],
  CONTACT: [heading('Talk to our sales team'), { key: 'body', label: 'Intro text', kind: 'textarea', max: 600 }, { key: 'showSiteVisit', label: 'Offer site-visit booking', kind: 'bool' }, { key: 'showCallback', label: 'Offer callback request', kind: 'bool' }],
  CTA: [
    { key: 'heading', label: 'Heading', kind: 'text', max: 120, required: true },
    { key: 'body', label: 'Text', kind: 'textarea', max: 400 },
    { key: 'buttonLabel', label: 'Button label', kind: 'text', max: 40 },
    { key: 'action', label: 'Button action', kind: 'select', options: CTA_ACTIONS },
  ],
};

const SINGLE = new Set<SectionType>(['HERO']);

function sectionSummary(s: PageSection): string {
  const d = s.data as Record<string, unknown>;
  const text = (d.heading ?? d.headline ?? '') as string;
  return text || SECTION_LABELS[s.type];
}

function SectionEditor({ section, onChange, organizationId, disabled }: { section: PageSection; onChange: (data: Record<string, unknown>) => void; organizationId: string; disabled: boolean }) {
  const data = section.data as Record<string, unknown>;
  const set = (key: string, value: unknown) => {
    const next = { ...data };
    if (value === '' || value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  };
  return (
    <div className="grid gap-5">
      {SPECS[section.type].map((f) => {
        const id = `${section.id}-${f.key}`;
        switch (f.kind) {
          case 'text':
          case 'textarea':
            return (
              <Field key={f.key} label={f.label} htmlFor={id} required={f.required} hint={'hint' in f ? f.hint : undefined}>
                {f.kind === 'text' ? (
                  <Input id={id} maxLength={f.max} placeholder={f.placeholder} disabled={disabled} value={(data[f.key] as string) ?? ''} onChange={(e) => set(f.key, e.target.value)} />
                ) : (
                  <Textarea id={id} rows={f.max > 1000 ? 8 : 3} maxLength={f.max} disabled={disabled} value={(data[f.key] as string) ?? ''} onChange={(e) => set(f.key, e.target.value)} />
                )}
              </Field>
            );
          case 'number':
            return (
              <Field key={f.key} label={f.label} htmlFor={id} hint={f.hint}>
                <Input id={id} type="number" min={f.min} max={f.max} disabled={disabled} value={(data[f.key] as number | undefined) ?? ''} onChange={(e) => set(f.key, e.target.value === '' ? undefined : Number(e.target.value))} />
              </Field>
            );
          case 'bool':
            return (
              <div key={f.key} className="flex items-center gap-3">
                <Switch id={id} checked={Boolean(data[f.key])} disabled={disabled} onCheckedChange={(v) => set(f.key, v)} />
                <label htmlFor={id} className="text-sm text-ink-800">
                  {f.label}
                </label>
              </div>
            );
          case 'select':
            return (
              <Field key={f.key} label={f.label} htmlFor={id}>
                <Select id={id} disabled={disabled} value={(data[f.key] as string) ?? f.options[0]} onChange={(e) => set(f.key, e.target.value)}>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {enumLabel(o)}
                    </option>
                  ))}
                </Select>
              </Field>
            );
          case 'image':
            return (
              <Field key={f.key} label={f.label} hint={f.hint}>
                <SingleImageField value={(data[f.key] as string) || null} onChange={(url) => set(f.key, url ?? '')} organizationId={organizationId} disabled={disabled} />
              </Field>
            );
          case 'strings': {
            const list = ((data[f.key] as string[]) ?? []).slice();
            return (
              <Field key={f.key} label={f.label} hint={`Up to ${f.max}`}>
                <div className="grid gap-2">
                  {list.map((v, i) => (
                    <div key={i} className="flex gap-2">
                      <Input value={v} maxLength={f.itemMax} disabled={disabled} placeholder={f.placeholder} onChange={(e) => set(f.key, list.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`${f.label} ${i + 1}`} />
                      <Button size="icon" variant="ghost" disabled={disabled} aria-label="Remove" onClick={() => set(f.key, list.filter((_, j) => j !== i))}>
                        <X />
                      </Button>
                    </div>
                  ))}
                  {list.length < f.max ? (
                    <Button size="sm" variant="outline" className="w-fit" disabled={disabled} onClick={() => set(f.key, [...list, ''])}>
                      <Plus /> Add
                    </Button>
                  ) : null}
                </div>
              </Field>
            );
          }
          case 'items': {
            const list = ((data[f.key] as Record<string, string>[]) ?? []).slice();
            return (
              <Field key={f.key} label={f.label} hint={`Up to ${f.max}`}>
                <div className="grid gap-3">
                  {list.map((item, i) => (
                    <div key={i} className="grid gap-3 rounded-lg border border-line p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium uppercase tracking-wide text-ink-500">
                          {f.itemLabel} {i + 1}
                        </span>
                        <Button size="xs" variant="ghost" disabled={disabled} onClick={() => set(f.key, list.filter((_, j) => j !== i))}>
                          <Trash2 /> Remove
                        </Button>
                      </div>
                      {f.fields.map((sub) =>
                        sub.kind === 'text' ? (
                          <Input key={sub.key} placeholder={sub.label} maxLength={sub.max} disabled={disabled} value={item[sub.key] ?? ''} onChange={(e) => set(f.key, list.map((x, j) => (j === i ? { ...x, [sub.key]: e.target.value } : x)))} aria-label={sub.label} />
                        ) : (
                          <Textarea key={sub.key} placeholder={sub.label} rows={3} maxLength={sub.max} disabled={disabled} value={item[sub.key] ?? ''} onChange={(e) => set(f.key, list.map((x, j) => (j === i ? { ...x, [sub.key]: e.target.value } : x)))} aria-label={sub.label} />
                        ),
                      )}
                    </div>
                  ))}
                  {list.length < f.max ? (
                    <Button size="sm" variant="outline" className="w-fit" disabled={disabled} onClick={() => set(f.key, [...list, Object.fromEntries(f.fields.filter((x) => x.required).map((x) => [x.key, '']))])}>
                      <Plus /> Add {f.itemLabel}
                    </Button>
                  ) : null}
                </div>
              </Field>
            );
          }
          default:
            return null;
        }
      })}
      {section.type === 'TESTIMONIALS' ? <Alert tone="warning">Only publish testimonials you have permission to use from real buyers.</Alert> : null}
      {['AMENITIES', 'NEARBY', 'DEVELOPER', 'DOCUMENTS', 'CONSTRUCTION_UPDATES', 'FAQ', 'GALLERY', 'INVENTORY', 'MAP', 'MASTER_PLAN'].includes(section.type) ? (
        <p className="text-[12.5px] text-ink-500">This section shows live project data (amenities, inventory, documents, FAQs…) managed in the other tabs.</p>
      ) : null}
    </div>
  );
}

interface Revision {
  id: string;
  revision: number;
  createdAt: string;
  publishedBy: { fullName: string } | null;
}

export function PageBuilderTab({ project }: { project: ManageProject }) {
  const page = useApi<PageState>(`/projects/${project.id}/page`);
  const [sections, setSections] = React.useState<PageSection[] | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [issues, setIssues] = React.useState<string[]>([]);
  const [showRevisions, setShowRevisions] = React.useState(false);
  const [confirmPublish, setConfirmPublish] = React.useState(false);
  const canEdit = project.permissions.canManagePage;

  React.useEffect(() => {
    if (page.data && sections === null) {
      setSections(page.data.draftSections);
      setSelected(page.data.draftSections[0]?.id ?? null);
    }
  }, [page.data, sections]);

  const dirty = page.data && sections ? JSON.stringify(sections) !== JSON.stringify(page.data.draftSections) : false;
  const validate = (list: PageSection[]): boolean => {
    const r = pageSectionsSchema.safeParse(list);
    if (r.success) {
      setIssues([]);
      return true;
    }
    setIssues(
      r.error.issues.map((i) => {
        const idx = typeof i.path[0] === 'number' ? i.path[0] : -1;
        const s = idx >= 0 ? list[idx] : null;
        return `${s ? SECTION_LABELS[s.type] : 'Page'}${i.path.length > 2 ? ` › ${String(i.path.slice(2).join(' › '))}` : ''}: ${i.message}`;
      }),
    );
    return false;
  };

  const save = useApiMutation((list: PageSection[]) => api.put<PageState>(`/projects/${project.id}/page/draft`, { sections: list }), {
    success: 'Draft saved',
    invalidate: [`/projects/${project.id}/page`],
    onSuccess: (r) => setSections(r.draftSections),
  });
  const publish = useApiMutation(() => api.post<PageState>(`/projects/${project.id}/page/publish`), {
    success: (r) => `Published revision ${r.revision}`,
    invalidate: [`/projects/${project.id}/page`, '/projects'],
    onSuccess: () => setConfirmPublish(false),
  });
  const preview = useApiMutation(() => api.post<{ url: string }>(`/projects/${project.id}/page/preview-token`), {
    onSuccess: (r) => window.open(r.url, '_blank', 'noopener,noreferrer'),
  });
  const revisions = useApi<(Revision & { sections: PageSection[] })[]>(showRevisions ? `/projects/${project.id}/page/revisions` : null);
  const restore = useApiMutation((rev: number) => api.post<PageState>(`/projects/${project.id}/page/revisions/${rev}/restore`), {
    success: 'Revision restored to the draft — review and publish when ready',
    invalidate: [`/projects/${project.id}/page`],
    onSuccess: (r) => {
      setSections(r.draftSections);
      setShowRevisions(false);
    },
  });

  if (page.isLoading || !sections || !page.data) return <Skeleton className="h-96" />;
  const current = sections.find((s) => s.id === selected) ?? null;

  const update = (id: string, patch: Partial<PageSection>) => setSections(sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[index], next[j]] = [next[j], next[index]];
    setSections(next);
  };
  const add = (type: SectionType) => {
    const section: PageSection = { id: newSectionId(), type, visible: true, data: defaultSectionData(type) as Record<string, unknown> };
    setSections([...sections, section]);
    setSelected(section.id);
  };

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <LayoutTemplate className="size-4 text-ink-400" />
            {page.data.publishedAt ? (
              <span className="text-ink-700">
                Live revision <strong className="tabular">{page.data.revision}</strong> · published {formatDateTime(page.data.publishedAt)}
              </span>
            ) : (
              <span className="text-ink-700">Not published yet — the live page uses the default layout.</span>
            )}
            {dirty ? <Badge tone="warning">Unsaved edits</Badge> : page.data.hasUnpublishedChanges ? <Badge tone="info">Draft differs from live page</Badge> : <Badge tone="success">Live page is up to date</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowRevisions(true)}>
              <History /> Revisions
            </Button>
            <Button size="sm" variant="outline" loading={preview.isPending} disabled={!canEdit || dirty} title={dirty ? 'Save the draft first' : undefined} onClick={() => preview.mutate(undefined)}>
              <ExternalLink /> Preview draft
            </Button>
            {canEdit ? (
              <Button size="sm" variant="outline" disabled={!dirty} loading={save.isPending} onClick={() => validate(sections) && save.mutate(sections)}>
                Save draft
              </Button>
            ) : null}
            {page.data.canPublish ? (
              <Button size="sm" disabled={dirty || !page.data.hasUnpublishedChanges} onClick={() => setConfirmPublish(true)}>
                Publish page
              </Button>
            ) : canEdit ? (
              <span className="self-center text-xs text-ink-500">A reviewer publishes page changes for this organisation.</span>
            ) : null}
          </div>
        </CardBody>
      </Card>

      {issues.length ? (
        <Alert tone="danger" title="Fix these before saving">
          <ul className="list-disc pl-4">
            {issues.slice(0, 8).map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader
            title="Sections"
            description="Order shown on the page"
            actions={
              canEdit ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline">
                      <Plus /> Add
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="max-h-80 overflow-y-auto">
                    {SECTION_TYPES.filter((t) => !(SINGLE.has(t) && sections.some((s) => s.type === t))).map((t) => (
                      <DropdownMenuItem key={t} onSelect={() => add(t)}>
                        {SECTION_LABELS[t]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null
            }
          />
          {sections.length ? (
            <ol className="divide-y divide-line">
              {sections.map((s, i) => (
                <li key={s.id} className={cn('flex items-center gap-2 px-3 py-2.5', selected === s.id && 'bg-brand-soft')}>
                  <span className="w-5 text-center text-xs text-ink-400 tabular">{i + 1}</span>
                  <button type="button" onClick={() => setSelected(s.id)} className="min-w-0 flex-1 text-left">
                    <span className={cn('block truncate text-sm font-medium', s.visible ? 'text-ink-900' : 'text-ink-400 line-through')}>{SECTION_LABELS[s.type]}</span>
                    <span className="block truncate text-xs text-ink-500">{sectionSummary(s)}</span>
                  </button>
                  {canEdit ? (
                    <div className="flex shrink-0">
                      <Button size="icon-sm" variant="ghost" aria-label={s.visible ? 'Hide section' : 'Show section'} title={s.visible ? 'Hide' : 'Show'} onClick={() => update(s.id, { visible: !s.visible })}>
                        {s.visible ? <Eye /> : <EyeOff />}
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={i === sections.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown />
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="No sections" description="Add sections to build the page." />
          )}
        </Card>

        <Card>
          {current ? (
            <>
              <CardHeader
                title={SECTION_LABELS[current.type]}
                description={current.visible ? 'Visible on the page' : 'Hidden — not shown on the page'}
                actions={
                  canEdit ? (
                    <Button
                      size="sm"
                      variant="destructive-outline"
                      onClick={() => {
                        const next = sections.filter((s) => s.id !== current.id);
                        setSections(next);
                        setSelected(next[0]?.id ?? null);
                      }}
                    >
                      <Trash2 /> Remove section
                    </Button>
                  ) : null
                }
              />
              <CardBody>
                <SectionEditor key={current.id} section={current} onChange={(data) => update(current.id, { data })} organizationId={project.organizationId} disabled={!canEdit} />
              </CardBody>
            </>
          ) : (
            <EmptyState icon={<LayoutTemplate />} title="Select a section" description="Choose a section on the left to edit its content." />
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={confirmPublish}
        onOpenChange={setConfirmPublish}
        title="Publish this page?"
        description={`The saved draft becomes the live project page${project.isPublished ? ' immediately' : ' once the project is published'}. The current live version is kept in revisions.`}
        confirmLabel="Publish"
        loading={publish.isPending}
        onConfirm={() => publish.mutate(undefined)}
      />

      <Dialog open={showRevisions} onOpenChange={setShowRevisions}>
        <DialogContent title="Published revisions" description="Restoring copies a revision into the draft; nothing goes live until you publish." size="lg">
          {revisions.isLoading ? (
            <Skeleton className="h-40" />
          ) : revisions.isError ? (
            <Alert tone="danger">{errorMessage(revisions.error)}</Alert>
          ) : revisions.data?.length ? (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {revisions.data.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-ink-900">Revision {r.revision}</p>
                    <p className="text-xs text-ink-500">
                      {formatDateTime(r.createdAt)} · {r.publishedBy?.fullName ?? '—'} · {r.sections.length} sections
                    </p>
                  </div>
                  {canEdit ? (
                    <Button
                      size="xs"
                      variant="outline"
                      loading={restore.isPending}
                      onClick={() => {
                        if (dirty) toast.warning('Your unsaved edits will be replaced by this revision.');
                        restore.mutate(r.revision);
                      }}
                    >
                      Restore to draft
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-500">No revisions published yet.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
