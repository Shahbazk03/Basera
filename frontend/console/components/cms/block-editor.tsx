'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, Heading, Image as ImageIcon, Info, List, MessageCircleQuestion, Phone, Pilcrow, Plus, Trash2 } from 'lucide-react';
import type { CmsBlock } from '@estate/shared';
import { Button, Checkbox, Field, Input, Select, Textarea, cn } from '@estate/ui';
import { ImageInput } from './image-input';

export type BlockType = CmsBlock['type'];
export interface EditableBlock {
  key: string;
  block: CmsBlock;
}

let seq = 0;
export const withKeys = (blocks: CmsBlock[]): EditableBlock[] => blocks.map((block) => ({ key: `b${++seq}`, block }));

const BLOCKS: { type: BlockType; label: string; icon: React.ReactNode; make: () => CmsBlock }[] = [
  { type: 'HEADING', label: 'Heading', icon: <Heading />, make: () => ({ type: 'HEADING', text: '', level: 2 }) },
  { type: 'PARAGRAPH', label: 'Paragraph', icon: <Pilcrow />, make: () => ({ type: 'PARAGRAPH', text: '' }) },
  { type: 'LIST', label: 'List', icon: <List />, make: () => ({ type: 'LIST', ordered: false, items: [''] }) },
  { type: 'CALLOUT', label: 'Callout', icon: <Info />, make: () => ({ type: 'CALLOUT', tone: 'info', text: '' }) },
  { type: 'IMAGE', label: 'Image', icon: <ImageIcon />, make: () => ({ type: 'IMAGE', url: '', alt: '' }) },
  { type: 'FAQ_GROUP', label: 'FAQs', icon: <MessageCircleQuestion />, make: () => ({ type: 'FAQ_GROUP', category: '' }) },
  { type: 'CONTACT_CARD', label: 'Contact details', icon: <Phone />, make: () => ({ type: 'CONTACT_CARD' }) },
];
const labelOf = (t: BlockType) => BLOCKS.find((b) => b.type === t)?.label ?? t;

/**
 * Edits a page as an ordered list of typed blocks. Blocks are rendered on the website as plain text
 * (never HTML), so content editors cannot inject markup or scripts.
 */
