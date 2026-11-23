'use client';

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { SETTING_SCHEMAS, type SettingKey } from '@estate/shared';
import { ApiError, errorMessage } from '@estate/api-client';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, PageHeader, Select, Switch, Textarea, toast } from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { QueryState } from '@/components/query-state';
import { ImageInput } from '@/components/cms/image-input';

type SettingsResponse = Record<string, { value: unknown; isDefault: boolean; group: string }>;
interface Flag {
  key: string;
  enabled: boolean;
  description: string | null;
  updatedAt: string;
}

type Kind = 'text' | 'textarea' | 'email' | 'tel' | 'color' | 'bool' | 'number' | 'image' | 'links' | 'city';
const META: Record<SettingKey, { label: string; kind: Kind; help?: string }> = {
  'brand.name': { label: 'Brand name', kind: 'text' },
  'brand.tagline': { label: 'Tagline', kind: 'text' },
  'brand.logoUrl': { label: 'Logo', kind: 'image', help: 'Shown in the website header. Leave empty to show the brand name.' },
  'brand.primaryColor': { label: 'Brand colour', kind: 'color' },
  'contact.phone': { label: 'Phone', kind: 'tel', help: 'Leave empty to hide the phone number on the website.' },
  'contact.whatsapp': { label: 'WhatsApp number', kind: 'tel' },
  'contact.email': { label: 'Email', kind: 'email' },
  'contact.address': { label: 'Office address', kind: 'textarea' },
  'contact.hours': { label: 'Office hours', kind: 'text', help: 'e.g. Mon–Sat, 10 am – 7 pm' },
  'company.legalName': { label: 'Registered company name', kind: 'text' },
  'company.reraAgentNumber': { label: 'RERA agent registration number', kind: 'text', help: 'Shown in the website footer when filled in.' },
  'social.links': { label: 'Social media links', kind: 'links' },
  'marketplace.defaultCitySlug': { label: 'Default city', kind: 'city', help: 'Homepage and search start in this city.' },
  'listing.validityDays': { label: 'Listing validity (days)', kind: 'number', help: 'Published listings expire after this many days unless renewed (7–730).' },
  'listing.autoPublishOnApproval': { label: 'Publish listings as soon as they are approved', kind: 'bool' },
  'listing.requireReviewOnEdit': { label: 'Re-review listings when important details change', kind: 'bool' },
  'subscriptions.enforceQuota': { label: 'Enforce subscription listing quotas', kind: 'bool' },
  'leads.duplicateWindowDays': { label: 'Duplicate lead window (days)', kind: 'number', help: 'A new enquiry from the same phone within this window is linked to the existing lead.' },
  'leads.followUpReminderMinutes': { label: 'Follow-up reminder (minutes before)', kind: 'number' },
  'payroll.lopForUnmarkedDays': { label: 'Treat days without attendance as loss of pay', kind: 'bool' },
  'payroll.requireMakerChecker': { label: 'Payroll needs a second approver (maker–checker)', kind: 'bool' },
  'seo.defaultTitle': { label: 'Default page title', kind: 'text', help: 'Max 70 characters.' },
  'seo.defaultDescription': { label: 'Default meta description', kind: 'textarea', help: 'Max 170 characters.' },
  'seo.sitemapEnabled': { label: 'Publish sitemap.xml', kind: 'bool' },
  'seo.robotsAllowIndexing': { label: 'Allow search engines to index the website', kind: 'bool', help: 'Turn off for staging sites.' },
};

export default function SettingsPage() {
  const q = useApi<SettingsResponse>('/admin/settings');
  return (
    <>
      <PageHeader title="Settings" description="Business settings used across the website and console. Every change is audited; the public website picks changes up within about five minutes." />
      <QueryState query={q}>
        {(data) => {
          const groups = Array.from(new Set(Object.values(data).map((s) => s.group)));
          return (
            <div className="grid gap-6">
              {groups.map((g) => (
                <SettingsGroup key={`${g}:${JSON.stringify(Object.entries(data).filter(([, s]) => s.group === g))}`} group={g} entries={Object.entries(data).filter(([, s]) => s.group === g) as [SettingKey, SettingsResponse[string]][]} />
              ))}
              <FlagsCard />
            </div>
          );
        }}
      </QueryState>
    </>
  );
}

