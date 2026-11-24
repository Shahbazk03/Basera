'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ExternalLink, Plus, ScrollText } from 'lucide-react';
import { formatDateTime, isReservedPageSlug, slugify } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Alert, Badge, Button, Card, Dialog, DialogContent, DialogFooter, Field, Input, PageHeader, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation, useListParams } from '@/lib/hooks';
import { SearchBox, StatusTabs, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';

interface PageRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  showInFooter: boolean;
  footerGroup: string | null;
  noIndex: boolean;
  publishedAt: string | null;
  updatedAt: string;
  updatedBy: { fullName: string } | null;
}

const WEB = process.env.NEXT_PUBLIC_WEB_URL ?? '';

export default function CmsPagesPage() {
  const router = useRouter();
  const { values, set } = useListParams<{ status?: string; q?: string }>();
  const q = useApi<PageRow[]>('/cms/pages', values);
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <PageHeader
        title="Pages & content"
        description="Website pages such as About us, policies and guides. Content is built from text blocks — no HTML — and goes live when published."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> New page
          </Button>
        }
      />
      <Card>
        <StatusTabs
          tabs={[
            { value: undefined, label: 'All' },
            { value: 'PUBLISHED', label: 'Published' },
            { value: 'DRAFT', label: 'Drafts' },
            { value: 'ARCHIVED', label: 'Archived' },
          ]}
          value={values.status}
          onChange={(v) => set({ status: v })}
        />
        <Toolbar>
          <SearchBox value={values.q} onChange={(v) => set({ q: v })} placeholder="Search title or address" />
        </Toolbar>
        <QueryState query={q} isEmpty={(d) => d.length === 0} empty={{ icon: <ScrollText />, title: 'No pages', description: 'Create a page for your company information, policies or buyer guides.' }}>
          {(d) => (
            <Table>
              <THead>
                <tr>
                  <TH>Page</TH>
                  <TH className="hidden md:table-cell">Footer</TH>
                  <TH className="hidden lg:table-cell">Last edited</TH>
                  <TH>Status</TH>
                  <TH align="right">
                    <span className="sr-only">Open on website</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {d.map((p) => (
                  <TR key={p.id} onClick={() => router.push(`/cms/pages/${p.id}`)}>
                    <TD>
                      <Link href={`/cms/pages/${p.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-ink-900 hover:underline">
                        {p.title}
                      </Link>
                      <div className="text-xs text-ink-500">
                        /{p.slug}
                        {p.noIndex ? <Badge size="sm" className="ml-1.5">Hidden from search engines</Badge> : null}
                      </div>
                    </TD>
                    <TD className="hidden text-ink-600 md:table-cell">{p.showInFooter ? (p.footerGroup ?? 'Company') : '—'}</TD>
                    <TD className="hidden text-xs text-ink-500 lg:table-cell">
                      {formatDateTime(p.updatedAt)}
                      {p.updatedBy ? <div>by {p.updatedBy.fullName}</div> : null}
                    </TD>
                    <TD>
                      <StatusBadge status={p.status} />
                    </TD>
                    <TD align="right">
                      {p.status === 'PUBLISHED' && WEB ? (
                        <Button asChild size="icon-sm" variant="ghost" aria-label={`Open ${p.title} on the website`}>
                          <a href={`${WEB}/${p.slug}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                            <ExternalLink />
                          </a>
                        </Button>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </QueryState>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>{open ? <NewPage onDone={() => setOpen(false)} /> : null}</Dialog>
    </>
  );
}

function NewPage({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [title, setTitle] = React.useState('');
  const [slug, setSlug] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const effectiveSlug = touched ? slug : slugify(title);
  const reserved = effectiveSlug && isReservedPageSlug(effectiveSlug);
  const create = useApiMutation(() => api.post<{ id: string }>('/cms/pages', { title, slug: effectiveSlug, blocks: [], status: 'DRAFT' }), {
    success: 'Draft page created',
    invalidate: ['/cms/pages'],
    onSuccess: (p) => {
      onDone();
      router.push(`/cms/pages/${p.id}`);
    },
    onError: (e) => setError(errorMessage(e)),
    silent: true,
  });
  return (
    <DialogContent title="New page" description="Starts as a draft — nothing appears on the website until you publish it.">
      {error ? <Alert tone="danger" className="mb-4">{error}</Alert> : null}
      <div className="grid gap-4">
        <Field label="Title" htmlFor="np-title" required>
          <Input id="np-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Web address" htmlFor="np-slug" required error={reserved ? 'This address is used by the website itself' : undefined} hint={effectiveSlug ? `${WEB || ''}/${effectiveSlug}` : undefined}>
          <Input
            id="np-slug"
            value={effectiveSlug}
            onChange={(e) => {
              setTouched(true);
              setSlug(e.target.value.toLowerCase());
            }}
          />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button loading={create.isPending} disabled={title.trim().length < 2 || !effectiveSlug || Boolean(reserved)} onClick={() => create.mutate(undefined)}>
          Create draft
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
