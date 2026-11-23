'use client';

import * as React from 'react';
import { Checkbox, cn } from '@estate/ui';

export interface PermissionGroup {
  group: string;
  permissions: { key: string; description: string }[];
}

/** Grouped permission picker; read-only for system roles. */
export function PermissionMatrix({ catalog, value, onChange, readOnly }: { catalog: PermissionGroup[]; value: Set<string>; onChange?: (next: Set<string>) => void; readOnly?: boolean }) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {catalog.map((g) => {
        const all = g.permissions.every((p) => value.has(p.key));
        const some = g.permissions.some((p) => value.has(p.key));
        return (
          <fieldset key={g.group} className="rounded-lg border border-line">
            <legend className="sr-only">{g.group}</legend>
            <div className="flex items-center justify-between border-b border-line bg-ink-50/60 px-4 py-2.5">
              <span className="text-[13px] font-semibold text-ink-900">{g.group}</span>
              {!readOnly ? (
                <button
                  type="button"
                  className="text-xs font-medium text-brand hover:underline"
                  onClick={() => {
                    const next = new Set(value);
                    g.permissions.forEach((p) => (all ? next.delete(p.key) : next.add(p.key)));
                    onChange?.(next);
                  }}
                >
                  {all ? 'Clear group' : some ? 'Select all' : 'Select all'}
                </button>
              ) : null}
            </div>
            <ul className="divide-y divide-line">
              {g.permissions.map((p) => (
                <li key={p.key}>
                  <label className={cn('flex items-start gap-3 px-4 py-2.5', !readOnly && 'cursor-pointer hover:bg-ink-50/60')}>
                    <Checkbox
                      className="mt-0.5"
                      checked={value.has(p.key)}
                      disabled={readOnly}
                      onCheckedChange={(v) => {
                        const next = new Set(value);
                        if (v) next.add(p.key);
                        else next.delete(p.key);
                        onChange?.(next);
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block font-mono text-[12px] text-ink-900">{p.key}</span>
                      <span className="block text-xs text-ink-500">{p.description}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}
