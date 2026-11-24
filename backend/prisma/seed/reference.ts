/**
 * Reference data required in EVERY environment (idempotent upserts):
 * permissions, system roles, platform organisation, geography, property types, amenities,
 * lead sources, feature flags and starter CMS structure.
 */
import { PERMISSIONS, PERMISSION_KEYS, resolveRolePermissions, slugify, SYSTEM_ROLES } from '@estate/shared';
import type { PrismaClient } from '@prisma/client';

const INDIAN_STATES: [string, string][] = [
  ['Andhra Pradesh', 'AP'], ['Arunachal Pradesh', 'AR'], ['Assam', 'AS'], ['Bihar', 'BR'], ['Chhattisgarh', 'CG'],
  ['Goa', 'GA'], ['Gujarat', 'GJ'], ['Haryana', 'HR'], ['Himachal Pradesh', 'HP'], ['Jharkhand', 'JH'],
  ['Karnataka', 'KA'], ['Kerala', 'KL'], ['Madhya Pradesh', 'MP'], ['Maharashtra', 'MH'], ['Manipur', 'MN'],
  ['Meghalaya', 'ML'], ['Mizoram', 'MZ'], ['Nagaland', 'NL'], ['Odisha', 'OD'], ['Punjab', 'PB'],
  ['Rajasthan', 'RJ'], ['Sikkim', 'SK'], ['Tamil Nadu', 'TN'], ['Telangana', 'TS'], ['Tripura', 'TR'],
  ['Uttar Pradesh', 'UP'], ['Uttarakhand', 'UK'], ['West Bengal', 'WB'], ['Andaman and Nicobar Islands', 'AN'],
  ['Chandigarh', 'CH'], ['Dadra and Nagar Haveli and Daman and Diu', 'DH'], ['Delhi', 'DL'],
  ['Jammu and Kashmir', 'JK'], ['Ladakh', 'LA'], ['Lakshadweep', 'LD'], ['Puducherry', 'PY'],
];

/** Uttar Pradesh cities; only Lucknow is active at launch (others are ready for expansion). */
const UP_CITIES: { name: string; lat: number; lng: number; active: boolean }[] = [
  { name: 'Lucknow', lat: 26.8467, lng: 80.9462, active: true },
  { name: 'Kanpur', lat: 26.4499, lng: 80.3319, active: false },
  { name: 'Noida', lat: 28.5355, lng: 77.391, active: false },
  { name: 'Ghaziabad', lat: 28.6692, lng: 77.4538, active: false },
  { name: 'Varanasi', lat: 25.3176, lng: 82.9739, active: false },
  { name: 'Prayagraj', lat: 25.4358, lng: 81.8463, active: false },
  { name: 'Agra', lat: 27.1767, lng: 78.0081, active: false },
  { name: 'Ayodhya', lat: 26.7922, lng: 82.1998, active: false },
];

/** Lucknow localities — approximate centroids; pincodes only where unambiguous. Editable in the console. */
export const LUCKNOW_LOCALITIES: { name: string; lat: number; lng: number; pincode?: string; popular?: boolean }[] = [
  { name: 'Gomti Nagar', lat: 26.856, lng: 81.0017, pincode: '226010', popular: true },
  { name: 'Gomti Nagar Extension', lat: 26.8173, lng: 81.0296, pincode: '226010', popular: true },
  { name: 'Hazratganj', lat: 26.8505, lng: 80.9461, pincode: '226001', popular: true },
  { name: 'Aliganj', lat: 26.8961, lng: 80.942, pincode: '226024', popular: true },
  { name: 'Indira Nagar', lat: 26.8737, lng: 80.9957, pincode: '226016', popular: true },
  { name: 'Mahanagar', lat: 26.8725, lng: 80.9611, pincode: '226006' },
  { name: 'Jankipuram', lat: 26.9264, lng: 80.9417, pincode: '226021', popular: true },
  { name: 'Vikas Nagar', lat: 26.893, lng: 80.955, pincode: '226022' },
  { name: 'Ashiyana', lat: 26.792, lng: 80.9136, pincode: '226012' },
  { name: 'Alambagh', lat: 26.8146, lng: 80.9035, pincode: '226005' },
  { name: 'Rajajipuram', lat: 26.8406, lng: 80.8803, pincode: '226017' },
  { name: 'Chinhat', lat: 26.8805, lng: 81.054, pincode: '226028' },
  { name: 'Sushant Golf City', lat: 26.7752, lng: 81.0093, pincode: '226030', popular: true },
  { name: 'Shaheed Path', lat: 26.7956, lng: 80.9997, popular: true },
  { name: 'Sultanpur Road', lat: 26.77, lng: 81.025, popular: true },
  { name: 'Raebareli Road', lat: 26.77, lng: 80.94 },
  { name: 'Faizabad Road', lat: 26.879, lng: 81.03 },
  { name: 'Kanpur Road', lat: 26.79, lng: 80.885 },
  { name: 'Sitapur Road', lat: 26.93, lng: 80.95 },
  { name: 'Kursi Road', lat: 26.938, lng: 80.995 },
  { name: 'IIM Road', lat: 26.93, lng: 80.905 },
  { name: 'Vrindavan Yojana', lat: 26.7715, lng: 80.948 },
  { name: 'Aminabad', lat: 26.847, lng: 80.927, pincode: '226018' },
  { name: 'Charbagh', lat: 26.832, lng: 80.92, pincode: '226004' },
  { name: 'Bakshi Ka Talab', lat: 27.01, lng: 80.93 },
  { name: 'Mohanlalganj', lat: 26.69, lng: 80.98 },
];