function SettingsGroup({ group, entries }: { group: string; entries: [SettingKey, { value: unknown; isDefault: boolean }][] }) {
  const initial = React.useMemo(() => Object.fromEntries(entries.map(([k, s]) => [k, s.value])) as Record<SettingKey, unknown>, [entries]);
  const [values, setValues] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const dirtyKeys = entries.map(([k]) => k).filter((k) => JSON.stringify(values[k]) !== JSON.stringify(initial[k]));
  const save = useApiMutation(async () => {
    setSaving(true);
    const errs: Record<string, string> = {};
    let saved = 0;
    for (const k of dirtyKeys) {
      const value = normalise(k, values[k]);
      const parsed = SETTING_SCHEMAS[k].safeParse(value);
      if (!parsed.success) {
        errs[k] = parsed.error.issues[0]?.message ?? 'Invalid value';
        continue;
      }
      try {
        await api.put(`/admin/settings/${encodeURIComponent(k)}`, { value: parsed.data });
        saved += 1;
      } catch (e) {
        errs[k] = e instanceof ApiError ? (Object.values(e.fieldErrors())[0] ?? errorMessage(e)) : errorMessage(e);
      }
    }
    setErrors(errs);
    setSaving(false);
    return { saved, failed: Object.keys(errs).length };
  }, {
    invalidate: ['/admin/settings'],
    onSuccess: (r) => {
      if (r.saved) toast.success(`${r.saved} setting${r.saved === 1 ? '' : 's'} saved`);
      if (r.failed) toast.error(`${r.failed} setting${r.failed === 1 ? '' : 's'} could not be saved`);
    },
  });
  return (
    <Card>
      <CardHeader
        title={group}
        actions={
          <Button size="sm" disabled={!dirtyKeys.length} loading={saving || save.isPending} onClick={() => save.mutate(undefined)}>
            Save changes
          </Button>
        }
      />
      <CardBody className="grid gap-5 md:grid-cols-2">
        {entries.map(([k, s]) => (
          <SettingField key={k} k={k} value={values[k]} isDefault={s.isDefault} error={errors[k]} onChange={(v) => setValues((x) => ({ ...x, [k]: v }))} />
        ))}
      </CardBody>
    </Card>
  );
}

function normalise(k: SettingKey, v: unknown): unknown {
  const kind = META[k]?.kind;
  if (kind === 'number') return v === '' || v === null ? v : Number(v);
  if (kind === 'image') return v ? v : null;
  if (kind === 'links') return (v as { label: string; url: string }[]).filter((l) => l.label.trim() || l.url.trim()).map((l) => ({ label: l.label.trim(), url: l.url.trim() }));
  if (typeof v === 'string') return v.trim();
  return v;
}

