'use client';

import * as React from 'react';
import { CheckCircle2, CircleAlert, Mail, RotateCcw } from 'lucide-react';
import { DELIVERY_STATUSES, enumLabel, formatDateTime, NOTIFICATION_CHANNELS, type Paginated } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, DialogContent, DialogFooter, Field, Input, PageHeader, Pagination, StatusBadge, Switch, Textarea } from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation, useListParams } from '@/lib/hooks';
import { FilterSelect, SearchBox, StatusTabs, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';

interface ChannelStatus {
  channel: string;
  configured: boolean;
  provider: string;
  hint: string | null;
}
interface LogRow {
  id: string;
  channel: string;
  eventKey: string;
  recipient: string;
  subject: string | null;
  body: string;
  status: string;
  provider: string | null;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
}
interface Template {
  eventKey: string;
  channel: string;
  subject: string | null;
  body: string;
}
interface CustomTemplate extends Template {
  id: string;
  isActive: boolean;
  updatedAt: string;
}

/** Messages for these events carry one-time security links — never shown in the console. */
const isSecret = (eventKey: string) => eventKey.startsWith('auth.');
const CHANNEL_LABELS: Record<string, string> = { IN_APP: 'In-app', EMAIL: 'Email', SMS: 'SMS', WHATSAPP: 'WhatsApp' };
const channelLabel = (c: string) => CHANNEL_LABELS[c] ?? enumLabel(c);
const placeholders = (s: string) => Array.from(new Set(Array.from(s.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g), (m) => m[1])));

export default function NotificationsAdminPage() {
  const { values, set } = useListParams<{ tab?: string }>();
  const tab = values.tab ?? 'delivery';
  return (
    <>
      <PageHeader title="Notifications" description="Delivery channels, the message log and message templates." />
      <ChannelsCard />
      <Card className="mt-6">
        <StatusTabs
          tabs={[
            { value: undefined, label: 'Message log' },
            { value: 'templates', label: 'Templates' },
          ]}
          value={tab === 'templates' ? 'templates' : undefined}
          onChange={(v) => set({ tab: v })}
        />
        {tab === 'templates' ? <TemplatesPanel /> : <LogPanel />}
      </Card>
    </>
  );
}

function ChannelsCard() {
  const q = useApi<{ channels: ChannelStatus[] }>('/notifications/admin/integrations');
  return (
    <Card>
      <CardHeader title="Channels" description="Providers are configured with server environment variables. Unconfigured channels are logged as “not configured” — nothing is pretended to be sent." />
      <QueryState query={q}>
        {(d) => (
          <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {d.channels.map((c) => (
              <div key={c.channel} className="rounded-lg border border-line p-3">
                <div className="flex items-center gap-2">
                  {c.configured ? <CheckCircle2 className="size-4 text-success" /> : <CircleAlert className="size-4 text-warning" />}
                  <span className="font-medium text-ink-900">{channelLabel(c.channel)}</span>
                </div>
                <p className="mt-1 text-xs text-ink-600">{c.configured ? `Active · ${c.provider}` : 'Not configured'}</p>
                {c.hint ? <p className="mt-1 text-xs text-ink-500">{c.hint}</p> : null}
              </div>
            ))}
          </CardBody>
        )}
      </QueryState>
    </Card>
  );
}