const PROPERTY_TYPES: { segment: 'RESIDENTIAL' | 'COMMERCIAL' | 'INDUSTRIAL' | 'AGRICULTURAL'; name: string; profile: string; rent: boolean; sale?: boolean }[] = [
  { segment: 'RESIDENTIAL', name: 'Residential Plot', profile: 'PLOT', rent: false },
  { segment: 'RESIDENTIAL', name: 'Apartment', profile: 'APARTMENT', rent: true },
  { segment: 'RESIDENTIAL', name: 'Flat / Builder Floor', profile: 'APARTMENT', rent: true },
  { segment: 'RESIDENTIAL', name: 'Independent House', profile: 'HOUSE', rent: true },
  { segment: 'RESIDENTIAL', name: 'Villa', profile: 'HOUSE', rent: true },
  { segment: 'RESIDENTIAL', name: 'Farmhouse', profile: 'HOUSE', rent: true },
  { segment: 'COMMERCIAL', name: 'Shop', profile: 'COMMERCIAL_UNIT', rent: true },
  { segment: 'COMMERCIAL', name: 'Office Space', profile: 'COMMERCIAL_UNIT', rent: true },
  { segment: 'COMMERCIAL', name: 'Showroom', profile: 'COMMERCIAL_UNIT', rent: true },
  { segment: 'COMMERCIAL', name: 'Commercial Building', profile: 'COMMERCIAL_BUILDING', rent: true },
  { segment: 'COMMERCIAL', name: 'Commercial Plot', profile: 'PLOT', rent: false },
  { segment: 'INDUSTRIAL', name: 'Industrial Land', profile: 'INDUSTRIAL', rent: true },
  { segment: 'INDUSTRIAL', name: 'Warehouse / Godown', profile: 'INDUSTRIAL', rent: true },
  { segment: 'INDUSTRIAL', name: 'Factory', profile: 'INDUSTRIAL', rent: true },
  { segment: 'AGRICULTURAL', name: 'Agricultural Land', profile: 'AGRICULTURAL', rent: true },
  { segment: 'AGRICULTURAL', name: 'Farm Plot', profile: 'AGRICULTURAL', rent: false },
];

const AMENITIES: { name: string; icon: string; category: string; property?: boolean; project?: boolean }[] = [
  { name: 'Lift', icon: 'lift', category: 'Building' },
  { name: 'Power Backup', icon: 'power', category: 'Utilities' },
  { name: '24x7 Security', icon: 'shield', category: 'Safety' },
  { name: 'CCTV Surveillance', icon: 'cctv', category: 'Safety' },
  { name: 'Gated Community', icon: 'gate', category: 'Safety' },
  { name: 'Fire Safety', icon: 'fire', category: 'Safety' },
  { name: 'Covered Parking', icon: 'parking', category: 'Building' },
  { name: 'Visitor Parking', icon: 'parking', category: 'Building' },
  { name: 'Intercom', icon: 'phone', category: 'Building' },
  { name: '24x7 Water Supply', icon: 'water', category: 'Utilities' },
  { name: 'Rainwater Harvesting', icon: 'rain', category: 'Utilities' },
  { name: 'Sewage Treatment Plant', icon: 'recycle', category: 'Utilities' },
  { name: 'Piped Gas', icon: 'flame', category: 'Utilities' },
  { name: 'Club House', icon: 'building', category: 'Lifestyle' },
  { name: 'Swimming Pool', icon: 'pool', category: 'Lifestyle' },
  { name: 'Gymnasium', icon: 'gym', category: 'Lifestyle' },
  { name: "Children's Play Area", icon: 'play', category: 'Lifestyle' },
  { name: 'Park / Garden', icon: 'tree', category: 'Lifestyle' },
  { name: 'Jogging Track', icon: 'run', category: 'Lifestyle' },
  { name: 'Community Hall', icon: 'users', category: 'Lifestyle' },
  { name: 'Indoor Games', icon: 'dice', category: 'Lifestyle' },
  { name: 'Vastu Compliant', icon: 'compass', category: 'General' },
  { name: 'Wide Internal Roads', icon: 'road', category: 'Infrastructure', property: false },
  { name: 'Street Lighting', icon: 'lamp', category: 'Infrastructure' },
  { name: 'Underground Drainage', icon: 'water', category: 'Infrastructure' },
  { name: 'Electricity Connection', icon: 'power', category: 'Utilities' },
  { name: 'Boundary Wall', icon: 'wall', category: 'Infrastructure' },
  { name: 'Conference Room', icon: 'presentation', category: 'Commercial' },
  { name: 'Cafeteria / Food Court', icon: 'coffee', category: 'Commercial' },
  { name: 'Loading Bay', icon: 'truck', category: 'Industrial' },
];

