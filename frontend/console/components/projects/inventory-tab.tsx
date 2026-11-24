'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Boxes, History, LayoutGrid, Lock, MoreHorizontal, Pencil, Plus, Rows3, Trash2, Unlock } from 'lucide-react';
import {
  AREA_UNITS,
  BLOCK_TYPES,
  enumLabel,
  FACINGS,
  formatArea,
  formatDateTime,
  formatINR,
  formatPriceCompact,
  formatRelative,
  projectBlockSchema,
  projectUnitSchema,
  UNIT_STATUS_TRANSITIONS,
  UNIT_STATUSES,
  UNIT_TYPES,
  unitBulkCreateSchema,
  type Paginated,
  type UnitStatus,
} from '@estate/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CheckboxField,
  cn,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  Input,
  Pagination,
  Segmented,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
} from '@estate/ui';
import { api } from '@/lib/api';
import { applyServerErrors, useApi, useApiMutation, useDebounced } from '@/lib/hooks';
import { QueryState } from '@/components/query-state';
import type { ManageProject, UnitRow } from './types';

const STATUS_ORDER: UnitStatus[] = ['AVAILABLE', 'ON_HOLD', 'RESERVED', 'BOOKED', 'SOLD', 'NOT_RELEASED', 'BLOCKED'];
const STATUS_COLORS: Record<string, string> = {
  AVAILABLE: 'border-success/40 bg-success-soft text-success',
  ON_HOLD: 'border-warning/40 bg-warning-soft text-warning',
  RESERVED: 'border-warning/40 bg-warning-soft text-warning',
  BOOKED: 'border-info/40 bg-info-soft text-info',
  SOLD: 'border-ink-700 bg-ink-800 text-white',
  NOT_RELEASED: 'border-line bg-ink-50 text-ink-400',
  BLOCKED: 'border-danger/30 bg-danger-soft text-danger',
};

const num = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v));

// ───────────── Block dialog ─────────────

