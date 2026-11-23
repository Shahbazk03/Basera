'use client';

import * as React from 'react';
import { Layers, Pencil, Plus, Sparkles } from 'lucide-react';
import { enumLabel, FORM_PROFILE_KEYS, FORM_PROFILES, PROPERTY_SEGMENTS, type FormProfileKey } from '@estate/shared';
import { ApiError, errorMessage } from '@estate/api-client';
import { Alert, Badge, Button, Card, Dialog, DialogContent, DialogFooter, Field, Input, PageHeader, Select, Switch, Table, TBody, TD, TH, THead, TR, Textarea } from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation, useListParams } from '@/lib/hooks';
import { StatusTabs, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';

interface PropertyType {
  id: string;
  segment: (typeof PROPERTY_SEGMENTS)[number];
  name: string;
  slug: string;
  description: string | null;
  formProfile: FormProfileKey;
  allowSale: boolean;
  allowRent: boolean;
  sortOrder: number;
  isActive: boolean;
  _count: { properties: number };
}
interface Amenity {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  category: string;
  forProperties: boolean;
  forProjects: boolean;
  sortOrder: number;
  isActive: boolean;
  _count: { properties: number; projects: number };
}

/** The catalogue API applies field defaults on partial updates, so edits always send the full record. */
const typeBody = (t: PropertyType) => ({ segment: t.segment, name: t.name, description: t.description, formProfile: t.formProfile, allowSale: t.allowSale, allowRent: t.allowRent, sortOrder: t.sortOrder, isActive: t.isActive });
const amenityBody = (a: Amenity) => ({ name: a.name, icon: a.icon, category: a.category, forProperties: a.forProperties, forProjects: a.forProjects, sortOrder: a.sortOrder, isActive: a.isActive });

export default function CatalogPage() {
  const { values, set } = useListParams<{ tab?: string }>();
  const tab = values.tab === 'amenities' ? 'amenities' : 'types';
  return (
    <>
      <PageHeader title="Property catalogue" description="Property types decide which form fields a listing has; amenities are the features owners and developers can tick." />
      <Card>
        <StatusTabs
          tabs={[
            { value: undefined, label: 'Property types' },
            { value: 'amenities', label: 'Amenities' },
          ]}
          value={tab === 'amenities' ? 'amenities' : undefined}
          onChange={(v) => set({ tab: v })}
        />
        {tab === 'amenities' ? <AmenitiesPanel /> : <TypesPanel />}
      </Card>
    </>
  );
}

// ───────────────────────── Property types ─────────────────────────

function TypesPanel() {
  const q = useApi<PropertyType[]>('/admin/property-types');
  const [editing, setEditing] = React.useState<PropertyType | 'new' | null>(null);
  const patch = useApiMutation((t: PropertyType) => api.patch(`/admin/property-types/${t.id}`, typeBody(t)), { success: 'Property type updated', invalidate: ['/admin/property-types'] });
  return (
    <>
      <Toolbar>
        <p className="text-sm text-ink-500">Inactive types stay on existing listings but cannot be chosen for new ones.</p>
        <Button size="sm" className="sm:ml-auto" onClick={() => setEditing('new')}>
          <Plus /> Add type
        </Button>
      </Toolbar>
      <QueryState query={q} isEmpty={(d) => d.length === 0} empty={{ icon: <Layers />, title: 'No property types' }}>
        {(rows) => (
          <Table>
            <THead>
              <tr>
                <TH>Type</TH>
                <TH className="hidden md:table-cell">Form</TH>
                <TH className="hidden sm:table-cell">For</TH>
                <TH align="right" className="hidden sm:table-cell">
                  Listings
                </TH>
                <TH>Active</TH>
                <TH align="right">
                  <span className="sr-only">Edit</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((t) => (
                <TR key={t.id}>
                  <TD>
                    <div className="font-medium text-ink-900">{t.name}</div>
                    <div className="text-xs text-ink-500">{enumLabel(t.segment)}</div>
                  </TD>
                  <TD className="hidden text-sm text-ink-700 md:table-cell">{FORM_PROFILES[t.formProfile]?.label ?? t.formProfile}</TD>
                  <TD className="hidden sm:table-cell">
                    <div className="flex gap-1">
                      {t.allowSale ? <Badge size="sm">Sale</Badge> : null}
                      {t.allowRent ? <Badge size="sm">Rent</Badge> : null}
                    </div>
                  </TD>
                  <TD align="right" className="tabular hidden sm:table-cell">
                    {t._count.properties}
                  </TD>
                  <TD>
                    <Switch checked={t.isActive} disabled={patch.isPending} onCheckedChange={(isActive) => patch.mutate({ ...t, isActive })} aria-label={`${t.name} active`} />
                  </TD>
                  <TD align="right">
                    <Button size="icon-sm" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}>
                      <Pencil />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </QueryState>
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        {editing ? <TypeForm type={editing === 'new' ? null : editing} onDone={() => setEditing(null)} /> : null}
      </Dialog>
    </>
  );
}

function TypeForm({ type, onDone }: { type: PropertyType | null; onDone: () => void }) {
  const inUse = (type?._count.properties ?? 0) > 0;
  const [v, setV] = React.useState({
    segment: type?.segment ?? PROPERTY_SEGMENTS[0],
    name: type?.name ?? '',
    description: type?.description ?? '',
    formProfile: type?.formProfile ?? FORM_PROFILE_KEYS[0],
    allowSale: type?.allowSale ?? true,
    allowRent: type?.allowRent ?? true,
    sortOrder: String(type?.sortOrder ?? 0),
    isActive: type?.isActive ?? true,
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const body = { ...v, description: v.description.trim() || null, sortOrder: Number(v.sortOrder || 0) };
  const save = useApiMutation(() => (type ? api.patch(`/admin/property-types/${type.id}`, body) : api.post('/admin/property-types', body)), {
    success: type ? 'Property type saved' : 'Property type added',
    invalidate: ['/admin/property-types'],
    onSuccess: onDone,
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors());
      setError(errorMessage(e));
    },
    silent: true,
  });
  return (
    <DialogContent title={type ? `Edit ${type.name}` : 'Add a property type'} size="lg">
      {error ? <Alert tone="danger" className="mb-4">{error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="pt-name" required error={errors.name}>
          <Input id="pt-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label="Segment" htmlFor="pt-seg" required error={errors.segment} hint={inUse ? 'Locked while listings use this type.' : undefined}>
          <Select id="pt-seg" value={v.segment} disabled={inUse} onChange={(e) => setV({ ...v, segment: e.target.value as PropertyType['segment'] })}>
            {PROPERTY_SEGMENTS.map((s) => (
              <option key={s} value={s}>
                {enumLabel(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Listing form" htmlFor="pt-form" required error={errors.formProfile} className="sm:col-span-2" hint={inUse ? 'Locked while listings use this type — create a new type instead.' : 'Decides which details owners and brokers fill in.'}>
          <Select id="pt-form" value={v.formProfile} disabled={inUse} onChange={(e) => setV({ ...v, formProfile: e.target.value as FormProfileKey })}>
            {FORM_PROFILE_KEYS.map((k) => (
              <option key={k} value={k}>
                {FORM_PROFILES[k]?.label ?? k}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Description" htmlFor="pt-desc" error={errors.description} className="sm:col-span-2">
          <Textarea id="pt-desc" rows={2} maxLength={500} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </Field>
        <Field label="Order" htmlFor="pt-order" error={errors.sortOrder}>
          <Input id="pt-order" type="number" min={0} max={1000} value={v.sortOrder} onChange={(e) => setV({ ...v, sortOrder: e.target.value })} />
        </Field>
        <div className="grid content-end gap-2">
          <label className="flex items-center gap-3 text-sm text-ink-800">
            <Switch checked={v.allowSale} onCheckedChange={(allowSale) => setV({ ...v, allowSale })} /> Can be sold
          </label>
          <label className="flex items-center gap-3 text-sm text-ink-800">
            <Switch checked={v.allowRent} onCheckedChange={(allowRent) => setV({ ...v, allowRent })} /> Can be rented
          </label>
          <label className="flex items-center gap-3 text-sm text-ink-800">
            <Switch checked={v.isActive} onCheckedChange={(isActive) => setV({ ...v, isActive })} /> Active
          </label>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button loading={save.isPending} disabled={v.name.trim().length < 2 || (!v.allowSale && !v.allowRent)} onClick={() => save.mutate(undefined)}>
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ───────────────────────── Amenities ─────────────────────────

function AmenitiesPanel() {
  const q = useApi<Amenity[]>('/admin/amenities');
  const [editing, setEditing] = React.useState<Amenity | 'new' | null>(null);
  const patch = useApiMutation((a: Amenity) => api.patch(`/admin/amenities/${a.id}`, amenityBody(a)), { success: 'Amenity updated', invalidate: ['/admin/amenities'] });
  const categories = Array.from(new Set((q.data ?? []).map((a) => a.category)));
  return (
    <>
      <Toolbar>
        <p className="text-sm text-ink-500">Turning an amenity off hides it from new listings; existing listings keep it.</p>
        <Button size="sm" className="sm:ml-auto" onClick={() => setEditing('new')}>
          <Plus /> Add amenity
        </Button>
      </Toolbar>
      <QueryState query={q} isEmpty={(d) => d.length === 0} empty={{ icon: <Sparkles />, title: 'No amenities' }}>
        {(rows) => (
          <div className="divide-y divide-line">
            {categories.map((c) => (
              <section key={c} className="px-5 py-4">
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-500 uppercase">{c}</h3>
                <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {rows
                    .filter((a) => a.category === c)
                    .map((a) => (
                      <li key={a.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-sm font-medium ${a.isActive ? 'text-ink-900' : 'text-ink-400'}`}>{a.name}</p>
                          <p className="text-xs text-ink-500">
                            {[a.forProperties && 'Listings', a.forProjects && 'Projects'].filter(Boolean).join(' & ') || 'Not offered'} · used {a._count.properties + a._count.projects}×
                          </p>
                        </div>
                        <Switch checked={a.isActive} disabled={patch.isPending} onCheckedChange={(isActive) => patch.mutate({ ...a, isActive })} aria-label={`${a.name} active`} />
                        <Button size="icon-sm" variant="ghost" aria-label={`Edit ${a.name}`} onClick={() => setEditing(a)}>
                          <Pencil />
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
        {editing ? <AmenityForm amenity={editing === 'new' ? null : editing} categories={categories} onDone={() => setEditing(null)} /> : null}
      </Dialog>
    </>
  );
}

function AmenityForm({ amenity, categories, onDone }: { amenity: Amenity | null; categories: string[]; onDone: () => void }) {
  const [v, setV] = React.useState({
    name: amenity?.name ?? '',
    icon: amenity?.icon ?? '',
    category: amenity?.category ?? categories[0] ?? 'General',
    forProperties: amenity?.forProperties ?? true,
    forProjects: amenity?.forProjects ?? true,
    sortOrder: String(amenity?.sortOrder ?? 0),
    isActive: amenity?.isActive ?? true,
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const body = { ...v, icon: v.icon.trim() || null, sortOrder: Number(v.sortOrder || 0) };
  const save = useApiMutation(() => (amenity ? api.patch(`/admin/amenities/${amenity.id}`, body) : api.post('/admin/amenities', body)), {
    success: amenity ? 'Amenity saved' : 'Amenity added',
    invalidate: ['/admin/amenities'],
    onSuccess: onDone,
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors());
      setError(errorMessage(e));
    },
    silent: true,
  });
  return (
    <DialogContent title={amenity ? `Edit ${amenity.name}` : 'Add an amenity'}>
      {error ? <Alert tone="danger" className="mb-4">{error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="am-name" required error={errors.name}>
          <Input id="am-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label="Group" htmlFor="am-cat" required error={errors.category}>
          <Input id="am-cat" list="am-cats" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} />
          <datalist id="am-cats">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Icon name" htmlFor="am-icon" error={errors.icon} hint="Optional icon key used by the website">
          <Input id="am-icon" value={v.icon} maxLength={40} onChange={(e) => setV({ ...v, icon: e.target.value })} />
        </Field>
        <Field label="Order" htmlFor="am-order" error={errors.sortOrder}>
          <Input id="am-order" type="number" min={0} max={1000} value={v.sortOrder} onChange={(e) => setV({ ...v, sortOrder: e.target.value })} />
        </Field>
        <label className="flex items-center gap-3 text-sm text-ink-800">
          <Switch checked={v.forProperties} onCheckedChange={(forProperties) => setV({ ...v, forProperties })} /> Offer on listings
        </label>
        <label className="flex items-center gap-3 text-sm text-ink-800">
          <Switch checked={v.forProjects} onCheckedChange={(forProjects) => setV({ ...v, forProjects })} /> Offer on projects
        </label>
        <label className="flex items-center gap-3 text-sm text-ink-800">
          <Switch checked={v.isActive} onCheckedChange={(isActive) => setV({ ...v, isActive })} /> Active
        </label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button loading={save.isPending} disabled={v.name.trim().length < 2 || v.category.trim().length < 2} onClick={() => save.mutate(undefined)}>
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
