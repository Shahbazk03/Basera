'use client';

import * as React from 'react';
import { enumLabel, formatArea, formatPriceCompact, type PublicUnit } from '@estate/shared';
import { Badge, Button, cn, Select } from '@estate/ui';
import { EnquiryDialog } from '@/components/enquiry/enquiry-dialog';

const PUBLIC_LABEL: Record<string, string> = {
  AVAILABLE: 'Available',
  ON_HOLD: 'On hold',
  RESERVED: 'Reserved',
  BOOKED: 'Booked',
  SOLD: 'Sold',
};
const TONE: Record<string, 'success' | 'warning' | 'info' | 'dark' | 'neutral'> = {
  AVAILABLE: 'success',
  ON_HOLD: 'warning',
  RESERVED: 'warning',
  BOOKED: 'info',
  SOLD: 'dark',
};

/** Live inventory table — statuses come straight from the sales system; only available units are enquirable. */
export function InventorySection({
  units,
  projectId,
  projectName,
  showPrices,
  showUnavailable,
  enquiriesOpen,
}: {
  units: PublicUnit[];
  projectId: string;
  projectName: string;
  showPrices: boolean;
  showUnavailable: boolean;
  enquiriesOpen: boolean;
}) {
  const [block, setBlock] = React.useState('');
  const [type, setType] = React.useState('');
  const [onlyAvailable, setOnlyAvailable] = React.useState(!showUnavailable);
  const [selected, setSelected] = React.useState<PublicUnit | null>(null);

  const blocks = [...new Set(units.map((u) => u.block).filter(Boolean))] as string[];
  const types = [...new Set(units.map((u) => u.configuration ?? enumLabel(u.unitType)))];
  const visible = units.filter(
    (u) => (!block || u.block === block) && (!type || (u.configuration ?? enumLabel(u.unitType)) === type) && (!onlyAvailable || u.status === 'AVAILABLE') && (showUnavailable || u.status === 'AVAILABLE'),
  );
  const available = units.filter((u) => u.status === 'AVAILABLE').length;
  const showPrice = (u: PublicUnit) => showPrices && u.totalPrice != null && u.status === 'AVAILABLE';

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="text-[15px] text-ink-600">
          <span className="font-semibold text-ink-900 tabular">{available}</span> of <span className="tabular">{units.length}</span> released units available right now
        </p>
        <div className="flex flex-wrap gap-2">
          {blocks.length > 1 ? (
            <div className="w-40">
              <Select value={block} onChange={(e) => setBlock(e.target.value)} aria-label="Filter by block">
                <option value="">All blocks</option>
                {blocks.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          {types.length > 1 ? (
            <div className="w-44">
              <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
                <option value="">All unit types</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          {showUnavailable ? (
            <div className="inline-flex rounded-lg bg-ink-100 p-1" role="radiogroup" aria-label="Availability">
              {[
                { v: false, l: 'All units' },
                { v: true, l: 'Available only' },
              ].map((o) => (
                <button
                  key={o.l}
                  type="button"
                  role="radio"
                  aria-checked={onlyAvailable === o.v}
                  onClick={() => setOnlyAvailable(o.v)}
                  className={cn('rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors', onlyAvailable === o.v ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-600 hover:text-ink-900')}
                >
                  {o.l}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {visible.length ? (
        <>
          {/* Desktop table */}
          <div className="mt-5 hidden overflow-hidden rounded-xl border border-line md:block">
            <table className="w-full text-left text-[14px]">
              <thead className="border-b border-line bg-ink-50/80 text-[12px] font-medium uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Unit</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Area</th>
                  <th className="px-4 py-3 font-medium">Facing</th>
                  {showPrices ? <th className="px-4 py-3 text-right font-medium">Price</th> : null}
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Enquire</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((u) => (
                  <tr key={u.id} className={cn(u.status !== 'AVAILABLE' && 'text-ink-400')}>
                    <td className="px-4 py-3">
                      <span className={cn('font-semibold tabular', u.status === 'AVAILABLE' ? 'text-ink-900' : 'text-ink-500')}>{u.code}</span>
                      {u.block ? <span className="block text-xs text-ink-500">{u.block}</span> : null}
                    </td>
                    <td className="px-4 py-3">
                      {u.configuration ?? enumLabel(u.unitType)}
                      {u.isCorner ? (
                        <Badge tone="brand" size="sm" className="ml-2">
                          Corner
                        </Badge>
                      ) : null}
                      {u.floorNumber != null ? <span className="block text-xs text-ink-500">Floor {u.floorNumber === 0 ? 'ground' : u.floorNumber}</span> : null}
                    </td>
                    <td className="px-4 py-3 tabular">
                      {formatArea(u.area, u.areaUnit)}
                      {u.dimensions ? <span className="block text-xs text-ink-500">{u.dimensions}</span> : null}
                    </td>
                    <td className="px-4 py-3">{u.facing ? enumLabel(u.facing) : '—'}</td>
                    {showPrices ? <td className="px-4 py-3 text-right font-semibold tabular text-ink-900">{showPrice(u) ? formatPriceCompact(u.totalPrice) : '—'}</td> : null}
                    <td className="px-4 py-3">
                      <Badge tone={TONE[u.status] ?? 'neutral'}>{PUBLIC_LABEL[u.status] ?? enumLabel(u.status)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {u.status === 'AVAILABLE' && enquiriesOpen ? (
                        <Button size="sm" variant="outline" onClick={() => setSelected(u)}>
                          Enquire
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="mt-5 grid gap-3 md:hidden">
            {visible.map((u) => (
              <li key={u.id} className="rounded-xl border border-line p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold tabular text-ink-900">
                      {u.code}
                      {u.block ? <span className="ml-1.5 text-xs font-normal text-ink-500">{u.block}</span> : null}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-600">
                      {u.configuration ?? enumLabel(u.unitType)} · {formatArea(u.area, u.areaUnit)}
                      {u.facing ? ` · ${enumLabel(u.facing)}` : ''}
                    </p>
                  </div>
                  <Badge tone={TONE[u.status] ?? 'neutral'}>{PUBLIC_LABEL[u.status] ?? enumLabel(u.status)}</Badge>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="font-semibold tabular text-ink-900">{showPrice(u) ? formatPriceCompact(u.totalPrice) : ''}</span>
                  {u.status === 'AVAILABLE' && enquiriesOpen ? (
                    <Button size="sm" variant="outline" onClick={() => setSelected(u)}>
                      Enquire
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-6 rounded-xl border border-dashed border-line px-5 py-8 text-center text-sm text-ink-500">{units.length ? 'No units match these filters.' : 'Inventory for this project has not been released yet. Register your interest and our team will contact you when it is.'}</p>
      )}
      {showPrices ? <p className="mt-3 text-xs text-ink-500">Prices include preferential location and listed additional charges; taxes and registration are extra. Final pricing is confirmed in writing at booking.</p> : null}

      {selected ? (
        <EnquiryDialog
          open
          onOpenChange={(o) => !o && setSelected(null)}
          type="UNIT_ENQUIRY"
          projectId={projectId}
          unitId={selected.id}
          subject={`${projectName} · unit ${selected.code}`}
        />
      ) : null}
    </div>
  );
}
