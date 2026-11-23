'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Eye, PencilLine, Trash2 } from 'lucide-react';
import { cmsPageSchema, formatDateTime, isReservedPageSlug, type CmsBlock } from '@estate/shared';
import { ApiError, errorMessage } from '@estate/api-client';
import { Alert, Button, Card, CardBody, CardHeader, ConfirmDialog, Field, Input, PageHeader, StatusBadge, Switch, Textarea } from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { QueryState } from '@/components/query-state';
import { BlockEditor, BlockPreview, withKeys, type EditableBlock } from '@/components/cms/block-editor';
import { ImageInput } from '@/components/cms/image-input';

interface CmsPage {
  id: string;
  slug: string;
  title: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  showInFooter: boolean;
  footerGroup: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  ogImageUrl: string | null;
  noIndex: boolean;
  publishedAt: string | null;
  updatedAt: string;
  updatedBy: { fullName: string } | null;
  blocks: CmsBlock[];
}

const WEB = process.env.NEXT_PUBLIC_WEB_URL ?? '';

export default function CmsPageEditor() {
  const { id } = useParams<{ id: string }>();
  const q = useApi<CmsPage>(`/cms/pages/${id}`);
  const faqs = useApi<{ category: string }[]>('/cms/faqs');
  const categories = React.useMemo(() => Array.from(new Set((faqs.data ?? []).map((f) => f.category))).sort(), [faqs.data]);
  return (
    <QueryState query={q}>
      {(page) => <Editor key={page.updatedAt} page={page} faqCategories={categories} />}
    </QueryState>
  );
}

type Meta = Omit<CmsPage, 'id' | 'blocks' | 'publishedAt' | 'updatedAt' | 'updatedBy'>;