export function BlockEditor({ value, onChange, errors, faqCategories }: { value: EditableBlock[]; onChange: (v: EditableBlock[]) => void; errors: Record<number, string>; faqCategories: string[] }) {
  const update = (i: number, block: CmsBlock) => onChange(value.map((b, j) => (j === i ? { ...b, block } : b)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const insert = (at: number, t: BlockType) => {
    const def = BLOCKS.find((b) => b.type === t)!;
    const next = [...value];
    next.splice(at, 0, { key: `b${++seq}`, block: def.make() });
    onChange(next);
  };
  return (
    <div className="grid gap-3">
      {value.length === 0 ? <p className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-ink-500">This page has no content yet. Add a block below.</p> : null}
      {value.map((b, i) => (
        <div key={b.key} className={cn('rounded-lg border bg-surface', errors[i] ? 'border-danger/60' : 'border-line')}>
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
            <span className="text-xs font-semibold tracking-wide text-ink-500 uppercase">{labelOf(b.block.type)}</span>
            <div className="flex gap-0.5">
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Move down" disabled={i === value.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${labelOf(b.block.type)} block`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </div>
          </div>
          <div className="p-3">
            <BlockFields block={b.block} onChange={(nb) => update(i, nb)} idPrefix={b.key} faqCategories={faqCategories} />
            {errors[i] ? <p className="mt-2 text-xs text-danger">{errors[i]}</p> : null}
          </div>
        </div>
      ))}
      <AddBlock onAdd={(t) => insert(value.length, t)} disabled={value.length >= 100} />
    </div>
  );
}

function AddBlock({ onAdd, disabled }: { onAdd: (t: BlockType) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-line-strong p-2">
      <span className="flex items-center gap-1 px-1 text-xs font-medium text-ink-500">
        <Plus className="size-3.5" /> Add
      </span>
      {BLOCKS.map((b) => (
        <Button key={b.type} type="button" size="xs" variant="ghost" disabled={disabled} onClick={() => onAdd(b.type)}>
          {b.icon} {b.label}
        </Button>
      ))}
    </div>
  );
}

function BlockFields({ block, onChange, idPrefix, faqCategories }: { block: CmsBlock; onChange: (b: CmsBlock) => void; idPrefix: string; faqCategories: string[] }) {
  switch (block.type) {
    case 'HEADING':
      return (
        <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
          <Input aria-label="Heading text" value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} className="font-semibold" />
          <Select aria-label="Heading size" value={block.level} onChange={(e) => onChange({ ...block, level: Number(e.target.value) as 2 | 3 })}>
            <option value={2}>Section</option>
            <option value={3}>Sub-section</option>
          </Select>
        </div>
      );
    case 'PARAGRAPH':
      return <Textarea aria-label="Paragraph text" rows={4} value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} />;
    case 'CALLOUT':
      return (
        <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
          <Textarea aria-label="Callout text" rows={2} value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} />
          <Select aria-label="Callout style" value={block.tone} onChange={(e) => onChange({ ...block, tone: e.target.value as 'info' | 'warning' })}>
            <option value="info">Information</option>
            <option value="warning">Important</option>
          </Select>
        </div>
      );
    case 'LIST':
      return (
        <div className="grid gap-2">
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <Checkbox checked={block.ordered} onCheckedChange={(v) => onChange({ ...block, ordered: v === true })} /> Numbered list
          </label>
          {block.items.map((item, j) => (
            <div key={j} className="flex gap-2">
              <span className="w-5 pt-2 text-right text-xs text-ink-400">{block.ordered ? `${j + 1}.` : '•'}</span>
              <Input aria-label={`List item ${j + 1}`} value={item} onChange={(e) => onChange({ ...block, items: block.items.map((x, k) => (k === j ? e.target.value : x)) })} />
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove item ${j + 1}`} disabled={block.items.length === 1} onClick={() => onChange({ ...block, items: block.items.filter((_, k) => k !== j) })}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button type="button" size="xs" variant="outline" className="w-fit" disabled={block.items.length >= 50} onClick={() => onChange({ ...block, items: [...block.items, ''] })}>
            <Plus /> Item
          </Button>
        </div>
      );
    case 'IMAGE':
      return (
        <div className="grid gap-3">
          <ImageInput id={`${idPrefix}-url`} value={block.url} onChange={(url) => onChange({ ...block, url })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Description for screen readers" htmlFor={`${idPrefix}-alt`} required>
              <Input id={`${idPrefix}-alt`} value={block.alt} onChange={(e) => onChange({ ...block, alt: e.target.value })} />
            </Field>
            <Field label="Caption" htmlFor={`${idPrefix}-cap`}>
              <Input id={`${idPrefix}-cap`} value={block.caption ?? ''} onChange={(e) => onChange({ ...block, caption: e.target.value || undefined })} />
            </Field>
          </div>
        </div>
      );
    case 'FAQ_GROUP':
      return (
        <Field label="FAQ category" htmlFor={`${idPrefix}-faq`} hint="Shows the published FAQs in this category (manage them under FAQs & SEO).">
          <Select id={`${idPrefix}-faq`} value={block.category} onChange={(e) => onChange({ ...block, category: e.target.value })}>
            <option value="">Choose a category…</option>
            {faqCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {block.category && !faqCategories.includes(block.category) ? <option value={block.category}>{block.category} (no FAQs yet)</option> : null}
          </Select>
        </Field>
      );
    case 'CONTACT_CARD':
      return <p className="text-sm text-ink-600">Shows the company phone, WhatsApp, email, address and hours from Settings. Empty values are hidden.</p>;
  }
}

/** Plain-text preview, matching how the website renders blocks. */
export function BlockPreview({ title, blocks }: { title: string; blocks: CmsBlock[] }) {
  return (
    <article className="grid gap-3 text-ink-800">
      <h1 className="text-2xl font-semibold text-ink-900">{title || 'Untitled page'}</h1>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'HEADING':
            return b.level === 2 ? (
              <h2 key={i} className="mt-2 text-lg font-semibold text-ink-900">
                {b.text}
              </h2>
            ) : (
              <h3 key={i} className="font-semibold text-ink-900">
                {b.text}
              </h3>
            );
          case 'PARAGRAPH':
            return (
              <p key={i} className="text-sm leading-relaxed whitespace-pre-line">
                {b.text}
              </p>
            );
          case 'LIST': {
            const Tag = b.ordered ? 'ol' : 'ul';
            return (
              <Tag key={i} className={cn('ml-5 grid gap-1 text-sm', b.ordered ? 'list-decimal' : 'list-disc')}>
                {b.items.map((it, j) => (
                  <li key={j}>{it}</li>
                ))}
              </Tag>
            );
          }
          case 'CALLOUT':
            return (
              <p key={i} className={cn('rounded-lg border px-4 py-3 text-sm', b.tone === 'warning' ? 'border-warning/40 bg-warning-soft' : 'border-brand/30 bg-brand-soft')}>
                {b.text}
              </p>
            );
          case 'IMAGE':
            return b.url ? (
              <figure key={i}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={b.url} alt={b.alt} className="max-h-72 rounded-lg object-cover" />
                {b.caption ? <figcaption className="mt-1 text-xs text-ink-500">{b.caption}</figcaption> : null}
              </figure>
            ) : null;
          case 'FAQ_GROUP':
            return (
              <p key={i} className="rounded-lg border border-dashed border-line-strong px-4 py-3 text-sm text-ink-500">
                FAQs: {b.category || '(no category chosen)'}
              </p>
            );
          case 'CONTACT_CARD':
            return (
              <p key={i} className="rounded-lg border border-dashed border-line-strong px-4 py-3 text-sm text-ink-500">
                Contact details from Settings
              </p>
            );
        }
      })}
    </article>
  );
}