const LEAD_SOURCES: [string, string][] = [
  ['WEBSITE', 'Website'],
  ['PROPERTY_ENQUIRY', 'Property enquiry'],
  ['PROJECT_ENQUIRY', 'Project enquiry'],
  ['BROKER', 'Broker'],
  ['LEAD_PROVIDER', 'Lead provider'],
  ['CAMPAIGN', 'Marketing campaign'],
  ['WALK_IN', 'Walk-in'],
  ['PHONE', 'Phone'],
  ['WHATSAPP', 'WhatsApp'],
  ['MANUAL', 'Manual entry'],
];

const FEATURE_FLAGS: [string, boolean, string][] = [
  ['partner_self_registration', true, 'Brokers, developers and owners can register themselves (admin verification still required).'],
  ['lead_provider_self_registration', true, 'Lead providers can register themselves (admin activation required).'],
  ['auto_assign_leads', true, 'Automatically assign new leads using the configured assignment rules.'],
];

const HOME_SECTIONS: { type: string; title: string | null; subtitle: string | null; config?: Record<string, unknown> }[] = [
  { type: 'HERO_SEARCH', title: 'Find property in Lucknow you can trust', subtitle: 'Homes, plots, commercial spaces and new projects — listings are reviewed before they go live.' },
  { type: 'FEATURED_PROPERTIES', title: 'Featured properties', subtitle: 'Hand-picked listings across the city', config: { limit: 8 } },
  { type: 'POPULAR_LOCALITIES', title: 'Popular localities', subtitle: 'Explore the neighbourhoods buyers are searching most', config: { limit: 10 } },
  { type: 'FEATURED_PROJECTS', title: 'New projects', subtitle: 'Launches and ongoing projects with live inventory', config: { limit: 6 } },
  { type: 'RESIDENTIAL_PLOTS', title: 'Residential plots', subtitle: 'Plots in approved layouts and townships', config: { limit: 4 } },
  { type: 'COMMERCIAL', title: 'Commercial spaces', subtitle: 'Shops, offices and showrooms for sale and rent', config: { limit: 4 } },
  { type: 'RECENT_LISTINGS', title: 'Recently added', subtitle: null, config: { limit: 8 } },
  { type: 'VERIFIED_BROKERS', title: 'Verified brokers', subtitle: 'Partners whose business documents have been checked by our team', config: { limit: 6 } },
  {
    type: 'WHY_CHOOSE_US',
    title: 'Why buyers use us',
    subtitle: null,
    config: {
      points: [
        { title: 'Reviewed listings', text: 'Every listing is reviewed by our team before it is published, and verified listings are clearly marked.' },
        { title: 'Live project inventory', text: 'Project availability comes straight from the developer’s inventory, so sold units are never shown as available.' },
        { title: 'One point of contact', text: 'Every enquiry gets a reference number and a dedicated relationship manager who follows up.' },
        { title: 'Your data stays private', text: 'Your phone number is shared only with the seller or agent you enquire with — never sold.' },
      ],
    },
  },
  { type: 'ENQUIRY_CTA', title: 'Can’t find what you are looking for?', subtitle: 'Tell us your requirement and our team will shortlist options for you.' },
];

