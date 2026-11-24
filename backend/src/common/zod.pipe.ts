import { BadRequestException, PipeTransform } from '@nestjs/common';
import { z } from 'zod';

export function zodIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
}

/** Validates and transforms a request body/query/param with a shared Zod schema. */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        code: 'VALIDATION_FAILED',
        details: zodIssues(result.error),
      });
    }
    return result.data;
  }
}

export const UuidParam = new ZodPipe(z.uuid({ error: 'Invalid identifier' }));

/**
 * PATCH validation: every field is optional, sent fields are validated, and ONLY the keys present in the
 * request are returned. Zod 4's `.partial()` still applies field defaults, which would silently reset
 * omitted fields (e.g. `isActive` → default) on a partial update. Object-level refinements are not applied
 * here — cross-field rules must be checked by the service against the merged record.
 */
export class PatchPipe<T extends z.ZodObject> implements PipeTransform<unknown, Partial<z.output<T>>> {
  private readonly partial: z.ZodType;

  /** `alreadyPartial`: the schema's fields are already optional — validate with it as given (keeping its refinements). */
  constructor(schema: T, opts: { alreadyPartial?: boolean } = {}) {
    this.partial = opts.alreadyPartial ? schema : z.object(schema.shape).partial();
  }

  transform(value: unknown): Partial<z.output<T>> {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const result = this.partial.safeParse(input);
    if (!result.success) throw new BadRequestException({ message: 'Validation failed', code: 'VALIDATION_FAILED', details: zodIssues(result.error) });
    const sent = new Set(Object.keys(input));
    return Object.fromEntries(Object.entries(result.data as Record<string, unknown>).filter(([k]) => sent.has(k))) as Partial<z.output<T>>;
  }
}
