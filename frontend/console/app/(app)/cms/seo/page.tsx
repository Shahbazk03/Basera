'use client';

import * as React from 'react';
import { MessageCircleQuestion, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { faqSchema, seoOverrideSchema } from '@estate/shared';
import { ApiError, errorMessage } from '@estate/api-client';
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, Dialog, DialogContent, DialogFooter, Field, Input, PageHeader, Switch, Table, TBody, TD, TH, THead, TR, Textarea } from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation, useListParams } from '@/lib/hooks';
import { StatusTabs } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';
import { ImageInput } from '@/components/cms/image-input';

interface Faq {
  id: string;
  category: string;
  question: string;
  answer: string;
  sortOrder: number;
  isPublished: boolean;
}
interface SeoOverride {
  id: string;
  path: string;
  title: string | null;
  description: string | null;
  canonicalUrl: string | null;
  ogImageUrl: string | null;
  noIndex: boolean;
}

const WEB = process.env.NEXT_PUBLIC_WEB_URL ?? '';

export default function CmsSeoPage() {
  const { values, set } = useListParams<{ tab?: string }>();
  const tab = values.tab === 'seo' ? 'seo' : 'faqs';
  return (
    <>
      <PageHeader title="FAQs & SEO" description="Questions shown on the website FAQ page and in page FAQ blocks, and search-engine overrides for specific website addresses." />
      <Card>
        <StatusTabs
          tabs={[
            { value: undefined, label: 'FAQs' },
            { value: 'seo', label: 'SEO overrides' },
          ]}
          value={tab === 'seo' ? 'seo' : undefined}
          onChange={(v) => set({ tab: v })}
        />
        {tab === 'faqs' ? <FaqsPanel /> : <SeoPanel />}
      </Card>
    </>
  );
}

// ───────────────────────── FAQs ─────────────────────────