export async function seedReference(prisma: PrismaClient): Promise<{ platformOrgId: string; lucknowId: string; upStateId: string }> {
  // Permissions
  for (const key of PERMISSION_KEYS) {
    const def = PERMISSIONS[key];
    await prisma.permission.upsert({ where: { key }, create: { key, description: def.description, group: def.group }, update: { description: def.description, group: def.group } });
  }
  const permissionIds = new Map((await prisma.permission.findMany()).map((p) => [p.key, p.id]));

  // System roles (permissions re-synced every run)
  for (const def of SYSTEM_ROLES) {
    const role = await prisma.role.upsert({
      where: { key: def.key },
      create: { key: def.key, name: def.name, description: def.description, scope: def.scope, isSystem: true },
      update: { name: def.name, description: def.description, scope: def.scope, isSystem: true },
    });
    const wanted = resolveRolePermissions(def).map((k) => permissionIds.get(k)!).filter(Boolean);
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { notIn: wanted } } });
    const have = new Set((await prisma.rolePermission.findMany({ where: { roleId: role.id }, select: { permissionId: true } })).map((p) => p.permissionId));
    const missing = wanted.filter((permissionId) => !have.has(permissionId));
    if (missing.length) await prisma.rolePermission.createMany({ data: missing.map((permissionId) => ({ roleId: role.id, permissionId })) });
  }

  // Geography
  const india = await prisma.country.upsert({ where: { code: 'IN' }, create: { name: 'India', code: 'IN' }, update: {} });
  for (const [name, code] of INDIAN_STATES) {
    await prisma.state.upsert({
      where: { countryId_slug: { countryId: india.id, slug: slugify(name) } },
      create: { countryId: india.id, name, slug: slugify(name), code },
      update: { code },
    });
  }
  const up = await prisma.state.findUniqueOrThrow({ where: { countryId_slug: { countryId: india.id, slug: 'uttar-pradesh' } } });
  for (const [i, c] of UP_CITIES.entries()) {
    await prisma.city.upsert({
      where: { slug: slugify(c.name) },
      create: { stateId: up.id, name: c.name, slug: slugify(c.name), latitude: c.lat, longitude: c.lng, isActive: c.active, isFeatured: c.active, sortOrder: i },
      update: {},
    });
  }
  const lucknow = await prisma.city.findUniqueOrThrow({ where: { slug: 'lucknow' } });
  for (const l of LUCKNOW_LOCALITIES) {
    await prisma.locality.upsert({
      where: { cityId_slug: { cityId: lucknow.id, slug: slugify(l.name) } },
      create: { cityId: lucknow.id, name: l.name, slug: slugify(l.name), latitude: l.lat, longitude: l.lng, pincode: l.pincode ?? null, isPopular: Boolean(l.popular) },
      update: {},
    });
  }

  // Catalogue
  for (const [i, t] of PROPERTY_TYPES.entries()) {
    await prisma.propertyType.upsert({
      where: { slug: slugify(t.name) },
      create: { segment: t.segment, name: t.name, slug: slugify(t.name), formProfile: t.profile as never, allowRent: t.rent, allowSale: t.sale ?? true, sortOrder: i },
      update: {},
    });
  }
  for (const [i, a] of AMENITIES.entries()) {
    await prisma.amenity.upsert({
      where: { slug: slugify(a.name) },
      create: { name: a.name, slug: slugify(a.name), icon: a.icon, category: a.category, forProperties: a.property ?? true, forProjects: a.project ?? true, sortOrder: i },
      update: { icon: a.icon, category: a.category },
    });
  }
  for (const [key, name] of LEAD_SOURCES) {
    await prisma.leadSource.upsert({ where: { key }, create: { key, name, isSystem: true }, update: { name } });
  }
  for (const [key, enabled, description] of FEATURE_FLAGS) {
    await prisma.featureFlag.upsert({ where: { key }, create: { key, enabled, description }, update: { description } });
  }

  // Platform organisation (our company)
  let platform = await prisma.organization.findFirst({ where: { type: 'PLATFORM' } });
  if (!platform) {
    platform = await prisma.organization.create({
      data: { name: 'Basera', slug: 'basera', type: 'PLATFORM', status: 'ACTIVE', verificationStatus: 'VERIFIED', cityId: lucknow.id, projectPublishMode: 'DIRECT', showContactPublicly: true },
    });
  }

  // Homepage structure
  if ((await prisma.cmsSection.count({ where: { pageKey: 'home' } })) === 0) {
    await prisma.cmsSection.createMany({
      data: HOME_SECTIONS.map((s, i) => ({ pageKey: 'home', type: s.type, title: s.title, subtitle: s.subtitle, config: (s.config ?? {}) as object, sortOrder: i })),
    });
  }

  // Default expense categories for the platform organisation
  for (const name of ['Office rent', 'Marketing & advertising', 'Utilities', 'Travel & conveyance', 'Software & subscriptions', 'Legal & professional fees', 'Office supplies', 'Miscellaneous']) {
    await prisma.expenseCategory.upsert({ where: { organizationId_name: { organizationId: platform.id, name } }, create: { organizationId: platform.id, name }, update: {} });
  }

  return { platformOrgId: platform.id, lucknowId: lucknow.id, upStateId: up.id };
}
