import {
  availablePropertyActions,
  calculateCommission,
  calculateInvoiceTotals,
  calculatePayslip,
  canTransitionLead,
  canTransitionProject,
  canTransitionUnit,
  computeProjectStatus,
  countLeaveDays,
  findPropertyTransition,
  formatPriceCompact,
  grantsAllow,
  HostnameError,
  matchAssignmentRule,
  normalizeHostname,
  normalizePhone,
  pageSectionsSchema,
  defaultProjectPage,
  pickAssignee,
  platformSubdomainLabel,
  resolveRolePermissions,
  SYSTEM_ROLES,
  toSqft,
  validatePropertyForProfile,
  validateSubdomainLabel,
  workingDaysBetween,
} from './index';

describe('property validation', () => {
  it('requires bedrooms, furnishing, floor for apartments', () => {
    const issues = validatePropertyForProfile('APARTMENT', { bathrooms: 2, totalFloors: 10, possessionStatus: 'READY_TO_MOVE' }, 'SALE');
    const paths = issues.map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['bedrooms', 'furnishing', 'floorNumber']));
  });

  it('rejects residential fields on agricultural land', () => {
    const issues = validatePropertyForProfile('AGRICULTURAL', { ownershipType: 'FREEHOLD', bedrooms: 3 }, 'SALE');
    expect(issues).toEqual([expect.objectContaining({ path: 'bedrooms' })]);
  });

  it('validates profile attributes', () => {
    const issues = validatePropertyForProfile(
      'AGRICULTURAL',
      { ownershipType: 'FREEHOLD', attributes: { soilType: 'Lunar', foo: 1 } },
      'SALE',
    );
    expect(issues.map((i) => i.path)).toEqual(expect.arrayContaining(['attributes.soilType', 'attributes.foo']));
  });

  it('rejects floor above total floors and deposit on sale listings', () => {
    const issues = validatePropertyForProfile(
      'APARTMENT',
      { bedrooms: 2, bathrooms: 2, furnishing: 'UNFURNISHED', floorNumber: 12, totalFloors: 10, possessionStatus: 'READY_TO_MOVE', securityDeposit: 10000 },
      'SALE',
    );
    expect(issues.map((i) => i.path)).toEqual(expect.arrayContaining(['floorNumber', 'securityDeposit']));
  });

  it('normalises areas to square feet', () => {
    expect(toSqft(100, 'SQYD')).toBe(900);
    expect(toSqft(1, 'ACRE')).toBe(43560);
  });
});

describe('property lifecycle', () => {
  it('allows the lister to submit a draft but only reviewers to approve', () => {
    expect(findPropertyTransition('DRAFT', 'submit', 'SALE')?.to).toBe('PENDING_REVIEW');
    const listerActions = availablePropertyActions('PENDING_REVIEW', 'SALE', 'LISTER').map((t) => t.action);
    expect(listerActions).not.toContain('approve');
    const reviewerActions = availablePropertyActions('PENDING_REVIEW', 'SALE', 'REVIEWER').map((t) => t.action);
    expect(reviewerActions).toEqual(expect.arrayContaining(['approve', 'reject']));
  });

  it('only allows SOLD for sale listings and RENTED for rent listings', () => {
    expect(findPropertyTransition('PUBLISHED', 'mark_sold', 'SALE')).toBeDefined();
    expect(findPropertyTransition('PUBLISHED', 'mark_sold', 'RENT')).toBeUndefined();
    expect(findPropertyTransition('PUBLISHED', 'mark_rented', 'RENT')).toBeDefined();
  });

  it('does not allow publishing a rejected listing directly', () => {
    expect(findPropertyTransition('REJECTED', 'publish', 'SALE')).toBeUndefined();
  });
});

describe('project status', () => {
  const base = {
    status: 'UPCOMING' as const,
    autoStatus: true,
    bookingOpensAt: '2026-01-10T04:30:00Z',
    bookingClosesAt: '2026-02-10T04:30:00Z',
    closingSoonHours: 72,
    availableUnits: 10,
    releasedUnits: 20,
  };

  it('stays upcoming before booking opens', () => {
    expect(computeProjectStatus(base, new Date('2026-01-09T00:00:00Z'))).toBe('UPCOMING');
    expect(computeProjectStatus({ ...base, status: 'PRE_LAUNCH' }, new Date('2026-01-09T00:00:00Z'))).toBe('PRE_LAUNCH');
  });

  it('opens booking at the configured time and flags closing soon', () => {
    expect(computeProjectStatus(base, new Date('2026-01-10T04:30:00Z'))).toBe('BOOKING_OPEN');
    expect(computeProjectStatus(base, new Date('2026-02-08T00:00:00Z'))).toBe('CLOSING_SOON');
  });

  it('closes after the closing timestamp and sells out with no inventory', () => {
    expect(computeProjectStatus(base, new Date('2026-02-10T04:30:00Z'))).toBe('CLOSED');
    expect(computeProjectStatus({ ...base, availableUnits: 0 }, new Date('2026-01-15T00:00:00Z'))).toBe('SOLD_OUT');
  });

  it('never changes manual-only statuses or manual mode', () => {
    expect(computeProjectStatus({ ...base, status: 'DRAFT' }, new Date('2026-01-15T00:00:00Z'))).toBe('DRAFT');
    expect(computeProjectStatus({ ...base, autoStatus: false }, new Date('2026-01-15T00:00:00Z'))).toBe('UPCOMING');
  });

  it('validates manual transitions', () => {
    expect(canTransitionProject('DRAFT', 'BOOKING_OPEN')).toBe(true);
    expect(canTransitionProject('COMPLETED', 'BOOKING_OPEN')).toBe(false);
  });

  it('validates unit transitions', () => {
    expect(canTransitionUnit('AVAILABLE', 'RESERVED')).toBe(true);
    expect(canTransitionUnit('SOLD', 'AVAILABLE')).toBe(false);
  });
});

