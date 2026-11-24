'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, ImageIcon, LayoutTemplate, Pencil, Plus, Trash2 } from 'lucide-react';
import { bannerSchema, enumLabel, formatDateTime, HOME_SECTION_TYPES, type HomeSectionType } from '@estate/shared';
import { ApiError, errorMessage } from '@estate/api-client';
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, Dialog, DialogContent, DialogFooter, Field, Input, PageHeader, Select, Switch, Textarea } from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { QueryState } from '@/components/query-state';
import { ImageInput } from '@/components/cms/image-input';

interface Section {
  id: string;
  type: HomeSectionType;
  title: string | null;
  subtitle: string | null;
  isVisible: boolean;
  sortOrder: number;
  config: { limit?: number; points?: { title: string; text: string }[] };
}
interface Banner {
  id: string;
  placement: 'HOME_HERO' | 'SEARCH_TOP' | 'PROJECTS_TOP';
  title: string;
  subtitle: string | null;
  imageUrl: string;
  linkUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

/** What each section shows on the website (and whether it takes an item limit). */
const SECTION_INFO: Record<HomeSectionType, { label: string; help: string; hasLimit?: boolean }> = {
  HERO_SEARCH: { label: 'Hero & search', help: 'Top banner with the property search box and live counts. Uses the first active hero banner.' },
  FEATURED_PROPERTIES: { label: 'Featured properties', help: 'Featured listings in the default city (falls back to popular listings).', hasLimit: true },
  POPULAR_LOCALITIES: { label: 'Popular localities', help: 'Localities marked popular, with live listing counts.', hasLimit: true },
  FEATURED_PROJECTS: { label: 'Projects', help: 'Published projects from verified developers.', hasLimit: true },
  RESIDENTIAL_PLOTS: { label: 'Residential plots', help: 'Live plot listings.', hasLimit: true },
  COMMERCIAL: { label: 'Commercial', help: 'Live commercial listings.', hasLimit: true },
  RECENT_LISTINGS: { label: 'Recently added', help: 'Newest live listings.', hasLimit: true },
  VERIFIED_BROKERS: { label: 'Verified brokers', help: 'Verified brokerages with live listings.', hasLimit: true },
  WHY_CHOOSE_US: { label: 'Why choose us', help: 'Up to six points you write. Hidden on the website while it has no points.' },
  ENQUIRY_CTA: { label: 'Enquiry form', help: 'A general enquiry form that creates a lead in the CRM.' },
};

const PLACEMENTS: { value: Banner['placement']; label: string; shown: boolean }[] = [
  { value: 'HOME_HERO', label: 'Homepage hero', shown: true },
  { value: 'SEARCH_TOP', label: 'Top of search results', shown: false },
  { value: 'PROJECTS_TOP', label: 'Top of projects page', shown: false },
];

export default function CmsHomePage() {
  return (
    <>
      <PageHeader title="Homepage & banners" description="Choose which sections appear on the website homepage, in what order, and manage banner images." />
      <div className="grid gap-6">
        <SectionsCard />
        <BannersCard />
      </div>
    </>
  );
}

// ───────────────────────── Sections ─────────────────────────

function SectionsCard() {
  const q = useApi<Section[]>('/cms/home-sections');
  const [editing, setEditing] = React.useState<Section | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [removing, setRemoving] = React.useState<Section | null>(null);
  const reorder = useApiMutation((ids: string[]) => api.put('/cms/home-sections/order', { ids }), { success: 'Order saved', invalidate: ['/cms/home-sections'] });
  const toggle = useApiMutation((v: { id: string; isVisible: boolean }) => api.patch(`/cms/home-sections/${v.id}`, { isVisible: v.isVisible }), {
    success: (r) => ((r as Section).isVisible ? 'Section shown on the homepage' : 'Section hidden from the homepage'),
    invalidate: ['/cms/home-sections'],
  });
  const remove = useApiMutation((id: string) => api.delete(`/cms/home-sections/${id}`), { success: 'Section removed', invalidate: ['/cms/home-sections'], onSuccess: () => setRemoving(null) });
  const missing = HOME_SECTION_TYPES.filter((t) => !(q.data ?? []).some((s) => s.type === t));
  const move = (rows: Section[], i: number, d: -1 | 1) => {
    const ids = rows.map((r) => r.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    reorder.mutate(ids);
  };
  return (
    <Card>
      <CardHeader
        title="Homepage sections"
        description="Top to bottom, as they appear on the website. Changes go live within about a minute."
        actions={
          missing.length ? (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus /> Add section
            </Button>
          ) : null
        }
      />
      <QueryState query={q} isEmpty={(d) => d.length === 0} empty={{ icon: <LayoutTemplate />, title: 'No sections', description: 'Add sections to build the homepage.' }}>
        {(rows) => (
          <ol className="divide-y divide-line">
            {rows.map((s, i) => {
              const info = SECTION_INFO[s.type];
              const emptyWhy = s.type === 'WHY_CHOOSE_US' && !(s.config.points ?? []).length;
              return (
                <li key={s.id} className={`flex flex-wrap items-center gap-3 px-5 py-3 ${s.isVisible ? '' : 'bg-ink-50/70'}`}>
                  <span className="tabular w-6 text-sm text-ink-400">{i + 1}</span>
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`font-medium ${s.isVisible ? 'text-ink-900' : 'text-ink-500'}`}>{s.title || info?.label || enumLabel(s.type)}</span>
                      {s.title ? <span className="text-xs text-ink-400">{info?.label}</span> : null}
                      {!s.isVisible ? <Badge size="sm">Hidden</Badge> : null}
                      {emptyWhy && s.isVisible ? <Badge size="sm" tone="warning">No points — not shown</Badge> : null}
                      {info?.hasLimit ? <span className="text-xs text-ink-400">· up to {s.config.limit ?? 8} items</span> : null}
                    </div>
                    <p className="text-xs text-ink-500">{info?.help}</p>
                  </div>
                  <div className="ml-auto flex items-center gap-1">
                    <Button size="icon-sm" variant="ghost" aria-label={`Move ${info?.label} up`} disabled={i === 0 || reorder.isPending} onClick={() => move(rows, i, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label={`Move ${info?.label} down`} disabled={i === rows.length - 1 || reorder.isPending} onClick={() => move(rows, i, 1)}>
                      <ArrowDown />
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label={s.isVisible ? `Hide ${info?.label}` : `Show ${info?.label}`} onClick={() => toggle.mutate({ id: s.id, isVisible: !s.isVisible })}>
                      {s.isVisible ? <Eye /> : <EyeOff />}
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label={`Edit ${info?.label}`} onClick={() => setEditing(s)}>
                      <Pencil />
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label={`Remove ${info?.label}`} onClick={() => setRemoving(s)}>
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </QueryState>
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        {editing ? <SectionForm section={editing} onDone={() => setEditing(null)} /> : null}
      </Dialog>
      <Dialog open={adding} onOpenChange={setAdding}>
        {adding ? <AddSection types={missing} onDone={() => setAdding(false)} /> : null}
      </Dialog>
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this section?"
        description="It disappears from the homepage. You can add it back later (its custom title and settings will be lost). To keep its settings, hide it instead."
        confirmLabel="Remove"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id);
        }}
      />
    </Card>
  );
}

function AddSection({ types, onDone }: { types: HomeSectionType[]; onDone: () => void }) {
  const [type, setType] = React.useState<HomeSectionType>(types[0]);
  const add = useApiMutation(() => api.post('/cms/home-sections', { type, isVisible: true, config: {} }), { success: 'Section added at the bottom of the homepage', invalidate: ['/cms/home-sections'], onSuccess: onDone });
  return (
    <DialogContent title="Add a homepage section">
      <Field label="Section" htmlFor="as-type" hint={SECTION_INFO[type]?.help}>
        <Select id="as-type" value={type} onChange={(e) => setType(e.target.value as HomeSectionType)}>
          {types.map((t) => (
            <option key={t} value={t}>
              {SECTION_INFO[t]?.label ?? enumLabel(t)}
            </option>
          ))}
        </Select>
      </Field>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button loading={add.isPending} onClick={() => add.mutate(undefined)}>
          Add section
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function SectionForm({ section, onDone }: { section: Section; onDone: () => void }) {
  const info = SECTION_INFO[section.type];
  const [title, setTitle] = React.useState(section.title ?? '');
  const [subtitle, setSubtitle] = React.useState(section.subtitle ?? '');
  const [limit, setLimit] = React.useState(String(section.config.limit ?? ''));
  const [points, setPoints] = React.useState(section.config.points ?? []);
  const [error, setError] = React.useState<string | null>(null);
  const save = useApiMutation(
    () =>
      api.patch(`/cms/home-sections/${section.id}`, {
        title: title.trim() || null,
        subtitle: subtitle.trim() || null,
        config: {
          ...(info?.hasLimit && limit ? { limit: Number(limit) } : {}),
          ...(section.type === 'WHY_CHOOSE_US' ? { points: points.map((p) => ({ title: p.title.trim(), text: p.text.trim() })) } : {}),
        },
      }),
    { success: 'Section saved', invalidate: ['/cms/home-sections'], onSuccess: onDone, onError: (e) => setError(errorMessage(e)), silent: true },
  );
  return (
    <DialogContent title={`Edit: ${info?.label ?? section.type}`} description={info?.help} size={section.type === 'WHY_CHOOSE_US' ? 'lg' : undefined}>
      {error ? <Alert tone="danger" className="mb-4">{error}</Alert> : null}
      <div className="grid gap-4">
        <Field label="Heading" htmlFor="sf-title" hint="Leave empty to use the website's default heading.">
          <Input id="sf-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Sub-heading" htmlFor="sf-sub">
          <Input id="sf-sub" value={subtitle} maxLength={300} onChange={(e) => setSubtitle(e.target.value)} />
        </Field>
        {info?.hasLimit ? (
          <Field label="Number of items" htmlFor="sf-limit" hint="1–24. Default 8.">
            <Input id="sf-limit" type="number" min={1} max={24} className="w-32" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </Field>
        ) : null}
        {section.type === 'WHY_CHOOSE_US' ? (
          <div className="grid gap-3">
            <p className="text-sm font-medium text-ink-800">Points ({points.length}/6)</p>
            {points.map((p, i) => (
              <div key={i} className="grid gap-2 rounded-lg border border-line p-3">
                <div className="flex gap-2">
                  <Input aria-label={`Point ${i + 1} title`} placeholder="Title" value={p.title} maxLength={80} onChange={(e) => setPoints(points.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove point ${i + 1}`} onClick={() => setPoints(points.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </Button>
                </div>
                <Textarea aria-label={`Point ${i + 1} text`} placeholder="Explain in a sentence or two" rows={2} value={p.text} maxLength={300} onChange={(e) => setPoints(points.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              </div>
            ))}
            {points.length < 6 ? (
              <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => setPoints([...points, { title: '', text: '' }])}>
                <Plus /> Add point
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button loading={save.isPending} disabled={points.some((p) => p.title.trim().length < 2 || p.text.trim().length < 2)} onClick={() => save.mutate(undefined)}>
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ───────────────────────── Banners ─────────────────────────

function BannersCard() {
  const q = useApi<Banner[]>('/cms/banners');
  const [editing, setEditing] = React.useState<Banner | 'new' | null>(null);
  const [removing, setRemoving] = React.useState<Banner | null>(null);
  const remove = useApiMutation((id: string) => api.delete(`/cms/banners/${id}`), { success: 'Banner deleted', invalidate: ['/cms/banners'], onSuccess: () => setRemoving(null) });
  const now = Date.now();
  return (
    <Card>
      <CardHeader
        title="Banners"
        description="The first active homepage-hero banner (lowest order number) replaces the homepage hero image, headline and sub-headline."
        actions={
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            <Plus /> New banner
          </Button>
        }
      />
      <QueryState query={q} isEmpty={(d) => d.length === 0} empty={{ icon: <ImageIcon />, title: 'No banners', description: 'Without a banner the homepage uses its default hero image and headline.' }}>
        {(rows) => (
          <ul className="divide-y divide-line">
            {rows.map((b) => {
              const placement = PLACEMENTS.find((p) => p.value === b.placement);
              const scheduled = b.startsAt && new Date(b.startsAt).getTime() > now;
              const expired = b.endsAt && new Date(b.endsAt).getTime() <= now;
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={b.imageUrl} alt="" className="h-14 w-24 shrink-0 rounded-md border border-line object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink-900">{b.title}</span>
                      {!b.isActive ? <Badge size="sm">Off</Badge> : expired ? <Badge size="sm">Ended</Badge> : scheduled ? <Badge size="sm" tone="info">Scheduled</Badge> : <Badge size="sm" tone="success">Live</Badge>}
                      {placement && !placement.shown ? <Badge size="sm" tone="warning">Not displayed by the website yet</Badge> : null}
                    </div>
                    <p className="text-xs text-ink-500">
                      {placement?.label ?? b.placement} · order {b.sortOrder}
                      {b.startsAt ? ` · from ${formatDateTime(b.startsAt)}` : ''}
                      {b.endsAt ? ` · until ${formatDateTime(b.endsAt)}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon-sm" variant="ghost" aria-label={`Edit ${b.title}`} onClick={() => setEditing(b)}>
                      <Pencil />
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label={`Delete ${b.title}`} onClick={() => setRemoving(b)}>
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        {editing ? <BannerForm banner={editing === 'new' ? null : editing} onDone={() => setEditing(null)} /> : null}
      </Dialog>
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Delete this banner?"
        description={removing?.title}
        confirmLabel="Delete"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id);
        }}
      />
    </Card>
  );
}

/** datetime-local (browser local time) ⇄ ISO with offset. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

function BannerForm({ banner, onDone }: { banner: Banner | null; onDone: () => void }) {
  const [v, setV] = React.useState({
    placement: banner?.placement ?? 'HOME_HERO',
    title: banner?.title ?? '',
    subtitle: banner?.subtitle ?? '',
    imageUrl: banner?.imageUrl ?? '',
    linkUrl: banner?.linkUrl ?? '',
    sortOrder: String(banner?.sortOrder ?? 0),
    isActive: banner?.isActive ?? true,
    startsAt: toLocalInput(banner?.startsAt ?? null),
    endsAt: toLocalInput(banner?.endsAt ?? null),
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const save = useApiMutation((body: unknown) => (banner ? api.patch(`/cms/banners/${banner.id}`, body) : api.post('/cms/banners', body)), {
    success: banner ? 'Banner saved' : 'Banner created',
    invalidate: ['/cms/banners'],
    onSuccess: onDone,
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors());
      setError(errorMessage(e));
    },
    silent: true,
  });
  const submit = () => {
    setError(null);
    const body = { ...v, subtitle: v.subtitle.trim() || null, linkUrl: v.linkUrl.trim() || null, startsAt: fromLocalInput(v.startsAt), endsAt: fromLocalInput(v.endsAt) };
    const parsed = bannerSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    if (parsed.data.startsAt && parsed.data.endsAt && parsed.data.endsAt <= parsed.data.startsAt) {
      setErrors({ endsAt: 'Must be after the start' });
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };
  const placement = PLACEMENTS.find((p) => p.value === v.placement);
  return (
    <DialogContent title={banner ? 'Edit banner' : 'New banner'} size="lg">
      {error ? <Alert tone="danger" className="mb-4">{error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Image" htmlFor="bn-img" required error={errors.imageUrl} className="sm:col-span-2" hint="Wide landscape photo, at least 1600px across. Uploaded images are optimised automatically.">
          <ImageInput id="bn-img" value={v.imageUrl} onChange={(imageUrl) => setV({ ...v, imageUrl })} invalid={Boolean(errors.imageUrl)} />
        </Field>
        <Field label="Headline" htmlFor="bn-title" required error={errors.title} className="sm:col-span-2">
          <Input id="bn-title" value={v.title} maxLength={120} onChange={(e) => setV({ ...v, title: e.target.value })} />
        </Field>
        <Field label="Sub-headline" htmlFor="bn-sub" error={errors.subtitle} className="sm:col-span-2">
          <Input id="bn-sub" value={v.subtitle} maxLength={240} onChange={(e) => setV({ ...v, subtitle: e.target.value })} />
        </Field>
        <Field label="Placement" htmlFor="bn-place" required hint={placement && !placement.shown ? 'The website does not display this placement yet.' : undefined}>
          <Select id="bn-place" value={v.placement} onChange={(e) => setV({ ...v, placement: e.target.value as Banner['placement'] })}>
            {PLACEMENTS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
                {p.shown ? '' : ' (not displayed yet)'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Order" htmlFor="bn-order" error={errors.sortOrder} hint="Lower numbers come first">
          <Input id="bn-order" type="number" min={0} max={1000} value={v.sortOrder} onChange={(e) => setV({ ...v, sortOrder: e.target.value })} />
        </Field>
        <Field label="Link (optional)" htmlFor="bn-link" error={errors.linkUrl} className="sm:col-span-2">
          <Input id="bn-link" value={v.linkUrl} placeholder="/projects or https://…" onChange={(e) => setV({ ...v, linkUrl: e.target.value })} />
        </Field>
        <Field label="Show from" htmlFor="bn-start" error={errors.startsAt}>
          <Input id="bn-start" type="datetime-local" value={v.startsAt} onChange={(e) => setV({ ...v, startsAt: e.target.value })} />
        </Field>
        <Field label="Show until" htmlFor="bn-end" error={errors.endsAt}>
          <Input id="bn-end" type="datetime-local" value={v.endsAt} onChange={(e) => setV({ ...v, endsAt: e.target.value })} />
        </Field>
        <label className="flex items-center gap-3 text-sm text-ink-800 sm:col-span-2">
          <Switch checked={v.isActive} onCheckedChange={(isActive) => setV({ ...v, isActive })} /> Active
        </label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button loading={save.isPending} onClick={submit}>
          {banner ? 'Save banner' : 'Create banner'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
