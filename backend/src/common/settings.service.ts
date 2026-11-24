import { BadRequestException, Injectable } from '@nestjs/common';
import { PublicSettings, SETTING_SCHEMAS, SettingKey } from '@estate/shared';
import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Fallback values used only until an administrator saves a setting. Contact details default to
 * empty so the site never shows invented phone numbers or addresses.
 */
export const DEFAULT_SETTINGS: { [K in SettingKey]: unknown } = {
  'brand.name': 'Basera',
  'brand.tagline': 'Homes, plots and projects across Lucknow',
  'brand.logoUrl': null,
  'brand.primaryColor': '#0f766e',
  'contact.phone': '',
  'contact.whatsapp': '',
  'contact.email': '',
  'contact.address': '',
  'contact.hours': '',
  'company.legalName': '',
  'company.reraAgentNumber': '',
  'social.links': [],
  'marketplace.defaultCitySlug': 'lucknow',
  'listing.validityDays': 90,
  'listing.autoPublishOnApproval': true,
  'listing.requireReviewOnEdit': true,
  'leads.duplicateWindowDays': 30,
  'leads.followUpReminderMinutes': 30,
  'payroll.lopForUnmarkedDays': false,
  'payroll.requireMakerChecker': true,
  'subscriptions.enforceQuota': false,
  'seo.defaultTitle': 'Basera — Property for sale and rent in Lucknow',
  'seo.defaultDescription': 'Search verified homes, plots, commercial spaces and new projects in Lucknow.',
  'seo.sitemapEnabled': true,
  'seo.robotsAllowIndexing': true,
};

export const PUBLIC_SETTING_KEYS: SettingKey[] = [
  'brand.name',
  'brand.tagline',
  'brand.logoUrl',
  'brand.primaryColor',
  'contact.phone',
  'contact.whatsapp',
  'contact.email',
  'contact.address',
  'contact.hours',
  'company.legalName',
  'company.reraAgentNumber',
  'social.links',
  'marketplace.defaultCitySlug',
  'seo.defaultTitle',
  'seo.defaultDescription',
  'seo.robotsAllowIndexing',
];

export const SETTING_GROUPS: Record<string, SettingKey[]> = {
  Brand: ['brand.name', 'brand.tagline', 'brand.logoUrl', 'brand.primaryColor'],
  Contact: ['contact.phone', 'contact.whatsapp', 'contact.email', 'contact.address', 'contact.hours'],
  Company: ['company.legalName', 'company.reraAgentNumber', 'social.links'],
  Marketplace: ['marketplace.defaultCitySlug', 'listing.validityDays', 'listing.autoPublishOnApproval', 'listing.requireReviewOnEdit', 'subscriptions.enforceQuota'],
  CRM: ['leads.duplicateWindowDays', 'leads.followUpReminderMinutes'],
  Payroll: ['payroll.lopForUnmarkedDays', 'payroll.requireMakerChecker'],
  SEO: ['seo.defaultTitle', 'seo.defaultDescription', 'seo.sitemapEnabled', 'seo.robotsAllowIndexing'],
};

@Injectable()
export class SettingsService {
  private cache: { values: Map<string, unknown>; expires: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async values(): Promise<Map<string, unknown>> {
    if (this.cache && this.cache.expires > Date.now()) return this.cache.values;
    const rows = await this.prisma.systemSetting.findMany();
    const values = new Map<string, unknown>(rows.map((r) => [r.key, r.value]));
    this.cache = { values, expires: Date.now() + 30_000 };
    return values;
  }

  async get<K extends SettingKey>(key: K): Promise<unknown> {
    const v = await this.values();
    return v.has(key) ? v.get(key) : DEFAULT_SETTINGS[key];
  }

  async getString(key: SettingKey): Promise<string> {
    const v = await this.get(key);
    return typeof v === 'string' ? v : String(v ?? '');
  }

  async getNumber(key: SettingKey): Promise<number> {
    return Number(await this.get(key));
  }

  async getBoolean(key: SettingKey): Promise<boolean> {
    return Boolean(await this.get(key));
  }

  async all(): Promise<Record<string, { value: unknown; isDefault: boolean; group: string }>> {
    const v = await this.values();
    const out: Record<string, { value: unknown; isDefault: boolean; group: string }> = {};
    for (const [group, keys] of Object.entries(SETTING_GROUPS)) {
      for (const key of keys) out[key] = { value: v.has(key) ? v.get(key) : DEFAULT_SETTINGS[key], isDefault: !v.has(key), group };
    }
    return out;
  }

  async set(key: string, value: unknown, userId: string | null): Promise<unknown> {
    if (!(key in SETTING_SCHEMAS)) throw new BadRequestException(`Unknown setting "${key}"`);
    const parsed = SETTING_SCHEMAS[key as SettingKey].safeParse(value);
    if (!parsed.success) throw new BadRequestException({ message: `Invalid value for ${key}`, details: parsed.error.issues.map((i) => ({ path: key, message: i.message })) });
    const group = Object.entries(SETTING_GROUPS).find(([, keys]) => keys.includes(key as SettingKey))?.[0] ?? 'General';
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: parsed.data as Prisma.InputJsonValue, group, isPublic: PUBLIC_SETTING_KEYS.includes(key as SettingKey), updatedById: userId },
      update: { value: parsed.data as Prisma.InputJsonValue, updatedById: userId },
    });
    this.cache = null;
    return parsed.data;
  }

  async publicSettings(): Promise<PublicSettings> {
    const g = (k: SettingKey) => this.get(k);
    const e = env();
    return {
      brand: {
        name: String(await g('brand.name')),
        tagline: String(await g('brand.tagline')),
        logoUrl: ((await g('brand.logoUrl')) as string | null) ?? null,
        primaryColor: String(await g('brand.primaryColor')),
      },
      contact: {
        phone: String(await g('contact.phone')),
        whatsapp: String(await g('contact.whatsapp')),
        email: String(await g('contact.email')),
        address: String(await g('contact.address')),
        hours: String(await g('contact.hours')),
      },
      company: { legalName: String(await g('company.legalName')), reraAgentNumber: String(await g('company.reraAgentNumber')) },
      social: ((await g('social.links')) as { label: string; url: string }[]) ?? [],
      marketplace: { defaultCitySlug: String(await g('marketplace.defaultCitySlug')) },
      seo: {
        defaultTitle: String(await g('seo.defaultTitle')),
        defaultDescription: String(await g('seo.defaultDescription')),
        robotsAllowIndexing: e.APP_ENV === 'production' && Boolean(await g('seo.robotsAllowIndexing')),
      },
      environment: e.APP_ENV,
      integrations: { maps: e.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY ? 'google' : 'osm', captcha: Boolean(e.TURNSTILE_SECRET_KEY) },
    };
  }

  invalidate(): void {
    this.cache = null;
  }
}
