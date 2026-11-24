import { z } from 'zod';
import { CONTENT_STATUSES } from './enums';

/** CMS page content is a list of typed blocks — rendered as text, never as raw HTML. */
export const CMS_BLOCK_TYPES = ['HEADING', 'PARAGRAPH', 'LIST', 'CALLOUT', 'IMAGE', 'FAQ_GROUP', 'CONTACT_CARD'] as const;

const safeUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => /^https?:\/\//i.test(v) || v.startsWith('/'), 'Must be an http(s) URL or a site-relative path');

export const cmsBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('HEADING'), text: z.string().trim().min(1).max(200), level: z.union([z.literal(2), z.literal(3)]).default(2) }),
  z.object({ type: z.literal('PARAGRAPH'), text: z.string().trim().min(1).max(8000) }),
  z.object({ type: z.literal('LIST'), ordered: z.boolean().default(false), items: z.array(z.string().trim().min(1).max(500)).min(1).max(50) }),
  z.object({ type: z.literal('CALLOUT'), tone: z.enum(['info', 'warning']).default('info'), text: z.string().trim().min(1).max(1000) }),
  z.object({ type: z.literal('IMAGE'), url: safeUrl, alt: z.string().trim().min(1).max(200), caption: z.string().trim().max(300).optional() }),
  z.object({ type: z.literal('FAQ_GROUP'), category: z.string().trim().min(1).max(60) }),
  z.object({ type: z.literal('CONTACT_CARD') }),
]);
export type CmsBlock = z.infer<typeof cmsBlockSchema>;

export const cmsPageSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens')
    .max(80),
  title: z.string().trim().min(2).max(160),
  blocks: z.array(cmsBlockSchema).max(100),
  status: z.enum(CONTENT_STATUSES).default('DRAFT'),
  showInFooter: z.boolean().default(false),
  footerGroup: z.string().trim().max(40).optional().nullable(),
  seoTitle: z.string().trim().max(70).optional().nullable(),
  seoDescription: z.string().trim().max(170).optional().nullable(),
  canonicalUrl: z.url().optional().nullable().or(z.literal('')),
  ogImageUrl: safeUrl.optional().nullable().or(z.literal('')),
  noIndex: z.boolean().default(false),
});

/** Homepage sections the public site knows how to render. */
export const HOME_SECTION_TYPES = [
  'HERO_SEARCH',
  'FEATURED_PROPERTIES',
  'POPULAR_LOCALITIES',
  'FEATURED_PROJECTS',
  'RESIDENTIAL_PLOTS',
  'COMMERCIAL',
  'RECENT_LISTINGS',
  'VERIFIED_BROKERS',
  'WHY_CHOOSE_US',
  'ENQUIRY_CTA',
] as const;
export type HomeSectionType = (typeof HOME_SECTION_TYPES)[number];

export const homeSectionSchema = z.object({
  type: z.enum(HOME_SECTION_TYPES),
  title: z.string().trim().max(120).optional().nullable(),
  subtitle: z.string().trim().max(300).optional().nullable(),
  isVisible: z.boolean().default(true),
  config: z
    .object({
      limit: z.coerce.number().int().min(1).max(24).optional(),
      points: z.array(z.object({ title: z.string().trim().min(2).max(80), text: z.string().trim().min(2).max(300) })).max(6).optional(),
    })
    .default({}),
});

export const bannerSchema = z.object({
  placement: z.enum(['HOME_HERO', 'SEARCH_TOP', 'PROJECTS_TOP']),
  title: z.string().trim().min(2).max(120),
  subtitle: z.string().trim().max(240).optional().nullable(),
  imageUrl: safeUrl,
  linkUrl: safeUrl.optional().nullable().or(z.literal('')),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
  startsAt: z.iso.datetime({ offset: true }).optional().nullable(),
  endsAt: z.iso.datetime({ offset: true }).optional().nullable(),
});

export const faqSchema = z.object({
  category: z.string().trim().min(2).max(60).default('General'),
  question: z.string().trim().min(5).max(300),
  answer: z.string().trim().min(2).max(4000),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  isPublished: z.boolean().default(true),
});

export const seoOverrideSchema = z.object({
  path: z.string().trim().startsWith('/').max(300),
  title: z.string().trim().max(70).optional().nullable(),
  description: z.string().trim().max(170).optional().nullable(),
  canonicalUrl: z.url().optional().nullable().or(z.literal('')),
  ogImageUrl: safeUrl.optional().nullable().or(z.literal('')),
  noIndex: z.boolean().default(false),
});

/** System settings editable from the admin panel. Values are validated per key. */
export const SETTING_SCHEMAS = {
  'brand.name': z.string().trim().min(2).max(60),
  'brand.tagline': z.string().trim().max(160),
  'brand.logoUrl': z.string().trim().max(2000).nullable(),
  'brand.primaryColor': z.string().regex(/^#[0-9a-fA-F]{6}$/),
  'contact.phone': z.string().trim().max(20),
  'contact.whatsapp': z.string().trim().max(20),
  'contact.email': z.email(),
  'contact.address': z.string().trim().max(300),
  'contact.hours': z.string().trim().max(120),
  'company.legalName': z.string().trim().max(200),
  'company.reraAgentNumber': z.string().trim().max(80),
  'social.links': z.array(z.object({ label: z.string().max(40), url: z.url() })).max(10),
  'marketplace.defaultCitySlug': z.string().trim().max(80),
  'listing.validityDays': z.coerce.number().int().min(7).max(730),
  'listing.autoPublishOnApproval': z.boolean(),
  'listing.requireReviewOnEdit': z.boolean(),
  'leads.duplicateWindowDays': z.coerce.number().int().min(1).max(365),
  'leads.followUpReminderMinutes': z.coerce.number().int().min(5).max(1440),
  'payroll.lopForUnmarkedDays': z.boolean(),
  'payroll.requireMakerChecker': z.boolean(),
  'subscriptions.enforceQuota': z.boolean(),
  'seo.defaultTitle': z.string().trim().max(70),
  'seo.defaultDescription': z.string().trim().max(170),
  'seo.sitemapEnabled': z.boolean(),
  'seo.robotsAllowIndexing': z.boolean(),
} as const;
export type SettingKey = keyof typeof SETTING_SCHEMAS;