function BlockDialog({ projectId, block, onClose, onSaved }: { projectId: string; block: ManageProject['blocks'][number] | 'new'; onClose: () => void; onSaved: () => void }) {
  const form = useForm<z.input<typeof projectBlockSchema>>({
    resolver: zodResolver(projectBlockSchema),
    defaultValues: block === 'new' ? { name: '', type: 'BLOCK' } : { name: block.name, type: block.type as never, totalFloors: block.totalFloors, description: block.description },
  });
  const submit = form.handleSubmit(async (v) => {
    try {
      if (block === 'new') await api.post(`/projects/${projectId}/blocks`, v);
      else await api.patch(`/projects/${projectId}/blocks/${block.id}`, v);
      onSaved();
      onClose();
    } catch (err) {
      applyServerErrors(form, err);
    }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={block === 'new' ? 'Add block / tower / phase' : `Edit ${block.name}`} size="sm">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <Field label="Name" htmlFor="bname" required error={form.formState.errors.name?.message}>
            <Input id="bname" placeholder="e.g. Tower A, Phase 1, Sector B" {...form.register('name')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type" htmlFor="btype">
              <Select id="btype" {...form.register('type')}>
                {BLOCK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {enumLabel(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Floors" htmlFor="bfloors" error={form.formState.errors.totalFloors?.message}>
              <Input id="bfloors" type="number" {...form.register('totalFloors', { setValueAs: num })} />
            </Field>
          </div>
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

// ───────────── Unit dialog ─────────────

const unitForm = projectUnitSchema;

function UnitDialog({ project, unit, onClose, onSaved }: { project: ManageProject; unit: UnitRow | 'new'; onClose: () => void; onSaved: () => void }) {
  const locked = unit !== 'new' && ['BOOKED', 'SOLD'].includes(unit.status);
  const form = useForm<z.input<typeof unitForm>>({
    resolver: zodResolver(unitForm),
    defaultValues:
      unit === 'new'
        ? { unitType: project.projectType === 'APARTMENTS' ? 'FLAT' : project.projectType === 'COMMERCIAL' ? 'SHOP' : 'PLOT', areaUnit: 'SQFT', status: 'AVAILABLE', additionalCharges: 0, isCorner: false }
        : {
            code: unit.code,
            blockId: unit.blockId,
            unitType: unit.unitType as never,
            floorNumber: unit.floorNumber,
            configuration: unit.configuration,
            bedrooms: unit.bedrooms,
            area: unit.area,
            areaUnit: unit.areaUnit as never,
            carpetAreaSqft: unit.carpetAreaSqft,
            facing: unit.facing as never,
            dimensions: unit.dimensions,
            isCorner: unit.isCorner,
            basePrice: unit.basePrice,
            additionalCharges: unit.additionalCharges,
            notes: unit.notes,
          },
  });
  const errors = form.formState.errors;
  const base = Number(form.watch('basePrice') ?? 0);
  const extra = Number(form.watch('additionalCharges') ?? 0);
  const submit = form.handleSubmit(async (v) => {
    try {
      if (unit === 'new') await api.post(`/projects/${project.id}/units`, v);
      else {
        const { status: _s, ...rest } = v;
        await api.patch(`/project-units/${unit.id}`, { ...rest, expectedVersion: unit.version });
      }
      onSaved();
      onClose();
    } catch (err) {
      applyServerErrors(form, err);
      form.setError('root', { message: err instanceof Error ? err.message : 'Could not save the unit' });
    }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={unit === 'new' ? 'Add unit' : `Edit unit ${unit.code}`} size="lg">
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-3">
          {form.formState.errors.root ? <Alert tone="danger" className="sm:col-span-3">{form.formState.errors.root.message}</Alert> : null}
          {locked ? <Alert tone="info" className="sm:col-span-3">This unit is {enumLabel((unit as UnitRow).status).toLowerCase()} — its price can no longer change.</Alert> : null}
          <Field label="Unit code" htmlFor="ucode" required error={errors.code?.message}>
            <Input id="ucode" placeholder="A-101" {...form.register('code')} />
          </Field>
          <Field label="Block" htmlFor="ublock">
            <Select id="ublock" {...form.register('blockId', { setValueAs: (v) => v || null })}>
              <option value="">No block</option>
              {project.blocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Unit type" htmlFor="utype">
            <Select id="utype" {...form.register('unitType')}>
              {UNIT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {enumLabel(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Configuration" htmlFor="uconf" hint="e.g. 3 BHK">
            <Input id="uconf" {...form.register('configuration', { setValueAs: (v) => v || null })} />
          </Field>
          <Field label="Bedrooms" htmlFor="ubed" error={errors.bedrooms?.message}>
            <Input id="ubed" type="number" {...form.register('bedrooms', { setValueAs: num })} />
          </Field>
          <Field label="Floor" htmlFor="ufloor" error={errors.floorNumber?.message}>
            <Input id="ufloor" type="number" {...form.register('floorNumber', { setValueAs: num })} />
          </Field>
          <Field label="Area" htmlFor="uarea" required error={errors.area?.message}>
            <Input id="uarea" type="number" step="any" {...form.register('area')} />
          </Field>
          <Field label="Area unit" htmlFor="uunit">
            <Select id="uunit" {...form.register('areaUnit')}>
              {AREA_UNITS.map((u) => (
                <option key={u} value={u}>
                  {enumLabel(u)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Carpet area (sq.ft)" htmlFor="ucarpet" error={errors.carpetAreaSqft?.message}>
            <Input id="ucarpet" type="number" step="any" {...form.register('carpetAreaSqft', { setValueAs: num })} />
          </Field>
          <Field label="Facing" htmlFor="ufacing">
            <Select id="ufacing" {...form.register('facing', { setValueAs: (v) => v || null })}>
              <option value="">Not specified</option>
              {FACINGS.map((f) => (
                <option key={f} value={f}>
                  {enumLabel(f)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dimensions" htmlFor="udim" hint="e.g. 30 × 40 ft">
            <Input id="udim" {...form.register('dimensions', { setValueAs: (v) => v || null })} />
          </Field>
          <div className="flex items-end pb-2">
            <CheckboxField label="Corner unit" checked={Boolean(form.watch('isCorner'))} onCheckedChange={(v) => form.setValue('isCorner', Boolean(v))} />
          </div>
          <Field label="Base price (₹)" htmlFor="ubase" required error={errors.basePrice?.message}>
            <Input id="ubase" type="number" step="1" disabled={locked} {...form.register('basePrice')} />
          </Field>
          <Field label="Additional charges (₹)" htmlFor="uextra" hint="PLC, parking, club etc." error={errors.additionalCharges?.message}>
            <Input id="uextra" type="number" step="1" disabled={locked} {...form.register('additionalCharges')} />
          </Field>
          <Field label="Total price">
            <div className="flex h-10 items-center rounded-md bg-ink-50 px-3 text-sm font-medium text-ink-900 tabular">{Number.isFinite(base + extra) ? formatINR(base + extra) : '—'}</div>
          </Field>
          {unit === 'new' ? (
            <Field label="Initial status" htmlFor="ustatus">
              <Select id="ustatus" {...form.register('status')}>
                <option value="AVAILABLE">Available</option>
                <option value="NOT_RELEASED">Not released</option>
                <option value="BLOCKED">Blocked</option>
              </Select>
            </Field>
          ) : null}
          <Field label="Internal notes" htmlFor="unotes" className={unit === 'new' ? 'sm:col-span-2' : 'sm:col-span-3'}>
            <Input id="unotes" {...form.register('notes', { setValueAs: (v) => v || null })} />
          </Field>
          <DialogFooter className="sm:col-span-3">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {unit === 'new' ? 'Add unit' : 'Save unit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Bulk dialog ─────────────

function BulkDialog({ project, onClose, onSaved }: { project: ManageProject; onClose: () => void; onSaved: () => void }) {
  const form = useForm<z.input<typeof unitBulkCreateSchema>>({
    resolver: zodResolver(unitBulkCreateSchema),
    defaultValues: { prefix: '', startNumber: 1, count: 10, unitType: project.projectType === 'APARTMENTS' ? 'FLAT' : 'PLOT', areaUnit: 'SQFT', additionalCharges: 0, status: 'AVAILABLE' },
  });
  const [error, setError] = React.useState<string | null>(null);
  const v = form.watch();
  const width = Math.max(2, String(Number(v.startNumber || 0) + Number(v.count || 0) - 1).length);
  const sample = (n: number) => `${(v.prefix ?? '').toString().toUpperCase()}${String(n).padStart(width, '0')}`;
  const errors = form.formState.errors;
  const submit = form.handleSubmit(async (vals) => {
    setError(null);
    try {
      await api.post(`/projects/${project.id}/units/bulk`, vals);
      onSaved();
      onClose();
    } catch (err) {
      if (!applyServerErrors(form, err)) setError(err instanceof Error ? err.message : 'Could not create units');
    }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Add units in bulk" description="Creates a numbered series of identical units — edit individual units afterwards." size="lg">
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-3">
          {error ? <Alert tone="danger" className="sm:col-span-3">{error}</Alert> : null}
          <Field label="Block" htmlFor="bblock">
            <Select id="bblock" {...form.register('blockId', { setValueAs: (x) => x || null })}>
              <option value="">No block</option>
              {project.blocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Code prefix" htmlFor="bprefix" hint="e.g. A- or T1-" error={errors.prefix?.message}>
            <Input id="bprefix" {...form.register('prefix')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start no." htmlFor="bstart" error={errors.startNumber?.message}>
              <Input id="bstart" type="number" {...form.register('startNumber')} />
            </Field>
            <Field label="Count" htmlFor="bcount" error={errors.count?.message}>
              <Input id="bcount" type="number" {...form.register('count')} />
            </Field>
          </div>
          <p className="text-[12.5px] text-ink-500 sm:col-span-3">
            Codes: <span className="font-medium text-ink-800 tabular">{sample(Number(v.startNumber || 0))}</span> … <span className="font-medium text-ink-800 tabular">{sample(Number(v.startNumber || 0) + Number(v.count || 1) - 1)}</span>
          </p>
          <Field label="Unit type" htmlFor="btype2">
            <Select id="btype2" {...form.register('unitType')}>
              {UNIT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {enumLabel(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Configuration" htmlFor="bconf">
            <Input id="bconf" placeholder="e.g. 2 BHK" {...form.register('configuration', { setValueAs: (x) => x || null })} />
          </Field>
          <Field label="Floor" htmlFor="bfloor">
            <Input id="bfloor" type="number" {...form.register('floorNumber', { setValueAs: num })} />
          </Field>
          <Field label="Area" htmlFor="barea" required error={errors.area?.message}>
            <Input id="barea" type="number" step="any" {...form.register('area')} />
          </Field>
          <Field label="Area unit" htmlFor="bunit">
            <Select id="bunit" {...form.register('areaUnit')}>
              {AREA_UNITS.map((u) => (
                <option key={u} value={u}>
                  {enumLabel(u)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="bstatus">
            <Select id="bstatus" {...form.register('status')}>
              <option value="AVAILABLE">Available</option>
              <option value="NOT_RELEASED">Not released</option>
            </Select>
          </Field>
          <Field label="Base price per unit (₹)" htmlFor="bbase" required error={errors.basePrice?.message}>
            <Input id="bbase" type="number" step="1" {...form.register('basePrice')} />
          </Field>
          <Field label="Additional charges (₹)" htmlFor="bextra">
            <Input id="bextra" type="number" step="1" {...form.register('additionalCharges')} />
          </Field>
          <DialogFooter className="sm:col-span-3">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Create {Number(v.count) || 0} units
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Status / reserve / history ─────────────

function StatusDialog({ unit, onClose, onSaved }: { unit: UnitRow; onClose: () => void; onSaved: () => void }) {
  const targets = UNIT_STATUS_TRANSITIONS[unit.status as UnitStatus].filter((s) => s !== 'RESERVED');
  const [to, setTo] = React.useState<string>(targets[0] ?? '');
  const [reason, setReason] = React.useState('');
  const [hours, setHours] = React.useState('48');
  const save = useApiMutation(() => api.post(`/project-units/${unit.id}/status`, { status: to, reason: reason || undefined, expectedVersion: unit.version, holdHours: to === 'ON_HOLD' && hours ? Number(hours) : undefined }), {
    success: `Unit ${unit.code} updated`,
    invalidate: ['/projects'],
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Change status of ${unit.code}`} description={`Currently ${enumLabel(unit.status).toLowerCase()}.`} size="sm">
        {targets.length ? (
          <div className="grid gap-4">
            <Field label="New status" htmlFor="sto">
              <Select id="sto" value={to} onChange={(e) => setTo(e.target.value)}>
                {targets.map((s) => (
                  <option key={s} value={s}>
                    {enumLabel(s)}
                  </option>
                ))}
              </Select>
            </Field>
            {to === 'ON_HOLD' ? (
              <Field label="Release the hold after" htmlFor="shours" hint="Leave empty to hold until released manually">
                <Input id="shours" type="number" min={1} value={hours} onChange={(e) => setHours(e.target.value)} trailing={<span className="text-xs">hours</span>} />
              </Field>
            ) : null}
            {unit.status === 'RESERVED' ? <Alert tone="info">The active reservation will be {to === 'BOOKED' ? 'converted to a booking' : 'released'}.</Alert> : null}
            <Field label="Reason" htmlFor="sreason">
              <Textarea id="sreason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button loading={save.isPending} disabled={!to} onClick={() => save.mutate(undefined)}>
                Update status
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <p className="text-sm text-ink-600">No status changes are possible from {enumLabel(unit.status).toLowerCase()}.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface LeadOption {
  id: string;
  leadNo: string;
  name: string;
  phone?: string;
  status?: string;
}

function ReserveDialog({ unit, project, onClose, onSaved }: { unit: UnitRow; project: ManageProject; onClose: () => void; onSaved: () => void }) {
  const [hours, setHours] = React.useState('48');
  const [notes, setNotes] = React.useState('');
  const [q, setQ] = React.useState('');
  const [lead, setLead] = React.useState<LeadOption | null>(null);
  const debounced = useDebounced(q, 300);
  const leads = useApi<Paginated<LeadOption>>(debounced.trim().length >= 2 && !lead ? '/crm/leads' : null, { q: debounced.trim(), pageSize: 6, organizationId: project.organizationId }, { retry: false });
  const reserve = useApiMutation(() => api.post(`/project-units/${unit.id}/reserve`, { leadId: lead?.id ?? null, expiresInHours: Number(hours) || 48, notes: notes || undefined, expectedVersion: unit.version }), {
    success: `Unit ${unit.code} reserved`,
    invalidate: ['/projects'],
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Reserve ${unit.code}`} description={`${formatINR(unit.totalPrice)} · the unit is held for the customer until the reservation expires or is released.`}>
        <div className="grid gap-4">
          {!project.isBookable ? <Alert tone="warning">Reservations open when booking is open — the project is currently {enumLabel(project.computedStatus).toLowerCase()}.</Alert> : null}
          <Field label="For lead (optional)" htmlFor="rlead" hint="Search by name, phone or lead number">
            {lead ? (
              <div className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm">
                <span>
                  <span className="font-medium text-ink-900">{lead.name}</span> <span className="text-ink-500">· {lead.leadNo}</span>
                </span>
                <Button size="xs" variant="ghost" onClick={() => setLead(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <>
                <Input id="rlead" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type at least 2 characters" />
                {leads.isError ? <p className="mt-1 text-xs text-ink-500">Lead search is not available for your account.</p> : null}
                {leads.data?.data.length ? (
                  <ul className="mt-1 max-h-44 overflow-y-auto rounded-md border border-line">
                    {leads.data.data.map((l) => (
                      <li key={l.id}>
                        <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-ink-50" onClick={() => setLead(l)}>
                          <span className="font-medium text-ink-900">{l.name}</span>
                          <span className="text-xs text-ink-500">{l.leadNo}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : debounced.trim().length >= 2 && leads.data ? (
                  <p className="mt-1 text-xs text-ink-500">No matching leads.</p>
                ) : null}
              </>
            )}
          </Field>
          <Field label="Hold for" htmlFor="rhours">
            <Input id="rhours" type="number" min={1} max={720} value={hours} onChange={(e) => setHours(e.target.value)} trailing={<span className="text-xs">hours</span>} />
          </Field>
          <Field label="Notes" htmlFor="rnotes">
            <Textarea id="rnotes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={reserve.isPending} disabled={!project.isBookable} onClick={() => reserve.mutate(undefined)}>
              Reserve unit
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface UnitHistory {
  history: { id: string; fromStatus: string | null; toStatus: string; reason: string | null; createdAt: string; priceBefore: number | null; priceAfter: number | null; changedBy: { fullName: string } | null }[];
  reservations: { id: string; status: string; expiresAt: string | null; createdAt: string; notes: string | null; lead: { leadNo: string; name: string } | null; reservedBy: { fullName: string } | null }[];
}

function HistoryDialog({ unit, onClose }: { unit: UnitRow; onClose: () => void }) {
  const q = useApi<UnitHistory>(`/project-units/${unit.id}/history`);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`History of ${unit.code}`} size="lg">
        <QueryState query={q} rows={4}>
          {(d) => (
            <div className="grid gap-5">
              <ol className="relative space-y-4 border-l border-line pl-5">
                {d.history.map((h) => (
                  <li key={h.id} className="relative">
                    <span className="absolute -left-[25px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-ink-400" />
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {h.fromStatus && h.fromStatus !== h.toStatus ? <StatusBadge status={h.fromStatus} size="sm" /> : null}
                      {h.fromStatus && h.fromStatus !== h.toStatus ? <span className="text-ink-400">→</span> : null}
                      <StatusBadge status={h.toStatus} size="sm" />
                      {h.priceBefore != null && h.priceAfter != null && h.priceBefore !== h.priceAfter ? (
                        <span className="text-xs text-ink-600 tabular">
                          {formatINR(h.priceBefore)} → {formatINR(h.priceAfter)}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-ink-500">
                      {formatDateTime(h.createdAt)} · {h.changedBy?.fullName ?? 'System'}
                    </p>
                    {h.reason ? <p className="mt-0.5 text-sm text-ink-700">{h.reason}</p> : null}
                  </li>
                ))}
              </ol>
              {d.reservations.length ? (
                <div>
                  <p className="mb-2 text-sm font-semibold text-ink-900">Reservations</p>
                  <ul className="divide-y divide-line rounded-lg border border-line">
                    {d.reservations.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                        <span>
                          {r.lead ? `${r.lead.name} (${r.lead.leadNo})` : 'No lead linked'} · by {r.reservedBy?.fullName ?? '—'}
                        </span>
                        <span className="flex items-center gap-2 text-xs text-ink-500">
                          {formatDateTime(r.createdAt)}
                          <StatusBadge status={r.status} size="sm" />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </QueryState>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Tab ─────────────

export function InventoryTab({ project, onChanged }: { project: ManageProject; onChanged: () => void }) {
  const canManage = project.permissions.canManageInventory;
  const [status, setStatus] = React.useState<string>('');
  const [blockId, setBlockId] = React.useState<string>('');
  const [q, setQ] = React.useState('');
  const [view, setView] = React.useState<'table' | 'grid'>('table');
  const [page, setPage] = React.useState(1);
  const search = useDebounced(q, 300);
  const units = useApi<Paginated<UnitRow> & { statusCounts: Record<string, number> }>(`/projects/${project.id}/units`, { status: status || undefined, blockId: blockId || undefined, q: search || undefined, page, pageSize: view === 'grid' ? 500 : 50 });
  const [blockDialog, setBlockDialog] = React.useState<ManageProject['blocks'][number] | 'new' | null>(null);
  const [unitDialog, setUnitDialog] = React.useState<UnitRow | 'new' | null>(null);
  const [bulk, setBulk] = React.useState(false);
  const [statusUnit, setStatusUnit] = React.useState<UnitRow | null>(null);
  const [reserveUnit, setReserveUnit] = React.useState<UnitRow | null>(null);
  const [historyUnit, setHistoryUnit] = React.useState<UnitRow | null>(null);
  const [deleteUnit, setDeleteUnit] = React.useState<UnitRow | null>(null);
  const [deleteBlock, setDeleteBlock] = React.useState<ManageProject['blocks'][number] | null>(null);
  const refresh = () => {
    void units.refetch();
    onChanged();
  };
  const release = useApiMutation((u: UnitRow) => api.post(`/project-units/${u.id}/release`, {}), { success: 'Reservation released', invalidate: ['/projects'], onSuccess: refresh });
  const removeUnit = useApiMutation((u: UnitRow) => api.delete(`/project-units/${u.id}`), { success: 'Unit deleted', invalidate: ['/projects'], onSuccess: () => { setDeleteUnit(null); refresh(); } });
  const removeBlock = useApiMutation((b: { id: string }) => api.delete(`/projects/${project.id}/blocks/${b.id}`), { success: 'Block deleted', invalidate: ['/projects'], onSuccess: () => { setDeleteBlock(null); refresh(); } });
  const counts = units.data?.statusCounts ?? project.inventory.byStatus;

  React.useEffect(() => setPage(1), [status, blockId, search, view]);

  const actions = (u: UnitRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${u.code}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {canManage ? (
          <>
            <DropdownMenuItem onSelect={() => setUnitDialog(u)}>
              <Pencil /> Edit unit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setStatusUnit(u)}>
              <Rows3 /> Change status
            </DropdownMenuItem>
            {['AVAILABLE', 'ON_HOLD'].includes(u.status) ? (
              <DropdownMenuItem onSelect={() => setReserveUnit(u)}>
                <Lock /> Reserve for a customer
              </DropdownMenuItem>
            ) : null}
            {u.status === 'RESERVED' ? (
              <DropdownMenuItem onSelect={() => release.mutate(u)}>
                <Unlock /> Release reservation
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}
        <DropdownMenuItem onSelect={() => setHistoryUnit(u)}>
          <History /> History
        </DropdownMenuItem>
        {canManage && ['AVAILABLE', 'NOT_RELEASED', 'BLOCKED'].includes(u.status) ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem tone="danger" onSelect={() => setDeleteUnit(u)}>
              <Trash2 /> Delete unit
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setStatus('')} className={cn('rounded-lg border px-3 py-2 text-left transition-colors', !status ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-surface hover:border-ink-300')}>
          <span className="block text-[11px] uppercase tracking-wide opacity-70">All units</span>
          <span className="tabular block text-lg font-semibold">{Object.values(counts).reduce((a, b) => a + b, 0)}</span>
        </button>
        {STATUS_ORDER.filter((s) => counts[s]).map((s) => (
          <button key={s} type="button" onClick={() => setStatus(status === s ? '' : s)} className={cn('rounded-lg border px-3 py-2 text-left transition-colors', status === s ? 'ring-2 ring-ink-900 ring-offset-1' : '', STATUS_COLORS[s])}>
            <span className="block text-[11px] uppercase tracking-wide opacity-80">{enumLabel(s)}</span>
            <span className="tabular block text-lg font-semibold">{counts[s]}</span>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader
          title="Blocks, towers & phases"
          actions={
            canManage ? (
              <Button size="sm" variant="outline" onClick={() => setBlockDialog('new')}>
                <Plus /> Add block
              </Button>
            ) : null
          }
        />
        <CardBody>
          {project.blocks.length ? (
            <div className="flex flex-wrap gap-2">
              {project.blocks.map((b) => (
                <div key={b.id} className={cn('flex items-center gap-2 rounded-lg border px-3 py-2', blockId === b.id ? 'border-brand bg-brand-soft' : 'border-line')}>
                  <button type="button" className="text-left" onClick={() => setBlockId(blockId === b.id ? '' : b.id)}>
                    <span className="block text-sm font-medium text-ink-900">{b.name}</span>
                    <span className="block text-xs text-ink-500">
                      {enumLabel(b.type)} · {b._count.units} units{b.totalFloors ? ` · ${b.totalFloors} floors` : ''}
                    </span>
                  </button>
                  {canManage ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${b.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => setBlockDialog(b)}>
                          <Pencil /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem tone="danger" onSelect={() => setDeleteBlock(b)}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-500">No blocks yet. Blocks are optional — use them for towers, phases or sectors.</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <div className="flex flex-col gap-2.5 border-b border-line px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="w-full sm:w-56">
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search unit code or type" aria-label="Search units" />
          </div>
          <div className="w-full sm:w-44">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
              <option value="">All statuses</option>
              {UNIT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {enumLabel(s)}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-full sm:w-44">
            <Select value={blockId} onChange={(e) => setBlockId(e.target.value)} aria-label="Block filter">
              <option value="">All blocks</option>
              {project.blocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
              <option value="none">Without block</option>
            </Select>
          </div>
          <Segmented
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'table', label: <span className="inline-flex items-center gap-1"><Rows3 className="size-3.5" /> Table</span> },
              { value: 'grid', label: <span className="inline-flex items-center gap-1"><LayoutGrid className="size-3.5" /> Grid</span> },
            ]}
          />
          {canManage ? (
            <div className="flex gap-2 sm:ml-auto">
              <Button size="sm" variant="outline" onClick={() => setBulk(true)}>
                <Boxes /> Bulk add
              </Button>
              <Button size="sm" onClick={() => setUnitDialog('new')}>
                <Plus /> Add unit
              </Button>
            </div>
          ) : null}
        </div>
        {units.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : (
          <QueryState
            query={units}
            isEmpty={(d) => d.data.length === 0}
            empty={{ icon: <Boxes />, title: status || blockId || search ? 'No units match these filters' : 'No units yet', description: status || blockId || search ? 'Clear the filters to see all units.' : 'Add units one by one or create a numbered series in bulk.' }}
          >
            {(d) =>
              view === 'grid' ? (
                <div className="p-4">
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
                    {d.data.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => (canManage ? setStatusUnit(u) : setHistoryUnit(u))}
                        className={cn('rounded-md border px-2 py-2 text-left transition-transform hover:-translate-y-px', STATUS_COLORS[u.status])}
                        title={`${u.code} · ${enumLabel(u.status)} · ${formatINR(u.totalPrice)}`}
                      >
                        <span className="block text-[13px] font-semibold tabular">{u.code}</span>
                        <span className="block truncate text-[11px] opacity-80">{u.configuration ?? formatArea(u.area, u.areaUnit)}</span>
                      </button>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3 text-xs text-ink-500">
                    {STATUS_ORDER.map((s) => (
                      <span key={s} className="inline-flex items-center gap-1.5">
                        <span className={cn('size-3 rounded border', STATUS_COLORS[s])} /> {enumLabel(s)}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <Table>
                    <THead>
                      <tr>
                        <TH>Unit</TH>
                        <TH>Type</TH>
                        <TH className="hidden md:table-cell">Area</TH>
                        <TH className="hidden lg:table-cell">Facing</TH>
                        <TH align="right">Price</TH>
                        <TH>Status</TH>
                        <TH align="right">
                          <span className="sr-only">Actions</span>
                        </TH>
                      </tr>
                    </THead>
                    <TBody>
                      {d.data.map((u) => (
                        <TR key={u.id}>
                          <TD>
                            <div className="font-medium text-ink-900 tabular">{u.code}</div>
                            <div className="text-xs text-ink-500">
                              {u.block?.name ?? 'No block'}
                              {u.floorNumber != null ? ` · Floor ${u.floorNumber}` : ''}
                            </div>
                          </TD>
                          <TD>
                            <div className="text-ink-800">{u.configuration ?? enumLabel(u.unitType)}</div>
                            {u.isCorner ? <Badge tone="brand" size="sm">Corner</Badge> : null}
                          </TD>
                          <TD className="hidden md:table-cell">
                            <div className="tabular">{formatArea(u.area, u.areaUnit)}</div>
                            {u.areaUnit !== 'SQFT' ? <div className="text-xs text-ink-500 tabular">{formatArea(u.areaSqft, 'SQFT')}</div> : u.dimensions ? <div className="text-xs text-ink-500">{u.dimensions}</div> : null}
                          </TD>
                          <TD className="hidden lg:table-cell">{u.facing ? enumLabel(u.facing) : '—'}</TD>
                          <TD align="right" className="tabular">
                            <div className="font-medium text-ink-900">{formatPriceCompact(u.totalPrice)}</div>
                            {Number(u.additionalCharges) > 0 ? <div className="text-xs text-ink-500">incl. {formatPriceCompact(u.additionalCharges)} extra</div> : null}
                          </TD>
                          <TD>
                            <StatusBadge status={u.status} />
                            {u.status === 'RESERVED' && u.reservations[0] ? (
                              <div className="mt-1 text-[11px] text-ink-500">
                                {u.reservations[0].lead ? `${u.reservations[0].lead.name} · ` : ''}
                                {u.reservations[0].expiresAt ? `until ${formatRelative(u.reservations[0].expiresAt)}` : ''}
                              </div>
                            ) : null}
                            {u.status === 'ON_HOLD' && u.holdExpiresAt ? <div className="mt-1 text-[11px] text-ink-500">releases {formatRelative(u.holdExpiresAt)}</div> : null}
                          </TD>
                          <TD align="right">{actions(u)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                  <div className="border-t border-line px-4 py-3">
                    <Pagination page={page} totalPages={d.meta.totalPages} total={d.meta.total} pageSize={d.meta.pageSize} onPageChange={setPage} />
                  </div>
                </>
              )
            }
          </QueryState>
        )}
      </Card>

      {blockDialog ? <BlockDialog projectId={project.id} block={blockDialog} onClose={() => setBlockDialog(null)} onSaved={refresh} /> : null}
      {unitDialog ? <UnitDialog project={project} unit={unitDialog} onClose={() => setUnitDialog(null)} onSaved={refresh} /> : null}
      {bulk ? <BulkDialog project={project} onClose={() => setBulk(false)} onSaved={refresh} /> : null}
      {statusUnit ? <StatusDialog unit={statusUnit} onClose={() => setStatusUnit(null)} onSaved={refresh} /> : null}
      {reserveUnit ? <ReserveDialog unit={reserveUnit} project={project} onClose={() => setReserveUnit(null)} onSaved={refresh} /> : null}
      {historyUnit ? <HistoryDialog unit={historyUnit} onClose={() => setHistoryUnit(null)} /> : null}
      <ConfirmDialog open={Boolean(deleteUnit)} onOpenChange={(o) => !o && setDeleteUnit(null)} tone="danger" title={`Delete unit ${deleteUnit?.code}?`} description="Units with enquiries, reservations or bookings cannot be deleted — block them instead." confirmLabel="Delete" loading={removeUnit.isPending} onConfirm={() => deleteUnit && removeUnit.mutate(deleteUnit)} />
      <ConfirmDialog open={Boolean(deleteBlock)} onOpenChange={(o) => !o && setDeleteBlock(null)} tone="danger" title={`Delete ${deleteBlock?.name}?`} description="Only empty blocks can be deleted." confirmLabel="Delete" loading={removeBlock.isPending} onConfirm={() => deleteBlock && removeBlock.mutate(deleteBlock)} />
    </div>
  );
}