function SettingField({ k, value, isDefault, error, onChange }: { k: SettingKey; value: unknown; isDefault: boolean; error?: string; onChange: (v: unknown) => void }) {
  const meta = META[k] ?? { label: k, kind: 'text' as Kind };
  const id = `set-${k.replace(/\./g, '-')}`;
  const label = (
    <span className="inline-flex items-center gap-1.5">
      {meta.label}
      {isDefault ? <Badge size="sm">Default</Badge> : null}
    </span>
  );
  switch (meta.kind) {
    case 'bool':
      return (
        <div className="flex items-start justify-between gap-4 rounded-lg border border-line px-4 py-3 md:col-span-1">
          <div>
            <label htmlFor={id} className="text-sm font-medium text-ink-800">
              {label}
            </label>
            {meta.help ? <p className="text-xs text-ink-500">{meta.help}</p> : null}
            {error ? <p className="text-xs text-danger">{error}</p> : null}
          </div>
          <Switch id={id} checked={Boolean(value)} onCheckedChange={onChange} />
        </div>
      );
    case 'textarea':
      return (
        <Field label={label} htmlFor={id} hint={meta.help} error={error}>
          <Textarea id={id} rows={2} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );
    case 'color':
      return (
        <Field label={label} htmlFor={id} hint={meta.help} error={error}>
          <div className="flex items-center gap-2">
            <input type="color" aria-label={`${meta.label} picker`} value={String(value ?? '#000000')} onChange={(e) => onChange(e.target.value)} className="h-10 w-12 cursor-pointer rounded border border-line" />
            <Input id={id} className="w-32 font-mono" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
          </div>
        </Field>
      );
    case 'image':
      return (
        <Field label={label} htmlFor={id} hint={meta.help} error={error}>
          <ImageInput id={id} value={String(value ?? '')} onChange={(v) => onChange(v)} />
        </Field>
      );
    case 'number':
      return (
        <Field label={label} htmlFor={id} hint={meta.help} error={error}>
          <Input id={id} type="number" className="w-40" value={value === null || value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );
    case 'city':
      return <CityField id={id} label={label} help={meta.help} error={error} value={String(value ?? '')} onChange={onChange} />;
    case 'links':
      return <LinksField label={label} error={error} value={(value as { label: string; url: string }[]) ?? []} onChange={onChange} />;
    default:
      return (
        <Field label={label} htmlFor={id} hint={meta.help} error={error}>
          <Input id={id} type={meta.kind === 'email' ? 'email' : meta.kind === 'tel' ? 'tel' : 'text'} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );
  }
}

function CityField({ id, label, help, error, value, onChange }: { id: string; label: React.ReactNode; help?: string; error?: string; value: string; onChange: (v: string) => void }) {
  const cities = useApi<{ id: string; name: string; slug: string }[]>('/public/cities');
  const list = cities.data ?? [];
  return (
    <Field label={label} htmlFor={id} hint={help} error={error}>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {!list.some((c) => c.slug === value) ? <option value={value}>{value || 'Choose…'} (not an active city)</option> : null}
        {list.map((c) => (
          <option key={c.id} value={c.slug}>
            {c.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function LinksField({ label, error, value, onChange }: { label: React.ReactNode; error?: string; value: { label: string; url: string }[]; onChange: (v: { label: string; url: string }[]) => void }) {
  return (
    <div className="grid gap-2 md:col-span-2">
      <span className="text-sm font-medium text-ink-800">{label}</span>
      {value.map((l, i) => (
        <div key={i} className="flex gap-2">
          <Input aria-label={`Link ${i + 1} name`} className="w-40" placeholder="Instagram" value={l.label} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <Input aria-label={`Link ${i + 1} URL`} placeholder="https://…" value={l.url} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
          <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove link ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Trash2 />
          </Button>
        </div>
      ))}
      {value.length < 10 ? (
        <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => onChange([...value, { label: '', url: '' }])}>
          <Plus /> Add link
        </Button>
      ) : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

function FlagsCard() {
  const q = useApi<Flag[]>('/admin/feature-flags');
  const set = useApiMutation((v: { key: string; enabled: boolean }) => api.put(`/admin/feature-flags/${encodeURIComponent(v.key)}`, { enabled: v.enabled }), {
    success: (r) => `${(r as Flag).key.replace(/_/g, ' ')} ${(r as Flag).enabled ? 'turned on' : 'turned off'}`,
    invalidate: ['/admin/feature-flags'],
  });
  return (
    <Card>
      <CardHeader title="Features" description="Switch platform features on or off. Each change is audited." />
      <QueryState query={q} isEmpty={(d) => d.length === 0} empty={{ title: 'No feature switches', description: 'This installation has no feature flags.' }}>
        {(rows) => (
          <ul className="divide-y divide-line">
            {rows.map((f) => (
              <li key={f.key} className="flex items-start justify-between gap-4 px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-ink-900">{f.key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}</p>
                  {f.description ? <p className="text-xs text-ink-500">{f.description}</p> : null}
                </div>
                <Switch checked={f.enabled} disabled={set.isPending} onCheckedChange={(enabled) => set.mutate({ key: f.key, enabled })} aria-label={f.key} />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      <Alert tone="info" className="m-5 mt-0">
        Integrations (email, SMS, WhatsApp, payments, maps) are configured through server environment variables, not here. Their status is shown under Notifications.
      </Alert>
    </Card>
  );
}