function FaqsPanel() {
  const q = useApi<Faq[]>('/cms/faqs');
  const [editing, setEditing] = React.useState<Faq | 'new' | null>(null);
  const [removing, setRemoving] = React.useState<Faq | null>(null);
  const toggle = useApiMutation((v: { id: string; isPublished: boolean }) => api.patch(`/cms/faqs/${v.id}`, { isPublished: v.isPublished }), { invalidate: ['/cms/faqs'] });
  const remove = useApiMutation((id: string) => api.delete(`/cms/faqs/${id}`), { success: 'FAQ deleted', invalidate: ['/cms/faqs'], onSuccess: () => setRemoving(null) });
  const categories = Array.from(new Set((q.data ?? []).map((f) => f.category)));
  return (
    <>
      <CardHeader
        title="Frequently asked questions"
        description={WEB ? `Published FAQs appear at ${WEB}/faqs, grouped by category.` : 'Published FAQs appear on the website FAQ page, grouped by category.'}
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus /> New FAQ
          </Button>
        }
      />
      <QueryState query={q} isEmpty={(d) => d.length === 0} empty={{ icon: <MessageCircleQuestion />, title: 'No FAQs', description: 'Answer the questions buyers and partners ask most often.' }}>
        {(rows) => (
          <div className="divide-y divide-line">
            {categories.map((c) => (
              <section key={c} className="px-5 py-4">
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-500 uppercase">{c}</h3>
                <ul className="grid gap-2">
                  {rows
                    .filter((f) => f.category === c)
                    .map((f) => (
                      <li key={f.id} className="flex items-start gap-3 rounded-lg border border-line px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-medium ${f.isPublished ? 'text-ink-900' : 'text-ink-500'}`}>
                            {f.question} {!f.isPublished ? <Badge size="sm">Hidden</Badge> : null}
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-sm text-ink-600">{f.answer}</p>
                        </div>
                        <Switch checked={f.isPublished} onCheckedChange={(v) => toggle.mutate({ id: f.id, isPublished: v })} aria-label={`Publish “${f.question}”`} />
                        <Button size="icon-sm" variant="ghost" aria-label="Edit FAQ" onClick={() => setEditing(f)}>
                          <Pencil />
                        </Button>
                        <Button size="icon-sm" variant="ghost" aria-label="Delete FAQ" onClick={() => setRemoving(f)}>
                          <Trash2 />
                        </Button>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </QueryState>
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        {editing ? <FaqForm faq={editing === 'new' ? null : editing} categories={categories} onDone={() => setEditing(null)} /> : null}
      </Dialog>
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Delete this FAQ?"
        description={removing?.question}
        confirmLabel="Delete"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id);
        }}
      />
    </>
  );
}

function FaqForm({ faq, categories, onDone }: { faq: Faq | null; categories: string[]; onDone: () => void }) {
  const [v, setV] = React.useState({ category: faq?.category ?? categories[0] ?? 'General', question: faq?.question ?? '', answer: faq?.answer ?? '', sortOrder: String(faq?.sortOrder ?? 0), isPublished: faq?.isPublished ?? true });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const save = useApiMutation((body: unknown) => (faq ? api.patch(`/cms/faqs/${faq.id}`, body) : api.post('/cms/faqs', body)), {
    success: faq ? 'FAQ saved' : 'FAQ added',
    invalidate: ['/cms/faqs'],
    onSuccess: onDone,
    onError: (e) => e instanceof ApiError && setErrors(e.fieldErrors()),
  });
  const submit = () => {
    const parsed = faqSchema.safeParse(v);
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
    setErrors({});
    save.mutate(parsed.data);
  };
  return (
    <DialogContent title={faq ? 'Edit FAQ' : 'New FAQ'} size="lg">
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <Field label="Category" htmlFor="fq-cat" required error={errors.category} hint="Type a new name to start a new category.">
          <Input id="fq-cat" list="faq-cats" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} />
          <datalist id="faq-cats">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Order" htmlFor="fq-order" error={errors.sortOrder}>
          <Input id="fq-order" type="number" min={0} max={1000} value={v.sortOrder} onChange={(e) => setV({ ...v, sortOrder: e.target.value })} />
        </Field>
        <Field label="Question" htmlFor="fq-q" required error={errors.question} className="sm:col-span-2">
          <Input id="fq-q" value={v.question} maxLength={300} onChange={(e) => setV({ ...v, question: e.target.value })} />
        </Field>
        <Field label="Answer" htmlFor="fq-a" required error={errors.answer} className="sm:col-span-2" hint="Plain text. Line breaks are kept.">
          <Textarea id="fq-a" rows={6} value={v.answer} maxLength={4000} onChange={(e) => setV({ ...v, answer: e.target.value })} />
        </Field>
        <label className="flex items-center gap-3 text-sm text-ink-800 sm:col-span-2">
          <Switch checked={v.isPublished} onCheckedChange={(isPublished) => setV({ ...v, isPublished })} /> Published on the website
        </label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button loading={save.isPending} onClick={submit}>
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ───────────────────────── SEO overrides ─────────────────────────

function SeoPanel() {
  const q = useApi<SeoOverride[]>('/cms/seo');
  const [editing, setEditing] = React.useState<SeoOverride | 'new' | null>(null);
  const [removing, setRemoving] = React.useState<SeoOverride | null>(null);
  const remove = useApiMutation((id: string) => api.delete(`/cms/seo/${id}`), { success: 'Override deleted', invalidate: ['/cms/seo'], onSuccess: () => setRemoving(null) });
  return (
    <>
      <CardHeader
        title="SEO overrides"
        description="Replace the automatic title, description or share image for a specific website address. Currently applied on content pages (e.g. /about-us), /faqs and /contact; site-wide defaults are in Settings."
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus /> New override
          </Button>
        }
      />
      <QueryState query={q} isEmpty={(d) => d.length === 0} empty={{ icon: <Search />, title: 'No overrides', description: 'Pages use their automatic titles and descriptions.' }}>
        {(rows) => (
          <Table>
            <THead>
              <tr>
                <TH>Address</TH>
                <TH>Title & description</TH>
                <TH align="right">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((s) => (
                <TR key={s.id}>
                  <TD className="font-mono text-xs text-ink-800">
                    {s.path}
                    {s.noIndex ? (
                      <div className="mt-1">
                        <Badge size="sm" tone="warning">
                          Hidden from search engines
                        </Badge>
                      </div>
                    ) : null}
                  </TD>
                  <TD>
                    <div className="text-sm text-ink-900">{s.title ?? <span className="text-ink-400">Automatic title</span>}</div>
                    <div className="line-clamp-2 text-xs text-ink-500">{s.description ?? 'Automatic description'}</div>
                  </TD>
                  <TD align="right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon-sm" variant="ghost" aria-label={`Edit ${s.path}`} onClick={() => setEditing(s)}>
                        <Pencil />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Delete ${s.path}`} onClick={() => setRemoving(s)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </QueryState>
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        {editing ? <SeoForm row={editing === 'new' ? null : editing} onDone={() => setEditing(null)} /> : null}
      </Dialog>
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Delete this override?"
        description={removing ? `${removing.path} goes back to its automatic title and description.` : undefined}
        confirmLabel="Delete"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id);
        }}
      />
    </>
  );
}

function SeoForm({ row, onDone }: { row: SeoOverride | null; onDone: () => void }) {
  const [v, setV] = React.useState({ path: row?.path ?? '/', title: row?.title ?? '', description: row?.description ?? '', canonicalUrl: row?.canonicalUrl ?? '', ogImageUrl: row?.ogImageUrl ?? '', noIndex: row?.noIndex ?? false });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const save = useApiMutation((body: unknown) => (row ? api.patch(`/cms/seo/${row.id}`, body) : api.post('/cms/seo', body)), {
    success: 'Override saved',
    invalidate: ['/cms/seo'],
    onSuccess: onDone,
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors());
      setError(errorMessage(e));
    },
    silent: true,
  });
  const submit = () => {
    setError(null);
    let path = v.path.trim();
    try {
      // Accept a pasted full URL and keep only its path.
      if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
    } catch {
      /* validated below */
    }
    const parsed = seoOverrideSchema.safeParse({ ...v, path, title: v.title.trim() || null, description: v.description.trim() || null });
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
    setErrors({});
    save.mutate(parsed.data);
  };
  return (
    <DialogContent title={row ? 'Edit SEO override' : 'New SEO override'} size="lg">
      {error ? <Alert tone="danger" className="mb-4">{error}</Alert> : null}
      <div className="grid gap-4">
        <Field label="Website address (path)" htmlFor="so-path" required error={errors.path} hint="Starts with /, e.g. /buy/lucknow or /projects">
          <Input id="so-path" className="font-mono" value={v.path} onChange={(e) => setV({ ...v, path: e.target.value })} />
        </Field>
        <Field label="Title" htmlFor="so-title" error={errors.title} hint={`${v.title.length}/70`}>
          <Input id="so-title" value={v.title} maxLength={70} onChange={(e) => setV({ ...v, title: e.target.value })} />
        </Field>
        <Field label="Meta description" htmlFor="so-desc" error={errors.description} hint={`${v.description.length}/170`}>
          <Textarea id="so-desc" rows={3} value={v.description} maxLength={170} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </Field>
        <Field label="Canonical URL" htmlFor="so-canon" error={errors.canonicalUrl}>
          <Input id="so-canon" value={v.canonicalUrl} placeholder="https://…" onChange={(e) => setV({ ...v, canonicalUrl: e.target.value })} />
        </Field>
        <Field label="Social share image" htmlFor="so-og" error={errors.ogImageUrl}>
          <ImageInput id="so-og" value={v.ogImageUrl} onChange={(ogImageUrl) => setV({ ...v, ogImageUrl })} />
        </Field>
        <label className="flex items-center gap-3 text-sm text-ink-800">
          <Switch checked={v.noIndex} onCheckedChange={(noIndex) => setV({ ...v, noIndex })} /> Hide this address from search engines
        </label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button loading={save.isPending} onClick={submit}>
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
