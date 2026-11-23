'use client';

import * as React from 'react';
import { Checkbox as CheckboxPrimitive, Label as LabelPrimitive, RadioGroup as RadioPrimitive, Switch as SwitchPrimitive } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';

const fieldBase =
  'w-full rounded-md border border-line-strong bg-surface text-[14px] text-ink-900 shadow-xs transition-[border-color,box-shadow] placeholder:text-ink-400 hover:border-ink-300 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand/15 disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-500 aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/15';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { leading?: React.ReactNode; trailing?: React.ReactNode }>(
  function Input({ className, leading, trailing, ...props }, ref) {
    if (!leading && !trailing) return <input ref={ref} className={cn(fieldBase, 'h-10 px-3', className)} {...props} />;
    return (
      <div className="relative flex items-center">
        {leading ? <span className="pointer-events-none absolute left-3 flex items-center text-ink-400 [&_svg]:size-4">{leading}</span> : null}
        <input ref={ref} className={cn(fieldBase, 'h-10 px-3', leading && 'pl-9', trailing && 'pr-10', className)} {...props} />
        {trailing ? <span className="absolute right-3 flex items-center text-ink-500 [&_svg]:size-4">{trailing}</span> : null}
      </div>
    );
  },
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, 'min-h-24 px-3 py-2.5 leading-relaxed', className)} {...props} />;
});

/** Native select styled to match the system (most reliable for forms, mobile and accessibility). */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { placeholder?: string }>(function Select(
  { className, children, placeholder, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(fieldBase, 'h-10 appearance-none pl-3 pr-9', className)} {...props}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
    </div>
  );
});

export const Label = React.forwardRef<React.ElementRef<typeof LabelPrimitive.Root>, React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>>(function Label(
  { className, ...props },
  ref,
) {
  return <LabelPrimitive.Root ref={ref} className={cn('text-[13px] font-medium text-ink-800', className)} {...props} />;
});

export interface FieldProps {
  label?: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Label + control + hint/error. Pass `aria-invalid` to the control when `error` is set. */
export function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? (
        <Label htmlFor={htmlFor}>
          {label}
          {required ? <span className="ml-0.5 text-danger" aria-hidden>*</span> : null}
        </Label>
      ) : null}
      {children}
      {error ? (
        <p className="text-[12.5px] text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

export const Checkbox = React.forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>>(function Checkbox(
  { className, ...props },
  ref,
) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        'peer grid size-[18px] shrink-0 place-items-center rounded-[5px] border border-line-strong bg-surface shadow-xs transition-colors hover:border-ink-400 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand/20 disabled:opacity-50 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-white',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-3.5" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});

export function CheckboxField({ id, label, description, ...props }: React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & { label: React.ReactNode; description?: React.ReactNode }) {
  const autoId = React.useId();
  const cid = id ?? autoId;
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox id={cid} className="mt-0.5" {...props} />
      <label htmlFor={cid} className="cursor-pointer select-none text-sm leading-snug text-ink-700">
        {label}
        {description ? <span className="mt-0.5 block text-[12.5px] text-ink-500">{description}</span> : null}
      </label>
    </div>
  );
}

export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(function Switch(
  { className, ...props },
  ref,
) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-ink-200 transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-brand',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-[18px] rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
});

export const RadioGroup = RadioPrimitive.Root;
export function RadioCard({ value, children, className }: { value: string; children: React.ReactNode; className?: string }) {
  return (
    <RadioPrimitive.Item
      value={value}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border border-line-strong bg-surface px-3.5 py-3 text-left text-sm text-ink-800 transition-colors hover:border-ink-300 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand/20 data-[state=checked]:border-brand data-[state=checked]:bg-brand-soft data-[state=checked]:text-ink-900',
        className,
      )}
    >
      {children}
    </RadioPrimitive.Item>
  );
}

/** Segmented single-choice control (e.g. Buy / Rent). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode }[];
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" className={cn('inline-flex rounded-lg bg-ink-100 p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md font-medium transition-all',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
            value === o.value ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-600 hover:text-ink-900',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