describe('domain mapping', () => {
  it('normalises hostnames', () => {
    expect(normalizeHostname('HTTPS://WWW.Green-Valley.in:443/path?x=1')).toBe('www.green-valley.in');
    expect(normalizeHostname('www.ग्रीन.भारत')).toMatch(/^www\.xn--/);
  });

  it('rejects invalid hostnames', () => {
    expect(() => normalizeHostname('localhost')).toThrow(HostnameError);
    expect(() => normalizeHostname('192.168.1.1')).toThrow(HostnameError);
    expect(() => normalizeHostname('bad_label.example.com')).toThrow(HostnameError);
    expect(() => normalizeHostname('user@evil.com')).toThrow(HostnameError);
  });

  it('extracts platform subdomain labels and protects reserved labels', () => {
    expect(platformSubdomainLabel('green-valley.brand.in', 'brand.in')).toBe('green-valley');
    expect(platformSubdomainLabel('a.b.brand.in', 'brand.in')).toBeNull();
    expect(platformSubdomainLabel('brand.in', 'brand.in')).toBeNull();
    expect(validateSubdomainLabel('admin')).toMatch(/reserved/);
    expect(validateSubdomainLabel('green-valley')).toBeNull();
  });
});

describe('lead assignment', () => {
  const candidates = [
    { userId: 'a', openLeads: 5 },
    { userId: 'b', openLeads: 2 },
    { userId: 'c', openLeads: 2 },
  ];

  it('rotates round robin after the last assignee', () => {
    expect(pickAssignee(candidates, 'ROUND_ROBIN', null)).toBe('a');
    expect(pickAssignee(candidates, 'ROUND_ROBIN', 'a')).toBe('b');
    expect(pickAssignee(candidates, 'ROUND_ROBIN', 'c')).toBe('a');
  });

  it('balances by workload and respects caps', () => {
    expect(pickAssignee(candidates, 'WORKLOAD', null)).toBe('b');
    expect(pickAssignee(candidates, 'WORKLOAD', 'b')).toBe('c');
    expect(pickAssignee(candidates, 'WORKLOAD', null, 2)).toBeNull();
  });

  it('matches the highest-priority rule whose conditions all hold', () => {
    const rules = [
      { id: 'generic', priority: 100, matchProjectId: null, matchCityIds: [], matchLocalityIds: [], matchSourceKeys: [], matchListingType: null },
      { id: 'project', priority: 10, matchProjectId: 'p1', matchCityIds: [], matchLocalityIds: [], matchSourceKeys: [], matchListingType: null },
      { id: 'gomti', priority: 20, matchProjectId: null, matchCityIds: [], matchLocalityIds: ['l1'], matchSourceKeys: [], matchListingType: 'SALE' },
    ];
    const facts = { projectId: null, cityId: 'c1', localityId: 'l1', sourceKey: 'WEBSITE', listingType: 'SALE' };
    expect(matchAssignmentRule(rules, facts)?.id).toBe('gomti');
    expect(matchAssignmentRule(rules, { ...facts, projectId: 'p1' })?.id).toBe('project');
    expect(matchAssignmentRule(rules, { ...facts, listingType: 'RENT' })?.id).toBe('generic');
  });

  it('enforces lead status transitions', () => {
    expect(canTransitionLead('NEW', 'CONTACTED')).toBe(true);
    expect(canTransitionLead('NEW', 'CONVERTED')).toBe(false);
    expect(canTransitionLead('CONVERTED', 'LOST')).toBe(false);
  });

  it('normalises Indian mobile numbers', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');
    expect(normalizePhone('09876543210')).toBe('+919876543210');
    expect(normalizePhone('919876543210')).toBe('+919876543210');
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('5876543210')).toBeNull();
  });
});