function Editor({ page, faqCategories }: { page: CmsPage; faqCategories: string[] }) {
  const router = useRouter();
  const [meta, setMeta] = React.useState<Meta>({
    slug: page.slug,
    title: page.title,
    status: page.status,
    showInFooter: page.showInFooter,
    footerGroup: page.footerGroup,
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    canonicalUrl: page.canonicalUrl,
    ogImageUrl: page.ogImageUrl,
    noIndex: page.noIndex,
  });
  const [blocks, setBlocks] = React.useState<EditableBlock[]>(() => withKeys(page.blocks ?? []));
  const [dirty, setDirty] = React.useState(false);
  const [preview, setPreview] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [blockErrors, setBlockErrors] = React.useState<Record<number, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const m = <K extends keyof Meta>(k: K, v: Meta[K]) => {
    setMeta((x) => ({ ...x, [k]: v }));
    setDirty(true);
  };

  const save = useApiMutation((body: unknown) => api.patch<CmsPage>(`/cms/pages/${page.id}`, body), {
    success: (r) => (r.status === 'PUBLISHED' && page.status !== 'PUBLISHED' ? 'Published — the page is live' : r.status !== 'PUBLISHED' && page.status === 'PUBLISHED' ? 'Unpublished — the page is no longer on the website' : 'Saved'),
    invalidate: ['/cms/pages'],
    onSuccess: () => setDirty(false),
    onError: (err) => {
      if (err instanceof ApiError) setErrors(err.fieldErrors());
      setFormError(errorMessage(err));
    },
    silent: true,
  });
  const del = useApiMutation(() => api.delete(`/cms/pages/${page.id}`), { success: 'Page deleted', invalidate: ['/cms/pages'], onSuccess: () => router.push('/cms/pages') });

  const submit = (status: Meta['status']) => {
    setFormError(null);
    const body = { ...meta, status, blocks: blocks.map((b) => b.block) };
    const parsed = cmsPageSchema.safeParse(body);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      const be: Record<number, string> = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'blocks' && typeof issue.path[1] === 'number') be[issue.path[1]] ??= `${issue.path.slice(2).join('.') || 'Block'}: ${issue.message}`;
        else fe[String(issue.path[0])] ??= issue.message;
      }
      setErrors(fe);
      setBlockErrors(be);
      setFormError('Fix the highlighted fields before saving.');
      return;
    }
    if (isReservedPageSlug(parsed.data.slug)) {
      setErrors({ slug: 'This address is used by the website itself' });
      return;
    }
    setErrors({});
    setBlockErrors({});
    save.mutate(parsed.data);
  };

  const live = page.status === 'PUBLISHED';
  return (
    <>
      <PageHeader
        title={page.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={page.status} />
            <span>/{page.slug}</span>
            <span className="text-ink-400">· Last edited {formatDateTime(page.updatedAt)}{page.updatedBy ? ` by ${page.updatedBy.fullName}` : ''}</span>
          </span>
        }
        actions={
          <>
            <Button asChild variant="ghost">
              <Link href="/cms/pages">
                <ArrowLeft /> All pages
              </Link>
            </Button>
            {live && WEB ? (
              <Button asChild variant="outline">
                <a href={`${WEB}/${page.slug}`} target="_blank" rel="noreferrer">
                  <Eye /> View live
                </a>
              </Button>
            ) : null}
          </>
        }
      />
      {formError ? <Alert tone="danger" className="mb-4">{formError}</Alert> : null}
      {dirty ? <Alert tone="info" className="mb-4">You have unsaved changes.</Alert> : null}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader
            title="Content"
            actions={
              <Button size="sm" variant="outline" onClick={() => setPreview((p) => !p)}>
                {preview ? (
                  <>
                    <PencilLine /> Edit
                  </>
                ) : (
                  <>
                    <Eye /> Preview
                  </>
                )}
              </Button>
            }
          />
          <CardBody className="grid gap-4">
            {preview ? (
              <BlockPreview title={meta.title} blocks={blocks.map((b) => b.block)} />
            ) : (
              <>
                <Field label="Title" htmlFor="pg-title" required error={errors.title}>
                  <Input id="pg-title" value={meta.title} onChange={(e) => m('title', e.target.value)} className="text-base font-semibold" />
                </Field>
                <BlockEditor
                  value={blocks}
                  onChange={(v) => {
                    setBlocks(v);
                    setDirty(true);
                  }}
                  errors={blockErrors}
                  faqCategories={faqCategories}
                />
              </>
            )}
          </CardBody>
        </Card>

        <div className="grid h-fit gap-5">
          <Card>
            <CardHeader title="Publishing" />
            <CardBody className="grid gap-3">
              <Field label="Web address" htmlFor="pg-slug" required error={errors.slug} hint={live ? 'Changing the address of a live page breaks existing links.' : undefined}>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-ink-500">/</span>
                  <Input id="pg-slug" value={meta.slug} onChange={(e) => m('slug', e.target.value.toLowerCase())} />
                </div>
              </Field>
              <div className="grid gap-2 pt-1">
                {live ? (
                  <>
                    <Button loading={save.isPending} onClick={() => submit('PUBLISHED')}>
                      Save changes
                    </Button>
                    <Button variant="outline" disabled={save.isPending} onClick={() => submit('DRAFT')}>
                      Unpublish (back to draft)
                    </Button>
                  </>
                ) : (
                  <>
                    <Button loading={save.isPending} onClick={() => submit('PUBLISHED')}>
                      Publish
                    </Button>
                    <Button variant="outline" disabled={save.isPending} onClick={() => submit(page.status)}>
                      Save {page.status === 'ARCHIVED' ? 'archived' : 'draft'}
                    </Button>
                    {page.status === 'DRAFT' ? (
                      <Button variant="ghost" disabled={save.isPending} onClick={() => submit('ARCHIVED')}>
                        Archive
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
              <p className="text-xs text-ink-500">Changes to a live page reach the website within about a minute.</p>
              {!live ? (
                <Button variant="ghost" className="justify-start text-danger" onClick={() => setConfirmDelete(true)}>
                  <Trash2 /> Delete page
                </Button>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Footer" />
            <CardBody className="grid gap-3">
              <label className="flex items-center justify-between gap-3 text-sm text-ink-800">
                Show a link in the website footer
                <Switch checked={meta.showInFooter} onCheckedChange={(v) => m('showInFooter', v)} />
              </label>
              {meta.showInFooter ? (
                <Field label="Footer column" htmlFor="pg-group" hint="Pages with the same column name are grouped together." error={errors.footerGroup}>
                  <Input id="pg-group" value={meta.footerGroup ?? ''} placeholder="Company" onChange={(e) => m('footerGroup', e.target.value || null)} />
                </Field>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Search engines" />
            <CardBody className="grid gap-3">
              <Field label="SEO title" htmlFor="pg-seo-t" error={errors.seoTitle} hint={`${(meta.seoTitle ?? '').length}/70 — defaults to the page title`}>
                <Input id="pg-seo-t" value={meta.seoTitle ?? ''} onChange={(e) => m('seoTitle', e.target.value || null)} />
              </Field>
              <Field label="Meta description" htmlFor="pg-seo-d" error={errors.seoDescription} hint={`${(meta.seoDescription ?? '').length}/170`}>
                <Textarea id="pg-seo-d" rows={3} value={meta.seoDescription ?? ''} onChange={(e) => m('seoDescription', e.target.value || null)} />
              </Field>
              <Field label="Canonical URL" htmlFor="pg-canon" error={errors.canonicalUrl}>
                <Input id="pg-canon" value={meta.canonicalUrl ?? ''} placeholder="https://…" onChange={(e) => m('canonicalUrl', e.target.value || null)} />
              </Field>
              <Field label="Social share image" htmlFor="pg-og" error={errors.ogImageUrl}>
                <ImageInput id="pg-og" value={meta.ogImageUrl ?? ''} onChange={(v) => m('ogImageUrl', v || null)} />
              </Field>
              <label className="flex items-center justify-between gap-3 text-sm text-ink-800">
                Hide from search engines
                <Switch checked={meta.noIndex} onCheckedChange={(v) => m('noIndex', v)} />
              </label>
            </CardBody>
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this page?"
        description="The page and its content are removed permanently."
        confirmLabel="Delete"
        tone="danger"
        loading={del.isPending}
        onConfirm={() => del.mutate(undefined)}
      />
    </>
  );
}
