import { z } from 'zod';

/**
 * Project microsite page builder. A page is an ordered array of typed sections. Each section's
 * `data` is validated against its own schema; rendering treats every string as plain text
 * (no HTML/JS is ever rendered from the database). Dynamic data (units, amenities, FAQs, media…)
 * is pulled live from the project's records — sections only hold presentation settings and copy.
 */

export const SECTION_TYPES = [
  'HERO',
  'OVERVIEW',
  'STATS',
  'GALLERY',
  'MASTER_PLAN',
  'INVENTORY',
  'AMENITIES',
  'MAP',
  'NEARBY',
  'DEVELOPER',
  'DOCUMENTS',
  'CONSTRUCTION_UPDATES',
  'FAQ',
  'TESTIMONIALS',
  'CONTACT',
  'CTA',
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export const CTA_ACTIONS = ['ENQUIRE', 'SITE_VISIT', 'CALLBACK', 'WHATSAPP', 'VIEW_INVENTORY'] as const;
export type CtaAction = (typeof CTA_ACTIONS)[number];

const text = (max: number) => z.string().trim().max(max);
const safeUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => /^https?:\/\//i.test(v) || v.startsWith('/'), 'Must be an http(s) URL or a site-relative path');

export const SECTION_DATA_SCHEMAS = {
  HERO: z.object({
    headline: text(120).optional(),
    subheadline: text(240).optional(),
    imageUrl: safeUrl.optional().or(z.literal('')),
    ctaLabel: text(40).default('Enquire now'),
    ctaAction: z.enum(CTA_ACTIONS).default('ENQUIRE'),
    showPrice: z.boolean().default(true),
    showStatus: z.boolean().default(true),
  }),
  OVERVIEW: z.object({
    heading: text(120).default('Project overview'),
    body: text(6000).optional(),
    highlights: z.array(text(160)).max(12).default([]),
  }),
  STATS: z.object({
    heading: text(120).optional(),
    items: z
      .array(z.object({ label: text(60).min(1), value: text(40).min(1) }))
      .max(8)
      .default([]),
  }),
  GALLERY: z.object({ heading: text(120).default('Gallery'), limit: z.number().int().min(1).max(60).default(24) }),
  MASTER_PLAN: z.object({ heading: text(120).default('Master plan'), description: text(2000).optional() }),
  INVENTORY: z.object({
    heading: text(120).default('Available inventory'),
    showPrices: z.boolean().default(true),
    showUnavailable: z.boolean().default(true),
  }),
  AMENITIES: z.object({ heading: text(120).default('Amenities') }),
  MAP: z.object({ heading: text(120).default('Location'), zoom: z.number().int().min(8).max(19).default(14) }),
  NEARBY: z.object({ heading: text(120).default('Nearby') }),
  DEVELOPER: z.object({ heading: text(120).default('About the developer') }),
  DOCUMENTS: z.object({ heading: text(120).default('Approvals & documents') }),
  CONSTRUCTION_UPDATES: z.object({ heading: text(120).default('Construction updates') }),
  FAQ: z.object({ heading: text(120).default('Frequently asked questions') }),
  TESTIMONIALS: z.object({
    heading: text(120).default('What buyers say'),
    items: z
      .array(z.object({ name: text(80).min(1), text: text(800).min(5), detail: text(80).optional() }))
      .max(12)
      .default([]),
  }),
  CONTACT: z.object({
    heading: text(120).default('Talk to our sales team'),
    body: text(600).optional(),
    showSiteVisit: z.boolean().default(true),
    showCallback: z.boolean().default(true),
  }),
  CTA: z.object({
    heading: text(120).min(1),
    body: text(400).optional(),
    buttonLabel: text(40).default('Enquire now'),
    action: z.enum(CTA_ACTIONS).default('ENQUIRE'),
  }),
} satisfies Record<SectionType, z.ZodType>;

export type SectionData<T extends SectionType> = z.output<(typeof SECTION_DATA_SCHEMAS)[T]>;

const sectionVariants = SECTION_TYPES.map((type) =>
  z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{4,40}$/),
    type: z.literal(type),
    visible: z.boolean().default(true),
    data: SECTION_DATA_SCHEMAS[type],
  }),
);

export const pageSectionSchema = z.discriminatedUnion('type', sectionVariants as unknown as [
  (typeof sectionVariants)[number],
  ...(typeof sectionVariants)[number][],
]);
export type PageSection = { id: string; type: SectionType; visible: boolean; data: Record<string, unknown> };

export const pageSectionsSchema = z
  .array(pageSectionSchema)
  .max(40)
  .superRefine((sections, ctx) => {
    const ids = new Set<string>();
    sections.forEach((s, i) => {
      if (ids.has(s.id)) ctx.addIssue({ code: 'custom', path: [i, 'id'], message: 'Duplicate section id' });
      ids.add(s.id);
    });
  });

export const SECTION_LABELS: Record<SectionType, string> = {
  HERO: 'Hero',
  OVERVIEW: 'Project overview',
  STATS: 'Key facts',
  GALLERY: 'Gallery',
  MASTER_PLAN: 'Master plan',
  INVENTORY: 'Unit inventory',
  AMENITIES: 'Amenities',
  MAP: 'Location map',
  NEARBY: 'Nearby places',
  DEVELOPER: 'Developer profile',
  DOCUMENTS: 'Legal documents',
  CONSTRUCTION_UPDATES: 'Construction updates',
  FAQ: 'FAQs',
  TESTIMONIALS: 'Testimonials',
  CONTACT: 'Contact form',
  CTA: 'Call to action',
};

let counter = 0;
export function newSectionId(): string {
  counter = (counter + 1) % 1_000_000;
  return `s${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function defaultSectionData<T extends SectionType>(type: T): SectionData<T> {
  if (type === 'CTA') return SECTION_DATA_SCHEMAS.CTA.parse({ heading: 'Book a site visit today' }) as SectionData<T>;
  return (SECTION_DATA_SCHEMAS[type] as z.ZodType).parse({}) as SectionData<T>;
}

/** Starting layout for every new project page. */
export function defaultProjectPage(): PageSection[] {
  const order: SectionType[] = [
    'HERO',
    'OVERVIEW',
    'GALLERY',
    'INVENTORY',
    'AMENITIES',
    'MASTER_PLAN',
    'MAP',
    'NEARBY',
    'CONSTRUCTION_UPDATES',
    'DEVELOPER',
    'DOCUMENTS',
    'FAQ',
    'CONTACT',
  ];
  return order.map((type) => ({ id: newSectionId(), type, visible: true, data: defaultSectionData(type) as Record<string, unknown> }));
}