describe('commission calculation', () => {
  it('calculates percentage commission in paise precision', () => {
    expect(calculateCommission({ calcType: 'PERCENTAGE', value: 1.5 }, 4_567_890).amount).toBe(68518.35);
  });

  it('applies caps and minimums', () => {
    expect(calculateCommission({ calcType: 'PERCENTAGE', value: 2, maxPayout: 50000 }, 5_000_000).amount).toBe(50000);
    expect(calculateCommission({ calcType: 'FIXED', value: 25000, minDealValue: 1_000_000 }, 900_000).applicable).toBe(false);
  });

  it('computes invoice totals with per-line tax', () => {
    const t = calculateInvoiceTotals([
      { description: 'Brokerage', quantity: 1, unitPrice: 100000, taxRate: 18 },
      { description: 'Documentation', quantity: 2, unitPrice: 2500.5, taxRate: 0 },
    ]);
    expect(t.subtotal).toBe(105001);
    expect(t.taxTotal).toBe(18000);
    expect(t.total).toBe(123001);
  });
});

describe('payroll calculation', () => {
  const components = [
    { code: 'BASIC', name: 'Basic', type: 'EARNING' as const, calcType: 'FIXED' as const, value: 30000, prorate: true, sortOrder: 1 },
    { code: 'HRA', name: 'HRA', type: 'EARNING' as const, calcType: 'PERCENT_OF_BASIC' as const, value: 40, prorate: true, sortOrder: 2 },
    { code: 'PF', name: 'Provident fund', type: 'DEDUCTION' as const, calcType: 'PERCENT_OF_BASIC' as const, value: 12, maxAmount: 1800, prorate: true, sortOrder: 10 },
    { code: 'PT', name: 'Professional tax', type: 'DEDUCTION' as const, calcType: 'FIXED' as const, value: 200, prorate: false, sortOrder: 11 },
  ];

  it('computes a full month', () => {
    const r = calculatePayslip({ components, workingDays: 26, payableDays: 26, adjustments: [] });
    expect(r.grossEarnings).toBe(42000);
    expect(r.totalDeductions).toBe(2000); // PF capped at 1800 + PT 200
    expect(r.netPay).toBe(40000);
  });

  it('prorates for loss-of-pay days and adds incentives', () => {
    const r = calculatePayslip({
      components,
      workingDays: 26,
      payableDays: 24,
      adjustments: [{ type: 'INCENTIVE', amount: 5000, description: 'Sales incentive' }],
    });
    // Basic 30000*24/26 = 27692.31 ; HRA 12000*24/26 = 11076.92
    expect(r.lines.find((l) => l.componentCode === 'BASIC')?.amount).toBe(27692.31);
    expect(r.lines.find((l) => l.componentCode === 'HRA')?.amount).toBe(11076.92);
    expect(r.grossEarnings).toBe(43769.23);
    expect(r.netPay).toBe(43769.23 - 1800 - 200);
  });

  it('never produces negative net pay', () => {
    const r = calculatePayslip({
      components,
      workingDays: 26,
      payableDays: 0,
      adjustments: [{ type: 'DEDUCTION', amount: 1000, description: 'Recovery' }],
    });
    expect(r.netPay).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('leave and attendance calendar', () => {
  const cal = { weeklyOffDays: [0], holidays: ['2026-01-26'] };
  it('excludes weekly offs and holidays from leave days', () => {
    // 2026-01-24 (Sat) .. 2026-01-27 (Tue): Sat, Sun(off), Mon(holiday), Tue → 2 days
    expect(countLeaveDays('2026-01-24', '2026-01-27', cal)).toBe(2);
    expect(countLeaveDays('2026-01-27', '2026-01-27', cal, { halfDayStart: true })).toBe(0.5);
  });
  it('counts working days in a period', () => {
    expect(workingDaysBetween('2026-01-01', '2026-01-31', cal)).toBe(26);
  });
});

describe('permissions', () => {
  it('scopes organisation grants', () => {
    const grants = { global: [], byOrganization: { org1: ['property.edit' as const] } };
    expect(grantsAllow(grants, 'property.edit', 'org1')).toBe(true);
    expect(grantsAllow(grants, 'property.edit', 'org2')).toBe(false);
    expect(grantsAllow({ global: ['property.edit'], byOrganization: {} }, 'property.edit', 'org2')).toBe(true);
  });
  it('never grants role management to non-super-admin system roles', () => {
    for (const role of SYSTEM_ROLES.filter((r) => r.key !== 'SUPER_ADMIN')) {
      expect(resolveRolePermissions(role)).not.toContain('role.manage');
    }
  });
});

describe('page builder', () => {
  it('produces a valid default page and rejects unknown section types', () => {
    expect(pageSectionsSchema.safeParse(defaultProjectPage()).success).toBe(true);
    expect(pageSectionsSchema.safeParse([{ id: 'abcd1', type: 'SCRIPT', visible: true, data: {} }]).success).toBe(false);
  });
  it('rejects javascript: URLs in sections', () => {
    const bad = [{ id: 'abcd1', type: 'HERO', visible: true, data: { imageUrl: 'javascript:alert(1)' } }];
    expect(pageSectionsSchema.safeParse(bad).success).toBe(false);
  });
});

describe('formatting', () => {
  it('formats prices in lakh and crore', () => {
    expect(formatPriceCompact(4500000)).toBe('₹45 L');
    expect(formatPriceCompact(12500000)).toBe('₹1.25 Cr');
  });
});