function LogPanel() {
  const { values, set, page, setPage } = useListParams<{ status?: string; channel?: string; q?: string }>();
  const q = useApi<Paginated<LogRow> & { statusCounts: Record<string, number> }>('/notifications/admin/logs', { status: values.status, channel: values.channel, q: values.q, page, pageSize: 25 });
  const [viewing, setViewing] = React.useState<LogRow | null>(null);
  const retry = useApiMutation((id: string) => api.post<{ status: string }>(`/notifications/admin/logs/${id}/retry`), {
    success: (r) => (r.status === 'SENT' ? 'Delivered' : `Attempted — status ${enumLabel(r.status).toLowerCase()}`),
    invalidate: ['/notifications/admin/logs'],
  });
  return (
    <>
      <StatusTabs
        tabs={[{ value: undefined, label: 'All' }, ...DELIVERY_STATUSES.map((s) => ({ value: s, label: enumLabel(s) }))]}
        value={values.status}
        onChange={(v) => set({ status: v })}
        counts={q.data?.statusCounts}
      />
      <Toolbar>
        <SearchBox value={values.q} onChange={(v) => set({ q: v })} placeholder="Search recipient or event" />
        <FilterSelect value={values.channel} onChange={(v) => set({ channel: v })} placeholder="All channels" options={NOTIFICATION_CHANNELS.filter((c) => c !== 'IN_APP').map((c) => ({ value: c, label: channelLabel(c) }))} />
      </Toolbar>
      <QueryState query={q} isEmpty={(d) => d.data.length === 0} empty={{ icon: <Mail />, title: 'No messages', description: 'Emails, SMS and WhatsApp messages are logged here.' }}>
        {(d) => (
          <>
            <ul className="divide-y divide-line">
              {d.data.map((m) => (
                <li key={m.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge size="sm">{channelLabel(m.channel)}</Badge>
                      <span className="font-mono text-xs text-ink-600">{m.eventKey}</span>
                      <StatusBadge status={m.status} size="sm" />
                    </div>
                    <p className="mt-0.5 truncate text-sm text-ink-900">{m.subject ?? (isSecret(m.eventKey) ? 'Security message' : m.body.slice(0, 120))}</p>
                    <p className="text-xs text-ink-500">
                      To {m.recipient} · {formatDateTime(m.createdAt)}
                      {m.attempts ? ` · ${m.attempts} attempt${m.attempts === 1 ? '' : 's'}` : ''}
                      {m.sentAt ? ` · sent ${formatDateTime(m.sentAt)}` : ''}
                    </p>
                    {m.lastError ? <p className="mt-0.5 text-xs text-danger">{m.lastError}</p> : null}
                  </div>
                  <div className="flex gap-1">
                    <Button size="xs" variant="ghost" onClick={() => setViewing(m)}>
                      View
                    </Button>
                    {m.status === 'FAILED' || m.status === 'NOT_CONFIGURED' ? (
                      <Button size="xs" variant="outline" loading={retry.isPending && retry.variables === m.id} onClick={() => retry.mutate(m.id)}>
                        <RotateCcw /> Retry
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t border-line px-4 py-3">
              <Pagination page={page} totalPages={d.meta.totalPages} total={d.meta.total} pageSize={d.meta.pageSize} onPageChange={setPage} />
            </div>
          </>
        )}
      </QueryState>
      <Dialog open={Boolean(viewing)} onOpenChange={(o) => !o && setViewing(null)}>
        {viewing ? (
          <DialogContent title={viewing.subject ?? viewing.eventKey} description={`${channelLabel(viewing.channel)} to ${viewing.recipient}`} size="lg">
            {isSecret(viewing.eventKey) ? (
              <Alert tone="info">This message contains a one-time security link for the recipient, so its content is not shown here.</Alert>
            ) : (
              <pre className="max-h-96 overflow-auto rounded-md bg-ink-50 p-3 text-sm whitespace-pre-wrap text-ink-800">{viewing.body}</pre>
            )}
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

function TemplatesPanel() {
  const q = useApi<{ custom: CustomTemplate[]; defaults: Template[] }>('/notifications/admin/templates');
  const [editing, setEditing] = React.useState<{ def: Template; custom: CustomTemplate | null } | null>(null);
  return (
    <QueryState query={q}>
      {(d) => {
        const keys = Array.from(new Set([...d.defaults, ...d.custom].map((t) => `${t.eventKey}|${t.channel}`))).sort();
        return (
          <>
            <ul className="divide-y divide-line">
              {keys.map((k) => {
                const [eventKey, channel] = k.split('|');
                const def = d.defaults.find((t) => t.eventKey === eventKey && t.channel === channel) ?? { eventKey, channel, subject: null, body: '' };
                const custom = d.custom.find((t) => t.eventKey === eventKey && t.channel === channel) ?? null;
                const active = custom?.isActive ? custom : null;
                return (
                  <li key={k} className="flex flex-wrap items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-ink-700">{eventKey}</span>
                        <Badge size="sm">{channelLabel(channel)}</Badge>
                        {active ? <Badge size="sm" tone="info">Customised</Badge> : <Badge size="sm">Default</Badge>}
                      </div>
                      <p className="mt-0.5 truncate text-sm text-ink-900">{(active ?? def).subject ?? (active ?? def).body.split('\n')[0]}</p>
                    </div>
                    <Button size="xs" variant="outline" onClick={() => setEditing({ def, custom })}>
                      Edit
                    </Button>
                  </li>
                );
              })}
            </ul>
            <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
              {editing ? <TemplateForm def={editing.def} custom={editing.custom} onDone={() => setEditing(null)} /> : null}
            </Dialog>
          </>
        );
      }}
    </QueryState>
  );
}

function TemplateForm({ def, custom, onDone }: { def: Template; custom: CustomTemplate | null; onDone: () => void }) {
  const start = custom ?? def;
  const [subject, setSubject] = React.useState(start.subject ?? '');
  const [body, setBody] = React.useState(start.body);
  const [isActive, setIsActive] = React.useState(custom ? custom.isActive : true);
  const [error, setError] = React.useState<string | null>(null);
  const available = placeholders(`${def.subject ?? ''} ${def.body}`);
  const missing = available.filter((p) => !placeholders(`${subject} ${body}`).includes(p));
  const unknown = placeholders(`${subject} ${body}`).filter((p) => !available.includes(p) && !['brand', 'name', 'link'].includes(p));
  const save = useApiMutation(() => api.put('/notifications/admin/templates', { eventKey: def.eventKey, channel: def.channel, subject: subject.trim() || null, body, isActive }), {
    success: isActive ? 'Template saved' : 'Saved — the default template is used while yours is off',
    invalidate: ['/notifications/admin/templates'],
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e)),
    silent: true,
  });
  return (
    <DialogContent title={def.eventKey} description={`${channelLabel(def.channel)} template. Placeholders like {{name}} are filled in as plain text.`} size="lg">
      {error ? <Alert tone="danger" className="mb-4">{error}</Alert> : null}
      <div className="grid gap-4">
        {def.channel === 'EMAIL' || def.channel === 'IN_APP' ? (
          <Field label={def.channel === 'EMAIL' ? 'Subject' : 'Title'} htmlFor="tp-sub">
            <Input id="tp-sub" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          </Field>
        ) : null}
        <Field label="Message" htmlFor="tp-body" required hint={available.length ? `Available: ${['brand', 'name', 'link', ...available].filter((v, i, a) => a.indexOf(v) === i).map((p) => `{{${p}}}`).join(' ')}` : undefined}>
          <Textarea id="tp-body" rows={9} className="font-mono text-[13px]" value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
        </Field>
        {missing.includes('link') ? <Alert tone="warning">The default message includes {'{{link}}'}. Without it, recipients cannot open the page this message is about.</Alert> : missing.length ? <Alert tone="info">Not used: {missing.map((p) => `{{${p}}}`).join(', ')}</Alert> : null}
        {unknown.length ? <Alert tone="warning">Unknown placeholders will be blank: {unknown.map((p) => `{{${p}}}`).join(', ')}</Alert> : null}
        <label className="flex items-center gap-3 text-sm text-ink-800">
          <Switch checked={isActive} onCheckedChange={setIsActive} /> Use this customised template (off = use the built-in default)
        </label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setSubject(def.subject ?? '');
            setBody(def.body);
          }}
        >
          Reset to default text
        </Button>
        <Button loading={save.isPending} disabled={body.trim().length < 2} onClick={() => save.mutate(undefined)}>
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
