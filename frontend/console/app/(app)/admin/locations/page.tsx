'use client';

import * as React from 'react';
import { MapPin, Pencil, Plus } from 'lucide-react';
import { slugify, type Paginated } from '@estate/shared';
import { ApiError, errorMessage } from '@estate/api-client';
import { Alert, Badge, Button, Card, Dialog, DialogContent, DialogFooter, Field, Input, PageHeader, Pagination, Select, Switch, Table, TBody, TD, TH, THead, TR, Textarea } from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation, useListParams } from '@/lib/hooks';
import { FilterSelect, SearchBox, StatusTabs, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';

interface State {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  _count: { cities: number };
}
interface City {
  id: string;
  stateId: string;
  name: string;
  slug: string;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
  state: { name: string };
  _count: { localities: number; properties: number; projects: number };
}
interface Locality {
  id: string;
  cityId: string;
  name: string;
  slug: string;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  isPopular: boolean;
  isActive: boolean;
  city: { name: string; slug: string };
  _count: { properties: number; projects: number };
}

/** The catalogue API applies field defaults on partial updates, so edits always send the full record. */
const cityBody = (c: City) => ({ stateId: c.stateId, name: c.name, slug: c.slug, latitude: c.latitude, longitude: c.longitude, isActive: c.isActive, isFeatured: c.isFeatured, sortOrder: c.sortOrder });
const localityBody = (l: Locality) => ({ cityId: l.cityId, name: l.name, slug: l.slug, pincode: l.pincode ?? '', latitude: l.latitude, longitude: l.longitude, description: l.description, isPopular: l.isPopular, isActive: l.isActive });
const num = (v: string) => (v.trim() === '' ? null : Number(v));

export default function LocationsPage() {
  const { values, set } = useListParams<{ tab?: string; q?: string; cityId?: string; stateId?: string }>();
  const tab = values.tab ?? 'cities';
  return (
    <>
      <PageHeader title="Locations" description="States, cities and localities used by listings, projects, search and the website. Only active cities appear on the website." />
      <Card>
        <StatusTabs
          tabs={[
            { value: undefined, label: 'Cities' },
            { value: 'localities', label: 'Localities' },
            { value: 'states', label: 'States' },
          ]}
          value={tab === 'cities' ? undefined : tab}
          onChange={(v) => set({ tab: v, q: undefined, cityId: undefined, stateId: undefined })}
        />
        {tab === 'localities' ? <LocalitiesPanel /> : tab === 'states' ? <StatesPanel /> : <CitiesPanel />}
      </Card>
    </>
  );
}

// ───────────────────────── Cities ─────────────────────────

function CitiesPanel() {
  const { values, set, page, setPage } = useListParams<{ q?: string; stateId?: string }>();
  const q = useApi<Paginated<City>>('/admin/cities', { q: values.q, stateId: values.stateId, page, pageSize: 25 });
  const states = useApi<State[]>('/admin/states');
  const [editing, setEditing] = React.useState<City | 'new' | null>(null);
  const patch = useApiMutation((c: City) => api.patch(`/admin/cities/${c.id}`, cityBody(c)), { success: 'City updated', invalidate: ['/admin/cities', '/public/cities'] });
  return (
    <>
      <Toolbar>
        <SearchBox value={values.q} onChange={(v) => set({ q: v })} placeholder="Search cities" />
        <FilterSelect value={values.stateId} onChange={(v) => set({ stateId: v })} placeholder="All states" options={(states.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        <Button size="sm" className="sm:ml-auto" onClick={() => setEditing('new')}>
          <Plus /> Add city
        </Button>
      </Toolbar>
      <QueryState query={q} isEmpty={(d) => d.data.length === 0} empty={{ icon: <MapPin />, title: 'No cities', description: 'Add the cities you operate in.' }}>
        {(d) => (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>City</TH>
                  <TH className="hidden md:table-cell">Usage</TH>
                  <TH>Active</TH>
                  <TH className="hidden sm:table-cell">Featured</TH>
                  <TH align="right">
                    <span className="sr-only">Edit</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {d.data.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <div className="font-medium text-ink-900">{c.name}</div>
                      <div className="text-xs text-ink-500">
                        {c.state.name} · /{c.slug}
                      </div>
                    </TD>
                    <TD className="hidden text-xs text-ink-600 md:table-cell">
                      {c._count.localities} localities · {c._count.properties} listings · {c._count.projects} projects
                    </TD>
                    <TD>
                      <Switch checked={c.isActive} disabled={patch.isPending} onCheckedChange={(isActive) => patch.mutate({ ...c, isActive })} aria-label={`${c.name} active`} />
                    </TD>
                    <TD className="hidden sm:table-cell">
                      <Switch checked={c.isFeatured} disabled={patch.isPending} onCheckedChange={(isFeatured) => patch.mutate({ ...c, isFeatured })} aria-label={`${c.name} featured`} />
                    </TD>
                    <TD align="right">
                      <Button size="icon-sm" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                        <Pencil />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <div className="border-t border-line px-4 py-3">
              <Pagination page={page} totalPages={d.meta.totalPages} total={d.meta.total} pageSize={d.meta.pageSize} onPageChange={setPage} />
            </div>
          </>
        )}
      </QueryState>
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        {editing ? <CityForm city={editing === 'new' ? null : editing} states={states.data ?? []} onDone={() => setEditing(null)} /> : null}
      </Dialog>
    </>
  );
}

function CityForm({ city, states, onDone }: { city: City | null; states: State[]; onDone: () => void }) {
  const [v, setV] = React.useState({
    stateId: city?.stateId ?? states[0]?.id ?? '',
    name: city?.name ?? '',
    slug: city?.slug ?? '',
    latitude: city?.latitude != null ? String(city.latitude) : '',
    longitude: city?.longitude != null ? String(city.longitude) : '',
    sortOrder: String(city?.sortOrder ?? 0),
    isActive: city?.isActive ?? false,
    isFeatured: city?.isFeatured ?? false,
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const body = { ...v, slug: v.slug.trim() || slugify(v.name), latitude: num(v.latitude), longitude: num(v.longitude), sortOrder: Number(v.sortOrder || 0) };
  const save = useApiMutation(() => (city ? api.patch(`/admin/cities/${city.id}`, body) : api.post('/admin/cities', body)), {
    success: city ? 'City saved' : 'City added',
    invalidate: ['/admin/cities', '/public/cities'],
    onSuccess: onDone,
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors());
      setError(errorMessage(e));
    },
    silent: true,
  });
  return (
    <DialogContent title={city ? `Edit ${city.name}` : 'Add a city'}>
      {error ? <Alert tone="danger" className="mb-4">{error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="c-name" required error={errors.name}>
          <Input id="c-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label="State" htmlFor="c-state" required error={errors.stateId}>
          <Select id="c-state" value={v.stateId} onChange={(e) => setV({ ...v, stateId: e.target.value })}>
            {states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Web address" htmlFor="c-slug" error={errors.slug} hint={city && city._count.properties > 0 ? 'Changing it breaks existing search links.' : `Defaults to /${slugify(v.name) || '…'}`}>
          <Input id="c-slug" value={v.slug} placeholder={slugify(v.name)} onChange={(e) => setV({ ...v, slug: e.target.value.toLowerCase() })} />
        </Field>
        <Field label="Order" htmlFor="c-order" error={errors.sortOrder}>
          <Input id="c-order" type="number" min={0} value={v.sortOrder} onChange={(e) => setV({ ...v, sortOrder: e.target.value })} />
        </Field>
        <Field label="Latitude" htmlFor="c-lat" error={errors.latitude}>
          <Input id="c-lat" inputMode="decimal" value={v.latitude} onChange={(e) => setV({ ...v, latitude: e.target.value })} />
        </Field>
        <Field label="Longitude" htmlFor="c-lng" error={errors.longitude}>
          <Input id="c-lng" inputMode="decimal" value={v.longitude} onChange={(e) => setV({ ...v, longitude: e.target.value })} />
        </Field>
        <label className="flex items-center gap-3 text-sm text-ink-800">
          <Switch checked={v.isActive} onCheckedChange={(isActive) => setV({ ...v, isActive })} /> Active on the website
        </label>
        <label className="flex items-center gap-3 text-sm text-ink-800">
          <Switch checked={v.isFeatured} onCheckedChange={(isFeatured) => setV({ ...v, isFeatured })} /> Featured
        </label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button loading={save.isPending} disabled={v.name.trim().length < 2 || !v.stateId} onClick={() => save.mutate(undefined)}>
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ───────────────────────── Localities ─────────────────────────

function LocalitiesPanel() {
  const { values, set, page, setPage } = useListParams<{ q?: string; cityId?: string }>();
  const q = useApi<Paginated<Locality>>('/admin/localities', { q: values.q, cityId: values.cityId, page, pageSize: 25 });
  const cities = useApi<Paginated<City>>('/admin/cities', { pageSize: 100 });
  const [editing, setEditing] = React.useState<Locality | 'new' | null>(null);
  const patch = useApiMutation((l: Locality) => api.patch(`/admin/localities/${l.id}`, localityBody(l)), { success: 'Locality updated', invalidate: ['/admin/localities'] });
  return (
    <>
      <Toolbar>
        <SearchBox value={values.q} onChange={(v) => set({ q: v })} placeholder="Search localities" />
        <FilterSelect value={values.cityId} onChange={(v) => set({ cityId: v })} placeholder="All cities" options={(cities.data?.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <Button size="sm" className="sm:ml-auto" onClick={() => setEditing('new')}>
          <Plus /> Add locality
        </Button>
      </Toolbar>
      <QueryState query={q} isEmpty={(d) => d.data.length === 0} empty={{ icon: <MapPin />, title: 'No localities', description: 'Add localities so listings and projects can be placed precisely.' }}>
        {(d) => (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Locality</TH>
                  <TH className="hidden md:table-cell">Usage</TH>
                  <TH>Active</TH>
                  <TH className="hidden sm:table-cell">Popular</TH>
                  <TH align="right">
                    <span className="sr-only">Edit</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {d.data.map((l) => (
                  <TR key={l.id}>
                    <TD>
                      <div className="font-medium text-ink-900">{l.name}</div>
                      <div className="text-xs text-ink-500">
                        {l.city.name}
                        {l.pincode ? ` · ${l.pincode}` : ''}
                      </div>
                    </TD>
                    <TD className="hidden text-xs text-ink-600 md:table-cell">
                      {l._count.properties} listings · {l._count.projects} projects
                    </TD>
                    <TD>
                      <Switch checked={l.isActive} disabled={patch.isPending} onCheckedChange={(isActive) => patch.mutate({ ...l, isActive })} aria-label={`${l.name} active`} />
                    </TD>
                    <TD className="hidden sm:table-cell">
                      <Switch checked={l.isPopular} disabled={patch.isPending} onCheckedChange={(isPopular) => patch.mutate({ ...l, isPopular })} aria-label={`${l.name} popular`} />
                    </TD>
                    <TD align="right">
                      <Button size="icon-sm" variant="ghost" aria-label={`Edit ${l.name}`} onClick={() => setEditing(l)}>
                        <Pencil />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <div className="border-t border-line px-4 py-3">
              <Pagination page={page} totalPages={d.meta.totalPages} total={d.meta.total} pageSize={d.meta.pageSize} onPageChange={setPage} />
            </div>
          </>
        )}
      </QueryState>
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        {editing ? <LocalityForm locality={editing === 'new' ? null : editing} cities={cities.data?.data ?? []} defaultCityId={values.cityId} onDone={() => setEditing(null)} /> : null}
      </Dialog>
    </>
  );
}

function LocalityForm({ locality, cities, defaultCityId, onDone }: { locality: Locality | null; cities: City[]; defaultCityId?: string; onDone: () => void }) {
  const [v, setV] = React.useState({
    cityId: locality?.cityId ?? defaultCityId ?? cities.find((c) => c.isActive)?.id ?? cities[0]?.id ?? '',
    name: locality?.name ?? '',
    slug: locality?.slug ?? '',
    pincode: locality?.pincode ?? '',
    latitude: locality?.latitude != null ? String(locality.latitude) : '',
    longitude: locality?.longitude != null ? String(locality.longitude) : '',
    description: locality?.description ?? '',
    isPopular: locality?.isPopular ?? false,
    isActive: locality?.isActive ?? true,
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const body = { ...v, slug: v.slug.trim() || slugify(v.name), latitude: num(v.latitude), longitude: num(v.longitude), description: v.description.trim() || null };
  const save = useApiMutation(() => (locality ? api.patch(`/admin/localities/${locality.id}`, body) : api.post('/admin/localities', body)), {
    success: locality ? 'Locality saved' : 'Locality added',
    invalidate: ['/admin/localities'],
    onSuccess: onDone,
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors());
      setError(errorMessage(e));
    },
    silent: true,
  });
  return (
    <DialogContent title={locality ? `Edit ${locality.name}` : 'Add a locality'} size="lg">
      {error ? <Alert tone="danger" className="mb-4">{error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="l-name" required error={errors.name}>
          <Input id="l-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label="City" htmlFor="l-city" required error={errors.cityId}>
          <Select id="l-city" value={v.cityId} onChange={(e) => setV({ ...v, cityId: e.target.value })}>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Web address" htmlFor="l-slug" error={errors.slug} hint={`Defaults to ${slugify(v.name) || '…'}`}>
          <Input id="l-slug" value={v.slug} placeholder={slugify(v.name)} onChange={(e) => setV({ ...v, slug: e.target.value.toLowerCase() })} />
        </Field>
        <Field label="PIN code" htmlFor="l-pin" error={errors.pincode}>
          <Input id="l-pin" inputMode="numeric" maxLength={6} value={v.pincode} onChange={(e) => setV({ ...v, pincode: e.target.value })} />
        </Field>
        <Field label="Latitude" htmlFor="l-lat" error={errors.latitude}>
          <Input id="l-lat" inputMode="decimal" value={v.latitude} onChange={(e) => setV({ ...v, latitude: e.target.value })} />
        </Field>
        <Field label="Longitude" htmlFor="l-lng" error={errors.longitude}>
          <Input id="l-lng" inputMode="decimal" value={v.longitude} onChange={(e) => setV({ ...v, longitude: e.target.value })} />
        </Field>
        <Field label="About this locality" htmlFor="l-desc" error={errors.description} className="sm:col-span-2" hint="Shown on the locality's search page.">
          <Textarea id="l-desc" rows={3} value={v.description} maxLength={2000} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </Field>
        <label className="flex items-center gap-3 text-sm text-ink-800">
          <Switch checked={v.isActive} onCheckedChange={(isActive) => setV({ ...v, isActive })} /> Active
        </label>
        <label className="flex items-center gap-3 text-sm text-ink-800">
          <Switch checked={v.isPopular} onCheckedChange={(isPopular) => setV({ ...v, isPopular })} /> Popular (shown on the homepage)
        </label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button loading={save.isPending} disabled={v.name.trim().length < 2 || !v.cityId} onClick={() => save.mutate(undefined)}>
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ───────────────────────── States ─────────────────────────

function StatesPanel() {
  const q = useApi<State[]>('/admin/states');
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const add = useApiMutation(() => api.post('/admin/states', { name, code: code.trim() || null, isActive: true }), {
    success: 'State added',
    invalidate: ['/admin/states'],
    onSuccess: () => {
      setName('');
      setCode('');
    },
  });
  return (
    <>
      <Toolbar>
        <Input aria-label="State name" className="w-56" placeholder="State name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input aria-label="State code" className="w-24" placeholder="Code" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <Button size="sm" disabled={name.trim().length < 2} loading={add.isPending} onClick={() => add.mutate(undefined)}>
          <Plus /> Add state
        </Button>
      </Toolbar>
      <QueryState query={q} isEmpty={(d) => d.length === 0} empty={{ icon: <MapPin />, title: 'No states' }}>
        {(rows) => (
          <Table>
            <THead>
              <tr>
                <TH>State</TH>
                <TH>Code</TH>
                <TH align="right">Cities</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((s) => (
                <TR key={s.id}>
                  <TD className="font-medium text-ink-900">
                    {s.name} {!s.isActive ? <Badge size="sm">Inactive</Badge> : null}
                  </TD>
                  <TD>{s.code ?? '—'}</TD>
                  <TD align="right" className="tabular">
                    {s._count.cities}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </QueryState>
    </>
  );
}
