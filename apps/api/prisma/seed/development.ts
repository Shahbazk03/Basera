/**
 * DEVELOPMENT / DEMO DATA ONLY.
 * Every organisation, listing, project, lead and customer created here is flagged `isDemo = true`
 * and shown with a "Demo" badge in the UI. All accounts use the reserved example.com domain.
 * This module refuses to run when APP_ENV=production.
 */
import { hash } from '@node-rs/argon2';
import { defaultProjectPage, slugify, toSqft } from '@estate/shared';
import type { Prisma, PrismaClient } from '../../src/generated/prisma/client';

type Ref = { platformOrgId: string; lucknowId: string; upStateId: string };

const U = (id: string, w = 1600) => `https://images.unsplash.com/${id}?w=${w}&q=80&auto=format&fit=crop`;
const IMG = {
  villaPool: 'photo-1600596542815-ffad4c1539a9',
  modernHouseDusk: 'photo-1600585154340-be6161a56a0c',
  whiteVilla: 'photo-1512917774080-9991f1c4c750',
  villaGarden: 'photo-1564013799919-ab600027ffc6',
  classicHouse: 'photo-1570129477492-45c003edd2be',
  houseEvening: 'photo-1568605114967-8130f3a36994',
  livingPlants: 'photo-1502672260266-1c1ef2d93688',
  livingBright: 'photo-1522708323590-d24dbb6b0267',
  livingDining: 'photo-1560448204-e02f11c3d0e2',
  apartmentFacade: 'photo-1545324418-cc1a3fa10c00',
  officeTowers: 'photo-1486406146926-c627a92ad1ab',
  officeInterior: 'photo-1497366216548-37526070297c',
  farmland: 'photo-1500382017468-9049fed747ef',
  modernVilla: 'photo-1580587771525-78b9dba3b914',
  villaPool2: 'photo-1613490493576-7fde63acd811',
  livingModern: 'photo-1600607687939-ce8a6c25118c',
  houseTimber: 'photo-1600566753190-17f0baa2a6c3',
  kitchen: 'photo-1484154218962-a197022b5858',
  livingBlue: 'photo-1493809842364-78817add7ffb',
  livingYellow: 'photo-1586023492125-27b2c045efd7',
  brickHouse: 'photo-1449844908441-8829872d2607',
  apartmentBalconies: 'photo-1460317442991-0ec209397118',
  apartmentBlock: 'photo-1574362848149-11496d93a7c7',
  highrises: 'photo-1582407947304-fd86f028f716',
  suburbanHouse: 'photo-1605276374104-dee2a0ed3cd6',
  resortPool: 'photo-1416331108676-a22ccb276e35',
  houseLawn: 'photo-1558036117-15d82a90b9b1',
  modernFacade: 'photo-1600047509807-ba8f99d2cdde',
  villaInterior: 'photo-1600573472550-8090b5e0745e',
  livingLuxury: 'photo-1600210492486-724fe5c67fb0',
  bedroom: 'photo-1616594039964-ae9021a400a0',
  officeFloor: 'photo-1497366811353-6870744d04b2',
  retailShop: 'photo-1441986300917-64674bd600d8',
  warehouse: 'photo-1586528116311-ad8dd3c8310d',
  porchHouse: 'photo-1625602812206-5ec545ca1231',
  redHouse: 'photo-1628624747186-a941c476b7ef',
  township: 'photo-1592595896551-12b371d546d5',
  loftInterior: 'photo-1590725140246-20acdee442be',
  aerialPlots: 'photo-1524813686514-a57563d77965',
} as const;
type ImgKey = keyof typeof IMG;

const DAY = 86_400_000;
const now = new Date();
const daysAgo = (d: number, hour = 11) => {
  const t = new Date(now.getTime() - d * DAY);
  t.setUTCHours(hour - 5, 30, 0, 0); // IST hour
  return t;
};
const daysAhead = (d: number, hour = 11) => daysAgo(-d, hour);
const dateOnly = (d: Date) => new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);

let refCounter = 0;
const ALPH = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function demoCode(prefix: string): string {
  refCounter += 1;
  let n = refCounter * 7919 + 104729;
  let s = '';
  for (let i = 0; i < 6; i += 1) {
    s += ALPH[n % ALPH.length];
    n = Math.floor(n / ALPH.length) + i * 13;
  }
  return `${prefix}-${s}`;
}

async function nextRef(prisma: PrismaClient, prefix: string, at: Date = now): Promise<string> {
  const key = `${prefix}-${at.getUTCFullYear()}`;
  const rows = await prisma.$queryRaw<{ value: number }[]>`
    INSERT INTO "reference_counters" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "reference_counters"."value" + 1 RETURNING "value"`;
  return `${key}-${String(rows[0].value).padStart(6, '0')}`;
}

export async function seedDevelopment(prisma: PrismaClient, ref: Ref): Promise<void> {
  if ((process.env.APP_ENV ?? 'local') === 'production') throw new Error('Refusing to seed demo data in production');
  const password = process.env.SEED_DEFAULT_PASSWORD;
  if (!password || password.startsWith('replace-with') || password.length < 10) {
    throw new Error('Set SEED_DEFAULT_PASSWORD (min 10 chars) in .env before seeding development data');
  }
  if (await prisma.user.findUnique({ where: { email: 'superadmin@example.com' } })) {
    console.log('  • Development data already present — skipping (run `npm run db:reset` for a fresh database)');
    return;
  }

  const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const roleIds = new Map((await prisma.role.findMany()).map((r) => [r.key, r.id]));
  const typeBySlug = new Map((await prisma.propertyType.findMany()).map((t) => [t.slug, t]));
  const loc = new Map((await prisma.locality.findMany({ where: { cityId: ref.lucknowId } })).map((l) => [l.slug, l]));
  const amenityBySlug = new Map((await prisma.amenity.findMany()).map((a) => [a.slug, a.id]));
  const sourceByKey = new Map((await prisma.leadSource.findMany()).map((s) => [s.key, s.id]));
  const platform = ref.platformOrgId;
  const L = (slug: string) => {
    const l = loc.get(slug);
    if (!l) throw new Error(`Unknown locality ${slug}`);
    return l;
  };

  // ───────────── Users ─────────────
  async function user(email: string, fullName: string, accountType: Prisma.UserCreateInput['accountType'], phone?: string) {
    return prisma.user.create({ data: { email, fullName, accountType, phone: phone ?? null, passwordHash, emailVerifiedAt: now, isDemo: true } });
  }
  async function grant(userId: string, roleKey: string, organizationId: string | null) {
    await prisma.userRole.create({ data: { userId, roleId: roleIds.get(roleKey)!, organizationId } });
  }
  async function member(userId: string, organizationId: string, title: string, isOwner = false) {
    await prisma.organizationMember.create({ data: { userId, organizationId, title, isOwner } });
  }

  const superAdmin = await user('superadmin@example.com', 'Aditya Rao', 'STAFF');
  const admin = await user('admin@example.com', 'Meera Kapoor', 'STAFF');
  const ops = await user('ops@example.com', 'Rahul Bhatnagar', 'STAFF');
  const brokerMgr = await user('partners@example.com', 'Sneha Dubey', 'STAFF');
  const support = await user('support@example.com', 'Imran Siddiqui', 'STAFF');
  const salesMgr = await user('sales.manager@example.com', 'Ankit Srivastava', 'STAFF');
  const sales1 = await user('sales1@example.com', 'Nikhil Shukla', 'STAFF');
  const sales2 = await user('sales2@example.com', 'Farah Naqvi', 'STAFF');
  const sales3 = await user('sales3@example.com', 'Deepak Maurya', 'STAFF');
  const hr = await user('hr@example.com', 'Ritika Bajpai', 'STAFF');
  const accounts = await user('accounts@example.com', 'Sanjay Khanna', 'STAFF');

  await grant(superAdmin.id, 'SUPER_ADMIN', null);
  await grant(admin.id, 'ADMIN', null);
  await grant(ops.id, 'OPERATIONS_MANAGER', null);
  await grant(brokerMgr.id, 'BROKER_MANAGER', null);
  await grant(support.id, 'CUSTOMER_SUPPORT', null);
  await grant(salesMgr.id, 'SALES_MANAGER', platform);
  for (const s of [sales1, sales2, sales3]) await grant(s.id, 'SALES_EXECUTIVE', platform);
  await grant(hr.id, 'HR_MANAGER', platform);
  await grant(accounts.id, 'ACCOUNTANT', platform);
  const staff = [superAdmin, admin, ops, brokerMgr, support, salesMgr, sales1, sales2, sales3, hr, accounts];
  for (const s of staff) await member(s.id, platform, 'Staff');

  // ───────────── HR structure ─────────────
  const dept = async (name: string, code: string) => prisma.department.create({ data: { organizationId: platform, name, code } });
  const dSales = await dept('Sales', 'SALES');
  const dHr = await dept('Human Resources', 'HR');
  const dFin = await dept('Finance & Accounts', 'FIN');
  const dOps = await dept('Operations', 'OPS');
  const dSup = await dept('Customer Support', 'SUP');
  const dMgmt = await dept('Management', 'MGMT');
  const desig = async (name: string, departmentId: string, level: number) => prisma.designation.create({ data: { organizationId: platform, name, departmentId, level } });
  const gDirector = await desig('Director', dMgmt.id, 5);
  const gSalesExec = await desig('Sales Executive', dSales.id, 1);
  const gSalesMgr = await desig('Sales Manager', dSales.id, 3);
  const gHrMgr = await desig('HR Manager', dHr.id, 3);
  const gAccountant = await desig('Accountant', dFin.id, 2);
  const gOpsMgr = await desig('Operations Manager', dOps.id, 3);
  const gPartnerMgr = await desig('Partner Relations Manager', dOps.id, 3);
  const gSupport = await desig('Support Executive', dSup.id, 1);

  const shift = await prisma.shift.create({
    data: { organizationId: platform, name: 'General Shift', startTime: '09:30', endTime: '18:30', graceMinutes: 15, fullDayMinutes: 480, halfDayMinutes: 240, weeklyOffDays: [0], isDefault: true },
  });
  for (const [date, name] of [['2026-01-26', 'Republic Day'], ['2026-08-15', 'Independence Day'], ['2026-10-02', 'Gandhi Jayanti'], ['2027-01-26', 'Republic Day']] as const) {
    await prisma.holiday.create({ data: { organizationId: platform, date: new Date(`${date}T00:00:00Z`), name } });
  }
  const ltCasual = await prisma.leaveType.create({ data: { organizationId: platform, name: 'Casual Leave', code: 'CL', isPaid: true, annualQuota: 12 } });
  const ltSick = await prisma.leaveType.create({ data: { organizationId: platform, name: 'Sick Leave', code: 'SL', isPaid: true, annualQuota: 8 } });
  const ltEarned = await prisma.leaveType.create({ data: { organizationId: platform, name: 'Earned Leave', code: 'EL', isPaid: true, annualQuota: 15, carryForward: true, maxCarryForward: 30, allowHalfDay: false } });
  const ltLwp = await prisma.leaveType.create({ data: { organizationId: platform, name: 'Leave Without Pay', code: 'LWP', isPaid: false, annualQuota: 0 } });

  const note = 'Development sample configuration — set values according to your payroll policy and professional advice.';
  const comp = (code: string, name: string, type: 'EARNING' | 'DEDUCTION', calcType: 'FIXED' | 'PERCENT_OF_BASIC' | 'PERCENT_OF_GROSS', sortOrder: number, extra: Partial<Prisma.SalaryComponentUncheckedCreateInput> = {}) =>
    prisma.salaryComponent.create({ data: { organizationId: platform, code, name, type, calcType, sortOrder, description: note, ...extra } });
  const cBasic = await comp('BASIC', 'Basic salary', 'EARNING', 'FIXED', 1);
  const cHra = await comp('HRA', 'House rent allowance', 'EARNING', 'PERCENT_OF_BASIC', 2, { defaultValue: 40 });
  const cSpecial = await comp('SPECIAL', 'Special allowance', 'EARNING', 'FIXED', 3);
  const cConv = await comp('CONVEYANCE', 'Conveyance allowance', 'EARNING', 'FIXED', 4, { prorateByAttendance: false });
  const cPf = await comp('PF_EMP', 'Provident fund (employee)', 'DEDUCTION', 'PERCENT_OF_BASIC', 10, { defaultValue: 12, maxAmount: 1800, isStatutory: true });
  const cPt = await comp('PROF_TAX', 'Professional tax', 'DEDUCTION', 'FIXED', 11, { defaultValue: 0, isStatutory: true, prorateByAttendance: false, isActive: true });

  type EmpSpec = { u: { id: string }; code: string; dept: string; desig: string; basic: number; special: number; manager?: string; joined: string };
  const empSpecs: EmpSpec[] = [
    { u: admin, code: 'EMP001', dept: dMgmt.id, desig: gDirector.id, basic: 90000, special: 30000, joined: '2021-04-01' },
    { u: ops, code: 'EMP002', dept: dOps.id, desig: gOpsMgr.id, basic: 45000, special: 15000, joined: '2022-01-10' },
    { u: brokerMgr, code: 'EMP003', dept: dOps.id, desig: gPartnerMgr.id, basic: 38000, special: 12000, joined: '2022-06-15' },
    { u: salesMgr, code: 'EMP004', dept: dSales.id, desig: gSalesMgr.id, basic: 42000, special: 14000, joined: '2021-11-01' },
    { u: sales1, code: 'EMP005', dept: dSales.id, desig: gSalesExec.id, basic: 18000, special: 6000, joined: '2023-03-01' },
    { u: sales2, code: 'EMP006', dept: dSales.id, desig: gSalesExec.id, basic: 18000, special: 6000, joined: '2023-08-16' },
    { u: sales3, code: 'EMP007', dept: dSales.id, desig: gSalesExec.id, basic: 17000, special: 5000, joined: '2024-07-01' },
    { u: hr, code: 'EMP008', dept: dHr.id, desig: gHrMgr.id, basic: 36000, special: 12000, joined: '2022-02-01' },
    { u: accounts, code: 'EMP009', dept: dFin.id, desig: gAccountant.id, basic: 32000, special: 10000, joined: '2022-09-01' },
    { u: support, code: 'EMP010', dept: dSup.id, desig: gSupport.id, basic: 16000, special: 4000, joined: '2024-01-15' },
  ];
  const employees = new Map<string, { id: string; userId: string }>();
  for (const s of empSpecs) {
    const e = await prisma.employee.create({
      data: {
        organizationId: platform,
        userId: s.u.id,
        employeeCode: s.code,
        departmentId: s.dept,
        designationId: s.desig,
        shiftId: shift.id,
        joiningDate: new Date(`${s.joined}T00:00:00Z`),
        workLocation: 'Lucknow head office',
        isDemo: true,
      },
    });
    employees.set(s.u.id, { id: e.id, userId: s.u.id });
    await prisma.salaryStructure.create({
      data: {
        employeeId: e.id,
        effectiveFrom: new Date('2026-04-01T00:00:00Z'),
        createdById: hr.id,
        notes: 'Development sample structure',
        lines: {
          create: [
            { componentId: cBasic.id, value: s.basic },
            { componentId: cHra.id, value: 40 },
            { componentId: cSpecial.id, value: s.special },
            { componentId: cConv.id, value: 1600 },
            { componentId: cPf.id, value: 12 },
            { componentId: cPt.id, value: 0 },
          ],
        },
      },
    });
    for (const lt of [ltCasual, ltSick, ltEarned, ltLwp]) {
      await prisma.leaveBalance.create({ data: { employeeId: e.id, leaveTypeId: lt.id, year: 2026, allocated: lt.annualQuota } });
    }
  }
  // Reporting lines
  const emp = (u: { id: string }) => employees.get(u.id)!.id;
  for (const s of [sales1, sales2, sales3]) await prisma.employee.update({ where: { id: emp(s) }, data: { managerId: emp(salesMgr) } });
  for (const s of [ops, brokerMgr, salesMgr, hr, accounts]) await prisma.employee.update({ where: { id: emp(s) }, data: { managerId: emp(admin) } });
  await prisma.employee.update({ where: { id: emp(support) }, data: { managerId: emp(ops) } });

  // Attendance: October (full month) and November to date, Asia/Kolkata office hours.
  const holidays = new Set(['2026-10-02']);
  const attendanceDays: string[] = [];
  for (let d = new Date('2026-10-01T00:00:00Z'); d < dateOnly(now); d = new Date(d.getTime() + DAY)) attendanceDays.push(d.toISOString().slice(0, 10));
  let seq = 0;
  for (const [userId, { id: employeeId }] of employees) {
    for (const day of attendanceDays) {
      const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
      if (dow === 0 || holidays.has(day)) continue;
      seq += 1;
      const absent = seq % 37 === 0;
      if (absent) continue;
      const late = seq % 11 === 0;
      const half = seq % 29 === 0;
      const inMin = late ? 9 * 60 + 58 : 9 * 60 + 18 + (seq % 9);
      const work = half ? 270 : 515 + (seq % 25);
      const checkIn = new Date(`${day}T00:00:00Z`);
      checkIn.setUTCMinutes(inMin - 330);
      const checkOut = new Date(checkIn.getTime() + work * 60_000);
      await prisma.attendanceRecord.create({
        data: { employeeId, date: new Date(`${day}T00:00:00Z`), checkInAt: checkIn, checkOutAt: checkOut, status: half ? 'HALF_DAY' : 'PRESENT', isLate: late, workMinutes: work, source: 'SYSTEM', notes: 'Demo attendance' },
      });
    }
    void userId;
  }
  await prisma.leaveRequest.create({
    data: { employeeId: emp(sales2), leaveTypeId: ltCasual.id, startDate: new Date('2026-11-10T00:00:00Z'), endDate: new Date('2026-11-11T00:00:00Z'), days: 2, reason: 'Family function', status: 'APPROVED', approverId: salesMgr.id, decidedAt: daysAgo(20) },
  });
  await prisma.leaveBalance.update({ where: { employeeId_leaveTypeId_year: { employeeId: emp(sales2), leaveTypeId: ltCasual.id, year: 2026 } }, data: { used: 2 } });
  await prisma.leaveRequest.create({
    data: { employeeId: emp(sales3), leaveTypeId: ltSick.id, startDate: new Date(`${daysAhead(2).toISOString().slice(0, 10)}T00:00:00Z`), endDate: new Date(`${daysAhead(2).toISOString().slice(0, 10)}T00:00:00Z`), days: 1, reason: 'Medical appointment', status: 'PENDING' },
  });

  // ───────────── Partner organisations ─────────────
  async function partnerOrg(opts: { name: string; type: 'BROKERAGE' | 'DEVELOPER' | 'LEAD_PROVIDER' | 'INDIVIDUAL_OWNER'; verified: boolean; owner: { email: string; name: string; accountType: Prisma.UserCreateInput['accountType'] }; roleKey: string; description?: string; rera?: string; localitySlug: string; mode?: 'DIRECT' | 'REQUIRES_APPROVAL' }) {
    const ownerUser = await user(opts.owner.email, opts.owner.name, opts.owner.accountType);
    const org = await prisma.organization.create({
      data: {
        name: opts.name,
        slug: slugify(opts.name),
        type: opts.type,
        status: opts.verified ? 'ACTIVE' : 'PENDING',
        verificationStatus: opts.verified ? 'VERIFIED' : 'PENDING',
        email: opts.owner.email,
        description: opts.description ?? null,
        addressLine: `${L(opts.localitySlug).name}, Lucknow`,
        cityId: ref.lucknowId,
        reraRegistrationNo: opts.rera ?? null,
        verifiedAt: opts.verified ? daysAgo(120) : null,
        verifiedById: opts.verified ? brokerMgr.id : null,
        projectPublishMode: opts.mode ?? 'REQUIRES_APPROVAL',
        isDemo: true,
      },
    });
    await member(ownerUser.id, org.id, 'Owner', true);
    await grant(ownerUser.id, opts.roleKey, org.id);
    return { org, owner: ownerUser };
  }

  const b1 = await partnerOrg({
    name: 'Gomti Realty Advisors (Demo)',
    type: 'BROKERAGE',
    verified: true,
    owner: { email: 'broker1@example.com', name: 'Vivek Awasthi', accountType: 'BROKER' },
    roleKey: 'BROKER',
    description: 'Residential resale and rental specialists in Gomti Nagar and nearby localities. (Demo organisation)',
    rera: 'DEMO-UPRERA-AGT-0001',
    localitySlug: 'gomti-nagar',
  });
  const b2 = await partnerOrg({
    name: 'Awadh Property Consultants (Demo)',
    type: 'BROKERAGE',
    verified: true,
    owner: { email: 'broker2@example.com', name: 'Shabnam Rizvi', accountType: 'BROKER' },
    roleKey: 'BROKER',
    description: 'Plots, independent houses and commercial leasing across Lucknow. (Demo organisation)',
    rera: 'DEMO-UPRERA-AGT-0002',
    localitySlug: 'hazratganj',
  });
  const b3 = await partnerOrg({
    name: 'Riverside Estates (Demo)',
    type: 'BROKERAGE',
    verified: false,
    owner: { email: 'broker3@example.com', name: 'Harsh Vardhan Tripathi', accountType: 'BROKER' },
    roleKey: 'BROKER',
    description: 'Newly registered brokerage awaiting verification. (Demo organisation)',
    localitySlug: 'aliganj',
  });
  const agent = await user('agent1@example.com', 'Karan Mehrotra', 'BROKER');
  await member(agent.id, b1.org.id, 'Sales Agent');
  await grant(agent.id, 'BROKER_AGENT', b1.org.id);
  for (const [b, years] of [[b1, 12], [b2, 9], [b3, 3]] as const) {
    await prisma.brokerProfile.create({
      data: {
        userId: b.owner.id,
        organizationId: b.org.id,
        displayName: b.owner.fullName,
        reraAgentNumber: b.org.reraRegistrationNo,
        experienceYears: years,
        languages: ['Hindi', 'English'],
        specializations: ['Residential resale', 'Rentals'],
        verificationStatus: b.org.verificationStatus,
        isFeatured: b !== b3,
        isDemo: true,
      },
    });
  }
  await prisma.brokerProfile.create({ data: { userId: agent.id, organizationId: b1.org.id, displayName: agent.fullName, experienceYears: 4, languages: ['Hindi', 'English'], verificationStatus: 'VERIFIED', isDemo: true } });

  const d1 = await partnerOrg({
    name: 'Northgate Developers (Demo)',
    type: 'DEVELOPER',
    verified: true,
    owner: { email: 'developer1@example.com', name: 'Rajeev Malhotra', accountType: 'DEVELOPER' },
    roleKey: 'DEVELOPER',
    description: 'Plotted townships and commercial developments in Lucknow. (Demo organisation)',
    rera: 'DEMO-UPRERA-PRM-0101',
    localitySlug: 'sultanpur-road',
  });
  const d2 = await partnerOrg({
    name: 'Lakeview Infra (Demo)',
    type: 'DEVELOPER',
    verified: true,
    owner: { email: 'developer2@example.com', name: 'Sunita Chawla', accountType: 'DEVELOPER' },
    roleKey: 'DEVELOPER',
    description: 'Mid-rise and high-rise residential apartments. (Demo organisation)',
    rera: 'DEMO-UPRERA-PRM-0102',
    localitySlug: 'gomti-nagar-extension',
    mode: 'REQUIRES_APPROVAL',
  });
  await prisma.developerProfile.create({ data: { organizationId: d1.org.id, establishedYear: 2009, about: 'Demo developer profile.' } });
  await prisma.developerProfile.create({ data: { organizationId: d2.org.id, establishedYear: 2014, about: 'Demo developer profile.' } });

  const lp = await partnerOrg({
    name: 'LeadStream Partners (Demo)',
    type: 'LEAD_PROVIDER',
    verified: true,
    owner: { email: 'leads@example.com', name: 'Gaurav Sinha', accountType: 'LEAD_PROVIDER' },
    roleKey: 'LEAD_PROVIDER',
    localitySlug: 'hazratganj',
  });
  const leadProvider = await prisma.leadProvider.create({ data: { organizationId: lp.org.id, name: lp.org.name, contactName: 'Gaurav Sinha', email: 'leads@example.com', duplicateWindowDays: 60 } });

  const ow = await partnerOrg({
    name: 'Alok Saxena',
    type: 'INDIVIDUAL_OWNER',
    verified: true,
    owner: { email: 'owner@example.com', name: 'Alok Saxena', accountType: 'OWNER' },
    roleKey: 'OWNER',
    localitySlug: 'mahanagar',
  });
  const customerUser = await user('customer@example.com', 'Ishita Varma', 'CUSTOMER');

  // Subscription plans (prices are demo values configurable by admin)
  const planBasic = await prisma.subscriptionPlan.create({ data: { code: 'BROKER_STARTER', name: 'Starter (Demo)', price: 2999, billingPeriod: 'MONTHLY', listingQuota: 15, featuredQuota: 1, features: ['15 active listings', '1 featured listing', 'Lead dashboard'], sortOrder: 1 } });
  await prisma.subscriptionPlan.create({ data: { code: 'BROKER_PRO', name: 'Professional (Demo)', price: 7999, billingPeriod: 'MONTHLY', listingQuota: 60, featuredQuota: 5, features: ['60 active listings', '5 featured listings', 'Team members'], sortOrder: 2 } });
  await prisma.organizationSubscription.create({ data: { organizationId: b1.org.id, planId: planBasic.id, status: 'ACTIVE', startsAt: daysAgo(40), endsAt: daysAhead(325), amount: 2999, paymentReference: 'DEMO-PAY-0001', createdById: brokerMgr.id } });

  // ───────────── Properties ─────────────
  type Spec = {
    title: string;
    type: string;
    listing: 'SALE' | 'RENT';
    locality: string;
    price: number;
    area: number;
    unit: 'SQFT' | 'SQYD' | 'ACRE';
    org: { id: string };
    by: { id: string };
    source: 'COMPANY' | 'BROKER' | 'DEVELOPER' | 'OWNER';
    images: ImgKey[];
    status?: 'PUBLISHED' | 'PENDING_REVIEW' | 'DRAFT' | 'SOLD';
    featured?: boolean;
    verified?: boolean;
    fields?: Partial<Prisma.PropertyUncheckedCreateInput>;
    attributes?: Record<string, string | number | boolean>;
    amenities?: string[];
    highlights?: string[];
    age?: number;
  };
  const apartmentAmenities = ['lift', 'power-backup', '24x7-security', 'cctv-surveillance', 'covered-parking', 'park-garden', 'childrens-play-area', '24x7-water-supply'];
  const specs: Spec[] = [
    { title: '3 BHK apartment with park view in Gomti Nagar', type: 'apartment', listing: 'SALE', locality: 'gomti-nagar', price: 11500000, area: 1650, unit: 'SQFT', org: b1.org, by: b1.owner, source: 'BROKER', images: ['livingBright', 'livingModern', 'kitchen', 'bedroom'], featured: true, verified: true, fields: { bedrooms: 3, bathrooms: 3, balconies: 2, furnishing: 'SEMI_FURNISHED', floorNumber: 7, totalFloors: 12, facing: 'EAST', possessionStatus: 'READY_TO_MOVE', ageYears: 4, ownershipType: 'FREEHOLD', coveredParking: 1, superAreaSqft: 1650, carpetAreaSqft: 1220 }, attributes: { liftAvailable: true, powerBackup: 'Full', waterSupply: 'Both' }, amenities: [...apartmentAmenities, 'club-house', 'gymnasium'], highlights: ['Overlooks the society park', 'Modular kitchen', '5 minutes to the main market'] },
    { title: '2 BHK flat in Jankipuram Extension', type: 'flat-builder-floor', listing: 'SALE', locality: 'jankipuram', price: 4800000, area: 1050, unit: 'SQFT', org: ow.org, by: ow.owner, source: 'OWNER', images: ['livingBlue', 'livingPlants'], verified: false, fields: { bedrooms: 2, bathrooms: 2, balconies: 1, furnishing: 'UNFURNISHED', floorNumber: 2, totalFloors: 4, facing: 'NORTH', possessionStatus: 'READY_TO_MOVE', ageYears: 6, ownershipType: 'FREEHOLD', coveredParking: 1, builtUpAreaSqft: 1050 }, amenities: ['power-backup', 'covered-parking', '24x7-water-supply'] },
    { title: 'Independent 4 BHK house in Indira Nagar', type: 'independent-house', listing: 'SALE', locality: 'indira-nagar', price: 24000000, area: 2400, unit: 'SQFT', org: b2.org, by: b2.owner, source: 'BROKER', images: ['classicHouse', 'livingDining', 'kitchen'], featured: true, verified: true, fields: { bedrooms: 4, bathrooms: 4, balconies: 2, furnishing: 'SEMI_FURNISHED', totalFloors: 2, facing: 'EAST', possessionStatus: 'READY_TO_MOVE', ageYears: 9, roadWidthFt: 30, ownershipType: 'FREEHOLD', coveredParking: 2, builtUpAreaSqft: 2400, plotAreaSqft: 2000 }, attributes: { servantRoom: true, gardenOrLawn: true }, amenities: ['power-backup', 'covered-parking', '24x7-water-supply', 'vastu-compliant'], highlights: ['East facing on a 30 ft road', 'Separate servant room', 'Terrace garden'] },
    { title: 'Modern 5 BHK villa in Sushant Golf City', type: 'villa', listing: 'SALE', locality: 'sushant-golf-city', price: 47500000, area: 4200, unit: 'SQFT', org: b1.org, by: agent, source: 'BROKER', images: ['modernVilla', 'villaPool2', 'villaInterior', 'livingLuxury'], featured: true, verified: true, fields: { bedrooms: 5, bathrooms: 6, balconies: 3, furnishing: 'FULLY_FURNISHED', totalFloors: 3, facing: 'NORTH_EAST', possessionStatus: 'READY_TO_MOVE', ageYears: 2, roadWidthFt: 40, ownershipType: 'FREEHOLD', coveredParking: 3, builtUpAreaSqft: 4200, plotAreaSqft: 3600 }, attributes: { gatedSociety: true, gardenOrLawn: true, powerBackup: 'Full' }, amenities: ['gated-community', '24x7-security', 'swimming-pool', 'club-house', 'gymnasium', 'power-backup', 'cctv-surveillance'], highlights: ['Private pool', 'Home automation', 'Inside a gated golf township'] },
    { title: '200 sq.yd residential plot on Sultanpur Road', type: 'residential-plot', listing: 'SALE', locality: 'sultanpur-road', price: 5400000, area: 200, unit: 'SQYD', org: { id: platform }, by: ops, source: 'COMPANY', images: ['aerialPlots', 'township'], verified: true, fields: { facing: 'NORTH', plotLengthFt: 60, plotWidthFt: 30, roadWidthFt: 30, isCornerPlot: false, ownershipType: 'FREEHOLD', approvalAuthority: 'LDA', possessionStatus: 'READY_TO_MOVE', plotAreaSqft: 1800 }, attributes: { boundaryWall: true, gatedSociety: true, openSides: 1 }, amenities: ['gated-community', 'wide-internal-roads', 'street-lighting', 'underground-drainage', 'electricity-connection'] },
    { title: 'Corner plot 300 sq.yd in Vrindavan Yojana', type: 'residential-plot', listing: 'SALE', locality: 'vrindavan-yojana', price: 10800000, area: 300, unit: 'SQYD', org: b2.org, by: b2.owner, source: 'BROKER', images: ['township', 'aerialPlots'], verified: true, fields: { facing: 'EAST', plotLengthFt: 60, plotWidthFt: 45, roadWidthFt: 40, isCornerPlot: true, ownershipType: 'LEASEHOLD', approvalAuthority: 'UP Awas Vikas Parishad', possessionStatus: 'READY_TO_MOVE', plotAreaSqft: 2700 }, attributes: { openSides: 2, boundaryWall: false } },
    { title: '2 BHK apartment for rent in Gomti Nagar Extension', type: 'apartment', listing: 'RENT', locality: 'gomti-nagar-extension', price: 22000, area: 1150, unit: 'SQFT', org: b1.org, by: b1.owner, source: 'BROKER', images: ['livingYellow', 'livingBright', 'kitchen'], verified: true, fields: { bedrooms: 2, bathrooms: 2, balconies: 2, furnishing: 'SEMI_FURNISHED', floorNumber: 5, totalFloors: 14, facing: 'WEST', possessionStatus: 'READY_TO_MOVE', availableFrom: daysAhead(10), securityDeposit: 66000, maintenanceMonthly: 2500, ageYears: 3, coveredParking: 1, superAreaSqft: 1150 }, amenities: apartmentAmenities },
    { title: 'Furnished 3 BHK apartment for rent in Hazratganj', type: 'apartment', listing: 'RENT', locality: 'hazratganj', price: 38000, area: 1500, unit: 'SQFT', org: b2.org, by: b2.owner, source: 'BROKER', images: ['livingModern', 'livingLuxury', 'bedroom'], featured: true, verified: true, fields: { bedrooms: 3, bathrooms: 3, balconies: 1, furnishing: 'FULLY_FURNISHED', floorNumber: 3, totalFloors: 8, facing: 'NORTH', possessionStatus: 'READY_TO_MOVE', availableFrom: daysAhead(3), securityDeposit: 114000, maintenanceMonthly: 3000, ageYears: 7, coveredParking: 1, superAreaSqft: 1500 }, amenities: ['lift', 'power-backup', '24x7-security', 'covered-parking', 'intercom'] },
    { title: 'Ground floor shop on Faizabad Road', type: 'shop', listing: 'SALE', locality: 'faizabad-road', price: 8500000, area: 450, unit: 'SQFT', org: d1.org, by: d1.owner, source: 'DEVELOPER', images: ['retailShop'], verified: true, fields: { floorNumber: 0, totalFloors: 4, facing: 'SOUTH', possessionStatus: 'READY_TO_MOVE', ownershipType: 'FREEHOLD', carpetAreaSqft: 450, superAreaSqft: 560 }, attributes: { washrooms: 1, frontageFt: 16, mainRoadFacing: true, suitableFor: 'Retail, pharmacy, showroom' }, amenities: ['power-backup', 'cctv-surveillance', 'visitor-parking'] },
    { title: 'Furnished office space in Gomti Nagar', type: 'office-space', listing: 'RENT', locality: 'gomti-nagar', price: 95000, area: 2200, unit: 'SQFT', org: b1.org, by: b1.owner, source: 'BROKER', images: ['officeInterior', 'officeFloor'], featured: true, verified: true, fields: { furnishing: 'FULLY_FURNISHED', floorNumber: 4, totalFloors: 6, possessionStatus: 'READY_TO_MOVE', availableFrom: daysAhead(15), securityDeposit: 570000, maintenanceMonthly: 12000, ageYears: 5, coveredParking: 4, carpetAreaSqft: 1800, superAreaSqft: 2200 }, attributes: { washrooms: 2, pantry: true, suitableFor: 'IT / professional services' }, amenities: ['lift', 'power-backup', 'conference-room', 'cctv-surveillance', 'fire-safety'] },
    { title: 'Double-height showroom on Kanpur Road', type: 'showroom', listing: 'RENT', locality: 'kanpur-road', price: 160000, area: 3000, unit: 'SQFT', org: b2.org, by: b2.owner, source: 'BROKER', images: ['officeFloor', 'officeTowers'], verified: true, fields: { furnishing: 'UNFURNISHED', floorNumber: 0, totalFloors: 3, facing: 'NORTH', possessionStatus: 'READY_TO_MOVE', securityDeposit: 960000, carpetAreaSqft: 2600, superAreaSqft: 3000 }, attributes: { frontageFt: 40, mainRoadFacing: true, washrooms: 2 }, amenities: ['power-backup', 'visitor-parking', 'fire-safety'] },
    { title: 'Warehouse with 28 ft clear height on Kursi Road', type: 'warehouse-godown', listing: 'RENT', locality: 'kursi-road', price: 220000, area: 15000, unit: 'SQFT', org: b2.org, by: b2.owner, source: 'BROKER', images: ['warehouse'], verified: true, fields: { possessionStatus: 'READY_TO_MOVE', availableFrom: daysAhead(30), securityDeposit: 1320000, ageYears: 3, roadWidthFt: 60, ownershipType: 'FREEHOLD', builtUpAreaSqft: 15000, plotAreaSqft: 21000 }, attributes: { powerLoadKva: 100, clearHeightFt: 28, loadingDocks: 2, zoning: 'Industrial / warehousing' }, amenities: ['loading-bay', '24x7-security', 'cctv-surveillance', 'fire-safety'] },
    { title: '12,000 sq.ft industrial land on Kanpur Road', type: 'industrial-land', listing: 'SALE', locality: 'kanpur-road', price: 26000000, area: 12000, unit: 'SQFT', org: { id: platform }, by: ops, source: 'COMPANY', images: ['farmland'], verified: true, fields: { possessionStatus: 'READY_TO_MOVE', roadWidthFt: 60, ownershipType: 'FREEHOLD', approvalAuthority: 'UPSIDA', plotAreaSqft: 12000 }, attributes: { powerLoadKva: 50, zoning: 'Industrial' } },
    { title: '2.5 acre agricultural land near Mohanlalganj', type: 'agricultural-land', listing: 'SALE', locality: 'mohanlalganj', price: 11000000, area: 2.5, unit: 'ACRE', org: ow.org, by: ow.owner, source: 'OWNER', images: ['farmland'], verified: true, fields: { roadWidthFt: 20, ownershipType: 'FREEHOLD', plotAreaSqft: 108900 }, attributes: { soilType: 'Alluvial', irrigation: 'Tube well', electricityConnection: true, roadAccess: 'Paved' } },
    { title: '1,000 sq.yd farm plot in Bakshi Ka Talab', type: 'farm-plot', listing: 'SALE', locality: 'bakshi-ka-talab', price: 2800000, area: 1000, unit: 'SQYD', org: b1.org, by: b1.owner, source: 'BROKER', images: ['houseLawn', 'farmland'], verified: true, fields: { roadWidthFt: 25, ownershipType: 'FREEHOLD', plotAreaSqft: 9000 }, attributes: { soilType: 'Loamy', irrigation: 'Borewell', electricityConnection: true, roadAccess: 'Paved' } },
    { title: 'Farmhouse with lawn on Sitapur Road', type: 'farmhouse', listing: 'SALE', locality: 'sitapur-road', price: 18500000, area: 3000, unit: 'SQFT', org: b2.org, by: b2.owner, source: 'BROKER', images: ['houseLawn', 'resortPool', 'houseTimber'], verified: true, fields: { bedrooms: 4, bathrooms: 4, furnishing: 'SEMI_FURNISHED', totalFloors: 2, possessionStatus: 'READY_TO_MOVE', ageYears: 5, roadWidthFt: 30, ownershipType: 'FREEHOLD', coveredParking: 2, builtUpAreaSqft: 3000, plotAreaSqft: 52272 }, attributes: { gardenOrLawn: true, powerBackup: 'Partial' }, amenities: ['swimming-pool', 'park-garden', 'power-backup', 'boundary-wall'] },
    { title: '3 BHK independent house in Ashiyana', type: 'independent-house', listing: 'SALE', locality: 'ashiyana', price: 13500000, area: 1800, unit: 'SQFT', org: { id: platform }, by: ops, source: 'COMPANY', images: ['porchHouse', 'brickHouse', 'livingDining'], verified: true, fields: { bedrooms: 3, bathrooms: 3, balconies: 1, furnishing: 'SEMI_FURNISHED', totalFloors: 2, facing: 'WEST', possessionStatus: 'READY_TO_MOVE', ageYears: 11, roadWidthFt: 24, ownershipType: 'FREEHOLD', coveredParking: 1, builtUpAreaSqft: 1800, plotAreaSqft: 1350 } },
    { title: '2 BHK builder floor in Aliganj', type: 'flat-builder-floor', listing: 'SALE', locality: 'aliganj', price: 6200000, area: 1100, unit: 'SQFT', org: b1.org, by: agent, source: 'BROKER', images: ['livingPlants', 'livingBlue'], verified: true, fields: { bedrooms: 2, bathrooms: 2, balconies: 1, furnishing: 'UNFURNISHED', floorNumber: 1, totalFloors: 3, facing: 'SOUTH', possessionStatus: 'READY_TO_MOVE', ageYears: 1, ownershipType: 'FREEHOLD', coveredParking: 1, builtUpAreaSqft: 1100 } },
    { title: '4 BHK sky apartment in Gomti Nagar Extension', type: 'apartment', listing: 'SALE', locality: 'gomti-nagar-extension', price: 21000000, area: 2850, unit: 'SQFT', org: d2.org, by: d2.owner, source: 'DEVELOPER', images: ['livingLuxury', 'livingModern', 'apartmentFacade'], featured: true, verified: true, fields: { bedrooms: 4, bathrooms: 5, balconies: 3, furnishing: 'FULLY_FURNISHED', floorNumber: 18, totalFloors: 18, facing: 'NORTH_EAST', possessionStatus: 'READY_TO_MOVE', ageYears: 1, ownershipType: 'FREEHOLD', coveredParking: 2, superAreaSqft: 2850, carpetAreaSqft: 2150 }, amenities: [...apartmentAmenities, 'swimming-pool', 'club-house', 'gymnasium'] },
    { title: '500 sq.yd commercial plot on Shaheed Path', type: 'commercial-plot', listing: 'SALE', locality: 'shaheed-path', price: 32000000, area: 500, unit: 'SQYD', org: { id: platform }, by: ops, source: 'COMPANY', images: ['aerialPlots', 'officeTowers'], verified: true, fields: { facing: 'NORTH', plotLengthFt: 90, plotWidthFt: 50, roadWidthFt: 60, isCornerPlot: false, ownershipType: 'FREEHOLD', approvalAuthority: 'LDA', possessionStatus: 'READY_TO_MOVE', plotAreaSqft: 4500 } },
    { title: 'Independent house for rent in Mahanagar', type: 'independent-house', listing: 'RENT', locality: 'mahanagar', price: 45000, area: 2200, unit: 'SQFT', org: ow.org, by: ow.owner, source: 'OWNER', images: ['redHouse', 'livingDining'], verified: true, fields: { bedrooms: 4, bathrooms: 3, furnishing: 'SEMI_FURNISHED', totalFloors: 2, possessionStatus: 'READY_TO_MOVE', availableFrom: daysAhead(7), securityDeposit: 135000, ageYears: 15, ownershipType: 'FREEHOLD', coveredParking: 2, builtUpAreaSqft: 2200, plotAreaSqft: 1800 } },
    { title: 'Compact office in Hazratganj', type: 'office-space', listing: 'SALE', locality: 'hazratganj', price: 7200000, area: 600, unit: 'SQFT', org: b2.org, by: b2.owner, source: 'BROKER', images: ['officeFloor', 'officeInterior'], verified: true, fields: { furnishing: 'SEMI_FURNISHED', floorNumber: 2, totalFloors: 5, possessionStatus: 'READY_TO_MOVE', ageYears: 12, ownershipType: 'FREEHOLD', carpetAreaSqft: 520, superAreaSqft: 600 }, attributes: { washrooms: 1, pantry: false } },
    { title: '1 BHK apartment for rent near Charbagh', type: 'apartment', listing: 'RENT', locality: 'charbagh', price: 11000, area: 600, unit: 'SQFT', org: b1.org, by: b1.owner, source: 'BROKER', images: ['loftInterior'], verified: false, fields: { bedrooms: 1, bathrooms: 1, balconies: 1, furnishing: 'SEMI_FURNISHED', floorNumber: 3, totalFloors: 6, possessionStatus: 'READY_TO_MOVE', availableFrom: daysAhead(1), securityDeposit: 22000, ageYears: 10, superAreaSqft: 600 } },
    { title: '3 BHK apartment on Raebareli Road', type: 'apartment', listing: 'SALE', locality: 'raebareli-road', price: 7800000, area: 1450, unit: 'SQFT', org: b1.org, by: agent, source: 'BROKER', images: ['livingBright'], status: 'PENDING_REVIEW', fields: { bedrooms: 3, bathrooms: 2, balconies: 2, furnishing: 'UNFURNISHED', floorNumber: 9, totalFloors: 15, possessionStatus: 'UNDER_CONSTRUCTION', ownershipType: 'FREEHOLD', superAreaSqft: 1450 } },
    { title: 'Residential plot in Chinhat', type: 'residential-plot', listing: 'SALE', locality: 'chinhat', price: 3600000, area: 150, unit: 'SQYD', org: ow.org, by: ow.owner, source: 'OWNER', images: [], status: 'DRAFT', fields: { facing: 'SOUTH', ownershipType: 'FREEHOLD', plotAreaSqft: 1350 } },
    { title: '2 BHK apartment in Vikas Nagar', type: 'apartment', listing: 'SALE', locality: 'vikas-nagar', price: 5200000, area: 1000, unit: 'SQFT', org: b2.org, by: b2.owner, source: 'BROKER', images: ['livingYellow'], status: 'SOLD', verified: true, fields: { bedrooms: 2, bathrooms: 2, furnishing: 'SEMI_FURNISHED', floorNumber: 4, totalFloors: 7, possessionStatus: 'READY_TO_MOVE', ownershipType: 'FREEHOLD', superAreaSqft: 1000 } },
    { title: 'Plot near IIM Road', type: 'residential-plot', listing: 'SALE', locality: 'iim-road', price: 4500000, area: 180, unit: 'SQYD', org: b3.org, by: b3.owner, source: 'BROKER', images: ['township'], status: 'PENDING_REVIEW', fields: { facing: 'NORTH', ownershipType: 'FREEHOLD', plotAreaSqft: 1620 } },
  ];

  const propertyIds: Record<string, string> = {};
  for (const [i, s] of specs.entries()) {
    const type = typeBySlug.get(s.type);
    if (!type) throw new Error(`Unknown property type ${s.type}`);
    const l = L(s.locality);
    const code = demoCode('PR');
    const status = s.status ?? 'PUBLISHED';
    const publishedAt = status === 'PUBLISHED' || status === 'SOLD' ? daysAgo(2 + ((i * 3) % 40)) : null;
    const areaSqft = toSqft(s.area, s.unit);
    // Offset coordinates slightly so listings in a locality do not overlap exactly
    const lat = Number(l.latitude) + (((i * 37) % 17) - 8) * 0.0009;
    const lng = Number(l.longitude) + (((i * 53) % 19) - 9) * 0.0009;
    const p = await prisma.property.create({
      data: {
        referenceCode: code,
        slug: `${slugify(s.title, 70)}-${code.toLowerCase()}`,
        title: s.title,
        description: describe(s),
        propertyTypeId: type.id,
        segment: type.segment,
        listingType: s.listing,
        sourceType: s.source,
        organizationId: s.org.id,
        listedById: s.by.id,
        stateId: ref.upStateId,
        cityId: ref.lucknowId,
        localityId: l.id,
        addressLine: `${l.name}, Lucknow`,
        pincode: l.pincode,
        latitude: Number(lat.toFixed(6)),
        longitude: Number(lng.toFixed(6)),
        hideExactLocation: s.source === 'OWNER',
        area: s.area,
        areaUnit: s.unit,
        areaSqft,
        price: s.price,
        pricePerSqft: s.listing === 'SALE' ? Math.round(s.price / areaSqft) : null,
        priceNegotiable: i % 3 === 0,
        status,
        verificationStatus: s.verified ? 'VERIFIED' : status === 'PUBLISHED' ? 'UNVERIFIED' : 'PENDING',
        isFeatured: Boolean(s.featured),
        featuredUntil: s.featured ? daysAhead(30) : null,
        submittedAt: status !== 'DRAFT' ? daysAgo(45 - i) : null,
        approvedAt: publishedAt,
        publishedAt,
        expiresAt: publishedAt ? new Date(publishedAt.getTime() + 90 * DAY) : null,
        closedAt: status === 'SOLD' ? daysAgo(1) : null,
        coverImageUrl: s.images[0] ? U(IMG[s.images[0]], 1200) : null,
        attributes: s.attributes ?? {},
        highlights: s.highlights ?? [],
        viewCount: status === 'PUBLISHED' ? 40 + ((i * 29) % 300) : 0,
        isDemo: true,
        ...(s.fields as object),
        media: { create: s.images.map((k, idx) => ({ type: 'IMAGE' as const, url: U(IMG[k]), caption: null, sortOrder: idx, isCover: idx === 0 })) },
        amenities: { create: (s.amenities ?? []).filter((a) => amenityBySlug.has(a)).map((a) => ({ amenityId: amenityBySlug.get(a)! })) },
        statusHistory: {
          create: [
            { fromStatus: null, toStatus: 'DRAFT', changedById: s.by.id, reason: 'Created', createdAt: daysAgo(46 - i) },
            ...(status !== 'DRAFT' ? [{ fromStatus: 'DRAFT' as const, toStatus: 'PENDING_REVIEW' as const, changedById: s.by.id, createdAt: daysAgo(45 - i) }] : []),
            ...(publishedAt
              ? [
                  { fromStatus: 'PENDING_REVIEW' as const, toStatus: 'APPROVED' as const, changedById: brokerMgr.id, createdAt: publishedAt },
                  { fromStatus: 'APPROVED' as const, toStatus: 'PUBLISHED' as const, changedById: brokerMgr.id, createdAt: publishedAt },
                ]
              : []),
            ...(status === 'SOLD' ? [{ fromStatus: 'PUBLISHED' as const, toStatus: 'SOLD' as const, changedById: s.by.id, createdAt: daysAgo(1) }] : []),
          ],
        },
      },
    });
    propertyIds[slugify(s.title)] = p.id;
  }

  // ───────────── Projects ─────────────
  const amen = (slugs: string[]) => slugs.filter((a) => amenityBySlug.has(a)).map((a) => ({ amenityId: amenityBySlug.get(a)! }));
  type UnitSeed = Omit<Prisma.ProjectUnitUncheckedCreateInput, 'projectId'>;

  async function createProject(opts: {
    name: string;
    slug: string;
    tagline: string;
    type: Prisma.ProjectUncheckedCreateInput['projectType'];
    org: string;
    developer: string;
    locality: string;
    description: string;
    images: ImgKey[];
    hero: ImgKey;
    masterPlan?: ImgKey;
    status: NonNullable<Prisma.ProjectUncheckedCreateInput['status']>;
    opens: Date | null;
    closes: Date | null;
    review: Prisma.ProjectUncheckedCreateInput['reviewStatus'];
    published: boolean;
    featured?: boolean;
    acres: number;
    planned: number;
    possession: string;
    rera: string;
    approval: string;
    amenities: string[];
    nearby: [Prisma.ProjectNearbyPlaceUncheckedCreateInput['category'], string, number, number][];
    faqs: [string, string][];
    updates: [string, string, number, number][];
    blocks: { name: string; type: Prisma.ProjectBlockUncheckedCreateInput['type']; floors?: number }[];
    units: (blockIds: Record<string, string>) => UnitSeed[];
    team: { id: string }[];
    stats: { label: string; value: string }[];
    highlights: string[];
  }) {
    const l = L(opts.locality);
    const project = await prisma.project.create({
      data: {
        slug: opts.slug,
        name: opts.name,
        tagline: opts.tagline,
        projectType: opts.type,
        organizationId: opts.org,
        developerOrgId: opts.developer,
        stateId: ref.upStateId,
        cityId: ref.lucknowId,
        localityId: l.id,
        addressLine: `${l.name}, Lucknow`,
        pincode: l.pincode,
        latitude: Number(l.latitude) + 0.004,
        longitude: Number(l.longitude) + 0.004,
        description: opts.description,
        heroImageUrl: U(IMG[opts.hero], 2000),
        masterPlanUrl: opts.masterPlan ? U(IMG[opts.masterPlan], 1600) : null,
        totalAreaAcres: opts.acres,
        totalUnitsPlanned: opts.planned,
        launchDate: opts.opens ? dateOnly(new Date(opts.opens.getTime() - 30 * DAY)) : null,
        possessionDate: new Date(`${opts.possession}T00:00:00Z`),
        reraNumber: opts.rera,
        approvalDetails: opts.approval,
        legalInformation: 'Demo project — legal and approval details shown here are placeholders for development and testing.',
        status: opts.status,
        autoStatus: true,
        bookingOpensAt: opts.opens,
        bookingClosesAt: opts.closes,
        closingSoonHours: 72,
        reviewStatus: opts.review,
        isPublished: opts.published,
        publishedAt: opts.published ? daysAgo(35) : null,
        isFeatured: Boolean(opts.featured),
        seoTitle: `${opts.name} — ${l.name}, Lucknow`,
        seoDescription: opts.tagline,
        isDemo: true,
        createdById: ops.id,
        media: { create: opts.images.map((k, i) => ({ type: 'IMAGE' as const, url: U(IMG[k]), sortOrder: i, caption: null })) },
        amenities: { create: amen(opts.amenities) },
        nearbyPlaces: { create: opts.nearby.map(([category, name, distanceKm, travelMinutes], i) => ({ category, name, distanceKm, travelMinutes, sortOrder: i })) },
        faqs: { create: opts.faqs.map(([question, answer], i) => ({ question, answer, sortOrder: i })) },
        constructionUpdates: { create: opts.updates.map(([title, description, progressPercent, ago]) => ({ title, description, progressPercent, updateDate: dateOnly(daysAgo(ago)) })) },
        team: { create: opts.team.map((t, i) => ({ userId: t.id, role: i === 0 ? ('SALES_LEAD' as const) : ('SALES_EXECUTIVE' as const), isPrimaryContact: i === 0 })) },
        statusHistory: { create: [{ fromStatus: null, toStatus: 'DRAFT', changedById: ops.id, reason: 'Created', createdAt: daysAgo(60) }, ...(opts.status !== 'DRAFT' ? [{ fromStatus: 'DRAFT' as const, toStatus: opts.status, changedById: null, reason: 'Demo data', createdAt: daysAgo(35) }] : [])] },
      },
    });
    const blockIds: Record<string, string> = {};
    for (const [i, b] of opts.blocks.entries()) {
      const block = await prisma.projectBlock.create({ data: { projectId: project.id, name: b.name, type: b.type, totalFloors: b.floors ?? null, sortOrder: i } });
      blockIds[b.name] = block.id;
    }
    for (const u of opts.units(blockIds)) {
      const unit = await prisma.projectUnit.create({ data: { ...u, projectId: project.id } });
      if (unit.status !== 'AVAILABLE' && unit.status !== 'NOT_RELEASED') {
        await prisma.unitStatusHistory.create({ data: { unitId: unit.id, fromStatus: 'AVAILABLE', toStatus: unit.status, reason: 'Demo data', changedById: sales1.id, createdAt: daysAgo(10) } });
      }
    }
    const sections = defaultProjectPage().map((s) => {
      if (s.type === 'HERO') return { ...s, data: { ...s.data, subheadline: opts.tagline } };
      if (s.type === 'OVERVIEW') return { ...s, data: { ...s.data, highlights: opts.highlights } };
      return s;
    });
    const overviewIdx = sections.findIndex((s) => s.type === 'OVERVIEW');
    sections.splice(overviewIdx + 1, 0, { id: `stats${project.id.slice(-6)}`, type: 'STATS', visible: true, data: { heading: 'Key facts', items: opts.stats } });
    await prisma.projectPage.create({
      data: { projectId: project.id, draftSections: sections as object, publishedSections: opts.published ? (sections as object) : undefined, publishedAt: opts.published ? daysAgo(35) : null, publishedById: opts.published ? ops.id : null, revision: opts.published ? 1 : 0 },
    });
    if (opts.published) await prisma.projectPageRevision.create({ data: { projectId: project.id, revision: 1, sections: sections as object, publishedById: ops.id } });
    return project;
  }

  const plotSizes = [1000, 1200, 1500, 2000];
  const plotDims: Record<number, string> = { 1000: '25 × 40 ft', 1200: '30 × 40 ft', 1500: '30 × 50 ft', 2000: '40 × 50 ft' };
  const facings = ['NORTH', 'EAST', 'SOUTH', 'WEST'] as const;
  const gv = await createProject({
    name: 'Green Valley Residency (Demo)',
    slug: 'green-valley-residency',
    tagline: 'Gated residential plots off Sultanpur Road with 30–40 ft internal roads',
    type: 'RESIDENTIAL_PLOTS',
    org: platform,
    developer: d1.org.id,
    locality: 'sultanpur-road',
    description:
      'Green Valley Residency is a gated plotted development off Sultanpur Road, planned around wide internal roads, landscaped parks and a community club.\n\nPlots range from 1,000 to 2,000 sq.ft and are offered in two sectors. Inventory, prices and availability on this page are read live from the sales system.\n\nThis is demonstration content for development and testing.',
    images: ['aerialPlots', 'township', 'houseLawn', 'modernHouseDusk'],
    hero: 'aerialPlots',
    masterPlan: 'township',
    status: 'BOOKING_OPEN',
    opens: daysAgo(10, 10),
    closes: daysAhead(25, 18),
    review: 'APPROVED',
    published: true,
    featured: true,
    acres: 24,
    planned: 36,
    possession: '2027-12-31',
    rera: 'DEMO-UPRERA-PRJ-1001',
    approval: 'Layout approval details to be confirmed (demo)',
    amenities: ['gated-community', '24x7-security', 'cctv-surveillance', 'park-garden', 'wide-internal-roads', 'street-lighting', 'underground-drainage', 'electricity-connection', 'club-house', 'childrens-play-area', 'jogging-track'],
    nearby: [
      ['HIGHWAY', 'Amar Shaheed Path', 2.5, 6],
      ['AIRPORT', 'Chaudhary Charan Singh International Airport', 16, 30],
      ['HOSPITAL', 'Multi-speciality hospital on Shaheed Path', 5.5, 12],
      ['MALL', 'Shopping mall on Shaheed Path', 6, 14],
      ['SCHOOL', 'CBSE schools in Sushant Golf City', 4, 10],
      ['RAILWAY', 'Charbagh Railway Station', 14, 32],
    ],
    faqs: [
      ['How do I reserve a plot?', 'Choose an available plot in the inventory and submit an enquiry. A relationship manager confirms availability and explains the booking process. No online payment is taken on this website.'],
      ['Are prices final?', 'Prices shown are base prices from the sales system. Preferential location charges for corner plots are shown separately. Final cost is confirmed in writing at booking.'],
      ['Is this a real project?', 'No. Green Valley Residency is demonstration data used to develop and test the platform.'],
    ],
    updates: [
      ['Boundary wall completed', 'Perimeter boundary wall and main gate structure completed.', 30, 40],
      ['Internal roads — sector A', 'Base layer for 40 ft roads in sector A laid.', 45, 12],
    ],
    blocks: [
      { name: 'Sector A', type: 'SECTOR' },
      { name: 'Sector B', type: 'SECTOR' },
    ],
    units: (b) => {
      const out: UnitSeed[] = [];
      for (const [prefix, blockName] of [['A', 'Sector A'], ['B', 'Sector B']] as const) {
        for (let i = 1; i <= 18; i += 1) {
          const area = plotSizes[i % 4];
          const corner = i % 6 === 1;
          const base = area * 3200;
          const extra = corner ? Math.round(base * 0.05) : 0;
          let status: UnitSeed['status'] = 'AVAILABLE';
          if (prefix === 'A' && [1, 2, 5, 9].includes(i)) status = 'SOLD';
          if (prefix === 'A' && [3, 7, 11].includes(i)) status = 'BOOKED';
          if (prefix === 'A' && i === 6) status = 'ON_HOLD';
          if (prefix === 'B' && [2, 8].includes(i)) status = 'BOOKED';
          if (prefix === 'B' && i >= 15) status = 'NOT_RELEASED';
          out.push({ blockId: b[blockName], code: `${prefix}-${String(i).padStart(2, '0')}`, unitType: 'PLOT', area, areaUnit: 'SQFT', areaSqft: area, facing: facings[i % 4], dimensions: plotDims[area], isCorner: corner, basePrice: base, additionalCharges: extra, totalPrice: base + extra, status, notes: corner ? 'Corner plot (5% PLC)' : null });
        }
      }
      return out;
    },
    team: [sales1, sales2],
    stats: [
      { label: 'Total area', value: '24 acres' },
      { label: 'Plots', value: '36' },
      { label: 'Plot sizes', value: '1,000 – 2,000 sq.ft' },
      { label: 'Possession', value: 'Dec 2027' },
    ],
    highlights: ['Gated community with 24×7 security', '40 ft main and 30 ft internal roads', 'Landscaped central park and jogging track', 'Underground drainage and street lighting'],
  });

  const configs: [string, number, number][] = [
    ['2 BHK', 2, 1150],
    ['3 BHK', 3, 1550],
    ['3 BHK + Study', 3, 1600],
    ['4 BHK', 4, 2100],
  ];
  const sky = await createProject({
    name: 'Skyline Towers (Demo)',
    slug: 'skyline-towers',
    tagline: '2, 3 & 4 BHK apartments in Gomti Nagar Extension — bookings open soon',
    type: 'APARTMENTS',
    org: d2.org.id,
    developer: d2.org.id,
    locality: 'gomti-nagar-extension',
    description:
      'Skyline Towers offers 2, 3 and 4 BHK apartments across two towers with a clubhouse, swimming pool and landscaped podium.\n\nBookings open on the date shown on this page; until then you can register your interest and our team will contact you when inventory is released.\n\nThis is demonstration content for development and testing.',
    images: ['highrises', 'apartmentBalconies', 'livingModern', 'kitchen', 'bedroom'],
    hero: 'highrises',
    status: 'UPCOMING',
    opens: daysAhead(12, 10),
    closes: daysAhead(75, 18),
    review: 'APPROVED',
    published: true,
    featured: true,
    acres: 3.5,
    planned: 48,
    possession: '2029-06-30',
    rera: 'DEMO-UPRERA-PRJ-1002',
    approval: 'Building plan approval details to be confirmed (demo)',
    amenities: ['lift', 'power-backup', '24x7-security', 'cctv-surveillance', 'covered-parking', 'club-house', 'swimming-pool', 'gymnasium', 'childrens-play-area', 'rainwater-harvesting', 'fire-safety'],
    nearby: [
      ['OFFICE_HUB', 'Vibhuti Khand business district', 4, 10],
      ['MALL', 'Shopping malls in Gomti Nagar', 4.5, 12],
      ['HOSPITAL', 'Hospitals in Gomti Nagar', 3.5, 9],
      ['RAILWAY', 'Gomti Nagar Railway Station', 3, 8],
    ],
    faqs: [
      ['When do bookings open?', 'The booking window opens at the date and time shown on this page. The server switches the project status automatically.'],
      ['Is this a real project?', 'No. Skyline Towers is demonstration data used to develop and test the platform.'],
    ],
    updates: [['Excavation started', 'Site excavation and foundation work under way.', 8, 20]],
    blocks: [
      { name: 'Tower 1', type: 'TOWER', floors: 18 },
      { name: 'Tower 2', type: 'TOWER', floors: 18 },
    ],
    units: (b) => {
      const out: UnitSeed[] = [];
      for (const [t, blockName] of [['T1', 'Tower 1'], ['T2', 'Tower 2']] as const) {
        for (let floor = 1; floor <= 6; floor += 1) {
          configs.forEach(([config, beds, area], idx) => {
            const rate = 6500 + floor * 50;
            const base = area * rate;
            out.push({ blockId: b[blockName], code: `${t}-${floor}0${idx + 1}`, unitType: 'FLAT', floorNumber: floor, configuration: config, bedrooms: beds, area, areaUnit: 'SQFT', areaSqft: area, carpetAreaSqft: Math.round(area * 0.74), facing: facings[(floor + idx) % 4], basePrice: base, additionalCharges: 350000, totalPrice: base + 350000, status: 'AVAILABLE' });
          });
        }
      }
      return out;
    },
    team: [sales2, sales3],
    stats: [
      { label: 'Towers', value: '2 × G+18' },
      { label: 'Configurations', value: '2, 3 & 4 BHK' },
      { label: 'Land area', value: '3.5 acres' },
      { label: 'Possession', value: 'Jun 2029' },
    ],
    highlights: ['Clubhouse with pool and gym', 'Vastu-oriented layouts', 'Two-level basement parking'],
  });

  const cs = await createProject({
    name: 'Commerce Square (Demo)',
    slug: 'commerce-square',
    tagline: 'Retail shops and office suites on Faizabad Road — final inventory',
    type: 'COMMERCIAL',
    org: d1.org.id,
    developer: d1.org.id,
    locality: 'faizabad-road',
    description:
      'Commerce Square is a G+2 commercial development with ground-floor retail and office suites on the upper floors, fronting Faizabad Road.\n\nOnly the remaining units are shown as available. The booking window closes at the time displayed on this page.\n\nThis is demonstration content for development and testing.',
    images: ['officeTowers', 'retailShop', 'officeFloor', 'officeInterior'],
    hero: 'officeTowers',
    status: 'CLOSING_SOON',
    opens: daysAgo(40, 10),
    closes: daysAhead(2, 18),
    review: 'APPROVED',
    published: true,
    acres: 1.2,
    planned: 28,
    possession: '2027-03-31',
    rera: 'DEMO-UPRERA-PRJ-1003',
    approval: 'Commercial map approval details to be confirmed (demo)',
    amenities: ['lift', 'power-backup', 'cctv-surveillance', 'visitor-parking', 'fire-safety', 'cafeteria-food-court'],
    nearby: [
      ['HIGHWAY', 'Faizabad Road (NH-27)', 0.1, 1],
      ['OFFICE_HUB', 'Gomti Nagar commercial district', 5, 14],
    ],
    faqs: [['Is this a real project?', 'No. Commerce Square is demonstration data used to develop and test the platform.']],
    updates: [['Structure complete', 'RCC structure completed; façade work in progress.', 70, 15]],
    blocks: [
      { name: 'Ground Floor', type: 'BLOCK' },
      { name: 'Upper Floors', type: 'BLOCK' },
    ],
    units: (b) => {
      const out: UnitSeed[] = [];
      for (let i = 1; i <= 12; i += 1) {
        const area = 250 + (i % 4) * 50;
        const base = area * 18000;
        out.push({ blockId: b['Ground Floor'], code: `G-${String(i).padStart(2, '0')}`, unitType: 'SHOP', floorNumber: 0, area, areaUnit: 'SQFT', areaSqft: area, basePrice: base, additionalCharges: 0, totalPrice: base, status: [3, 8, 11].includes(i) ? 'AVAILABLE' : i % 2 ? 'SOLD' : 'BOOKED' });
      }
      for (const fl of [1, 2]) {
        for (let i = 1; i <= 8; i += 1) {
          const area = 500 + (i % 5) * 100;
          const base = area * 9500;
          out.push({ blockId: b['Upper Floors'], code: `F${fl}-${String(i).padStart(2, '0')}`, unitType: 'OFFICE', floorNumber: fl, area, areaUnit: 'SQFT', areaSqft: area, basePrice: base, additionalCharges: 0, totalPrice: base, status: (fl === 2 && [2, 5].includes(i)) || (fl === 1 && [4, 7].includes(i)) ? 'AVAILABLE' : i % 3 === 0 ? 'BOOKED' : 'SOLD' });
        }
      }
      return out;
    },
    team: [sales3],
    stats: [
      { label: 'Units', value: '12 shops · 16 offices' },
      { label: 'Frontage', value: 'Faizabad Road' },
    ],
    highlights: ['Main-road frontage', 'Power backup for common areas', 'Visitor parking'],
  });

  await createProject({
    name: 'Lakeshore Villas (Demo)',
    slug: 'lakeshore-villas',
    tagline: 'Independent villas in a low-density gated enclave',
    type: 'VILLAS',
    org: d2.org.id,
    developer: d2.org.id,
    locality: 'shaheed-path',
    description: 'A low-density community of 4 BHK independent villas, submitted by the developer for review. This is demonstration content for development and testing.',
    images: ['villaPool', 'whiteVilla', 'villaGarden'],
    hero: 'villaPool',
    status: 'DRAFT',
    opens: null,
    closes: null,
    review: 'PENDING_REVIEW',
    published: false,
    acres: 6,
    planned: 40,
    possession: '2029-12-31',
    rera: 'DEMO-UPRERA-PRJ-1004',
    approval: 'Pending (demo)',
    amenities: ['gated-community', 'swimming-pool', 'club-house', 'park-garden'],
    nearby: [],
    faqs: [],
    updates: [],
    blocks: [],
    units: () => [],
    team: [],
    stats: [],
    highlights: [],
  });

  // Domains: an active platform subdomain and a custom domain awaiting DNS verification
  const rootDomain = process.env.PLATFORM_ROOT_DOMAIN || 'localhost';
  await prisma.projectDomain.create({
    data: { projectId: gv.id, organizationId: platform, hostname: `green-valley.${rootDomain}`, type: 'SUBDOMAIN', isPrimary: false, status: 'ACTIVE', verificationToken: 'platform-managed', verificationRecord: 'platform-managed', verifiedAt: daysAgo(30), enabledAt: daysAgo(30), dnsTargetOk: true, sslStatus: 'MANAGED_EXTERNALLY', createdById: ops.id },
  });
  await prisma.projectDomain.create({
    data: { projectId: gv.id, organizationId: platform, hostname: 'www.greenvalley-demo.example', type: 'CUSTOM', status: 'PENDING_VERIFICATION', verificationToken: 'estate-verify=demo-token-not-verifiable', verificationRecord: '_estate-verify.www.greenvalley-demo.example', createdById: ops.id, lastError: 'Demo domain on the reserved .example TLD — it can never be verified.' },
  });

  // ───────────── CRM ─────────────
  const team = await prisma.salesTeam.create({
    data: { organizationId: platform, name: 'Lucknow Sales', description: 'Primary sales team for company listings and projects', managerId: salesMgr.id, members: { create: [sales1, sales2, sales3].map((s) => ({ userId: s.id })) } },
  });
  await prisma.assignmentRule.create({ data: { organizationId: platform, name: 'Green Valley enquiries', priority: 10, matchProjectId: gv.id, salesTeamId: team.id, strategy: 'ROUND_ROBIN' } });
  await prisma.assignmentRule.create({ data: { organizationId: platform, name: 'Default — balance workload', priority: 1000, salesTeamId: team.id, strategy: 'WORKLOAD', maxOpenLeadsPerUser: 40 } });
  const b1Team = await prisma.salesTeam.create({ data: { organizationId: b1.org.id, name: 'Gomti Realty team', managerId: b1.owner.id, members: { create: [{ userId: b1.owner.id }, { userId: agent.id }] } } });
  await prisma.assignmentRule.create({ data: { organizationId: b1.org.id, name: 'All enquiries', priority: 100, salesTeamId: b1Team.id, strategy: 'ROUND_ROBIN' } });

  const campaign = await prisma.campaign.create({ data: { organizationId: platform, name: 'Green Valley launch — social ads (Demo)', code: 'GV-SOCIAL-01', channel: 'Social media', status: 'ACTIVE', startDate: dateOnly(daysAgo(20)), budget: 150000 } });

  type LeadSpec = {
    name: string;
    phone: string;
    email?: string;
    source: string;
    org: string;
    projectId?: string;
    propertyKey?: string;
    status: NonNullable<Prisma.LeadUncheckedCreateInput['status']>;
    priority?: Prisma.LeadUncheckedCreateInput['priority'];
    assignee?: { id: string };
    ago: number;
    budget?: [number, number];
    type?: Prisma.LeadUncheckedCreateInput['enquiryType'];
    followUpIn?: number;
    visitIn?: number;
    visitDone?: boolean;
    note?: string;
    campaignId?: string;
    providerId?: string;
    intake?: Prisma.LeadUncheckedCreateInput['intakeStatus'];
  };
  const leadsSpec: LeadSpec[] = [
    { name: 'Rohit Verma', phone: '+917000000101', email: 'rohit.verma@example.com', source: 'PROJECT_ENQUIRY', org: platform, projectId: gv.id, status: 'SITE_VISIT_SCHEDULED', priority: 'HOT', assignee: sales1, ago: 6, budget: [4000000, 6000000], type: 'SITE_VISIT', visitIn: 1, note: 'Wants a 1,500 sq.ft east-facing plot.' },
    { name: 'Neha Srivastava', phone: '+917000000102', email: 'neha.s@example.com', source: 'PROJECT_ENQUIRY', org: platform, projectId: gv.id, status: 'NEGOTIATION', priority: 'HIGH', assignee: sales2, ago: 14, budget: [5000000, 7000000], type: 'UNIT_ENQUIRY', followUpIn: 0, visitDone: true, note: 'Visited site; negotiating on corner plot PLC.' },
    { name: 'Aman Gupta', phone: '+917000000103', source: 'CAMPAIGN', org: platform, projectId: gv.id, status: 'CONTACTED', assignee: sales1, ago: 3, budget: [3000000, 4500000], followUpIn: 1, campaignId: campaign.id },
    { name: 'Priya Mishra', phone: '+917000000104', email: 'priya.m@example.com', source: 'PROJECT_ENQUIRY', org: platform, projectId: sky.id, status: 'INTERESTED', priority: 'HIGH', assignee: sales2, ago: 5, budget: [9000000, 12000000], followUpIn: 2, note: 'Wants 3 BHK on a higher floor when bookings open.' },
    { name: 'Sandeep Yadav', phone: '+917000000105', source: 'PHONE', org: platform, projectId: cs.id, status: 'BOOKING_PENDING', priority: 'HOT', assignee: sales3, ago: 9, budget: [4500000, 6000000], type: 'UNIT_ENQUIRY', visitDone: true },
    { name: 'Kavita Singh', phone: '+917000000106', source: 'WEBSITE', org: platform, propertyKey: slugify('200 sq.yd residential plot on Sultanpur Road'), status: 'NOT_REACHABLE', assignee: sales3, ago: 4, followUpIn: -1 },
    { name: 'Arjun Tiwari', phone: '+917000000107', email: 'arjun.t@example.com', source: 'PROPERTY_ENQUIRY', org: platform, propertyKey: slugify('3 BHK independent house in Ashiyana'), status: 'FOLLOW_UP', assignee: sales1, ago: 8, budget: [12000000, 15000000], followUpIn: 0 },
    { name: 'Pooja Awasthi', phone: '+917000000108', source: 'WALK_IN', org: platform, status: 'LOST', assignee: sales2, ago: 25, note: 'Bought elsewhere.' },
    { name: 'Vikas Chaurasia', phone: '+917000000109', source: 'WHATSAPP', org: platform, projectId: gv.id, status: 'NEW', ago: 0, type: 'CALLBACK' },
    { name: 'Shalini Saxena', phone: '+917000000110', email: 'shalini.saxena@example.com', source: 'PROJECT_ENQUIRY', org: platform, projectId: gv.id, status: 'CONVERTED', priority: 'HIGH', assignee: sales1, ago: 30, budget: [5000000, 6000000], visitDone: true },
    { name: 'Manish Pandey', phone: '+917000000111', source: 'LEAD_PROVIDER', org: platform, projectId: gv.id, status: 'ASSIGNED', assignee: sales3, ago: 2, providerId: leadProvider.id, intake: 'ACCEPTED', followUpIn: 0 },
    { name: 'Ritu Agarwal', phone: '+917000000112', source: 'LEAD_PROVIDER', org: platform, projectId: sky.id, status: 'NEW', ago: 1, providerId: leadProvider.id, intake: 'PENDING_REVIEW' },
    // Broker leads (Gomti Realty Advisors)
    { name: 'Tanvi Bhardwaj', phone: '+917000000201', email: 'tanvi.b@example.com', source: 'PROPERTY_ENQUIRY', org: b1.org.id, propertyKey: slugify('3 BHK apartment with park view in Gomti Nagar'), status: 'CONTACTED', assignee: agent, ago: 2, followUpIn: 1 },
    { name: 'Mohit Arora', phone: '+917000000202', source: 'PROPERTY_ENQUIRY', org: b1.org.id, propertyKey: slugify('Furnished office space in Gomti Nagar'), status: 'SITE_VISIT_SCHEDULED', assignee: b1.owner, ago: 4, visitIn: 2 },
    { name: 'Zoya Khan', phone: '+917000000203', source: 'PROPERTY_ENQUIRY', org: b1.org.id, propertyKey: slugify('2 BHK apartment for rent in Gomti Nagar Extension'), status: 'NEW', ago: 0, type: 'CALLBACK' },
  ];

  const leadIds: Record<string, string> = {};
  for (const s of leadsSpec) {
    const created = daysAgo(s.ago, 10 + (s.ago % 6));
    const propertyId = s.propertyKey ? propertyIds[s.propertyKey] : null;
    const property = propertyId ? await prisma.property.findUnique({ where: { id: propertyId }, select: { localityId: true, listingType: true, title: true } }) : null;
    const customer = await prisma.customer.upsert({
      where: { organizationId_phone: { organizationId: s.org, phone: s.phone } },
      create: { organizationId: s.org, fullName: s.name, phone: s.phone, email: s.email ?? null, city: 'Lucknow', isDemo: true, createdAt: created },
      update: {},
    });
    const leadNo = await nextRef(prisma, 'LD');
    const lead = await prisma.lead.create({
      data: {
        leadNo,
        organizationId: s.org,
        customerId: customer.id,
        name: s.name,
        phone: s.phone,
        email: s.email ?? null,
        sourceId: sourceByKey.get(s.source)!,
        leadProviderId: s.providerId ?? null,
        intakeStatus: s.intake ?? 'ACCEPTED',
        campaignId: s.campaignId ?? null,
        projectId: s.projectId ?? null,
        propertyId,
        enquiryType: s.type ?? 'GENERAL',
        listingType: property?.listingType ?? (s.projectId ? 'SALE' : null),
        budgetMin: s.budget?.[0] ?? null,
        budgetMax: s.budget?.[1] ?? null,
        preferredCityId: ref.lucknowId,
        preferredLocalityId: property?.localityId ?? null,
        requirement: s.note ?? null,
        status: s.status,
        priority: s.priority ?? 'MEDIUM',
        assignedToId: s.assignee?.id ?? null,
        assignedTeamId: s.assignee && s.org === platform ? team.id : null,
        assignedAt: s.assignee ? new Date(created.getTime() + 5 * 60_000) : null,
        lastContactedAt: ['NEW', 'ASSIGNED'].includes(s.status) ? null : new Date(created.getTime() + 3 * 3_600_000),
        nextFollowUpAt: s.followUpIn !== undefined ? daysAhead(s.followUpIn, 15) : null,
        lostReason: s.status === 'LOST' ? s.note ?? 'Not interested' : null,
        convertedAt: s.status === 'CONVERTED' ? daysAgo(3) : null,
        createdById: s.source === 'MANUAL' || s.source === 'WALK_IN' || s.source === 'PHONE' ? salesMgr.id : null,
        isDemo: true,
        createdAt: created,
      },
    });
    leadIds[s.name] = lead.id;
    const subject = property?.title ?? (s.projectId ? (s.projectId === gv.id ? 'Green Valley Residency' : s.projectId === sky.id ? 'Skyline Towers' : 'Commerce Square') : 'General requirement');
    if (['WEBSITE', 'PROJECT_ENQUIRY', 'PROPERTY_ENQUIRY', 'WHATSAPP', 'CAMPAIGN'].includes(s.source)) {
      await prisma.enquiry.create({
        data: { referenceNo: await nextRef(prisma, 'ENQ'), organizationId: s.org, type: s.type ?? 'GENERAL', status: 'PROCESSED', customerId: customer.id, name: s.name, phone: s.phone, email: s.email ?? null, message: s.note ?? null, propertyId, projectId: s.projectId ?? null, sourceKey: s.source, sourcePage: s.projectId ? '/projects' : '/property', consent: true, leadId: lead.id, isDemo: true, createdAt: created },
      });
    }
    const acts: Prisma.LeadActivityCreateManyInput[] = [
      { leadId: lead.id, type: 'ENQUIRY', direction: 'INBOUND', summary: `Enquiry received via ${s.source.replace(/_/g, ' ').toLowerCase()}`, details: `Regarding ${subject}`, occurredAt: created },
    ];
    if (s.assignee) {
      acts.push({ leadId: lead.id, type: 'ASSIGNMENT', summary: `Assigned to ${(await prisma.user.findUniqueOrThrow({ where: { id: s.assignee.id } })).fullName}`, occurredAt: new Date(created.getTime() + 5 * 60_000), metadata: { method: 'ROUND_ROBIN' } });
      await prisma.leadAssignment.create({ data: { leadId: lead.id, assignedToId: s.assignee.id, method: s.org === platform ? 'ROUND_ROBIN' : 'MANUAL', teamId: s.org === platform ? team.id : null, reason: 'Demo assignment', assignedAt: new Date(created.getTime() + 5 * 60_000) } });
    }
    if (!['NEW', 'ASSIGNED'].includes(s.status)) {
      acts.push({ leadId: lead.id, type: 'CALL', direction: 'OUTBOUND', outcome: s.status === 'NOT_REACHABLE' ? 'Not reachable' : 'Connected', summary: s.status === 'NOT_REACHABLE' ? 'Called — phone switched off' : 'Discussed requirement and budget', durationSeconds: s.status === 'NOT_REACHABLE' ? 0 : 240, performedById: s.assignee?.id, occurredAt: new Date(created.getTime() + 3 * 3_600_000) });
      acts.push({ leadId: lead.id, type: 'STATUS_CHANGE', summary: `Status changed to ${s.status.replace(/_/g, ' ').toLowerCase()}`, performedById: s.assignee?.id, occurredAt: new Date(created.getTime() + 3 * 3_600_000 + 60_000), metadata: { to: s.status } });
    }
    await prisma.leadActivity.createMany({ data: acts });
    if (s.followUpIn !== undefined && s.assignee) {
      await prisma.leadFollowUp.create({ data: { leadId: lead.id, assignedToId: s.assignee.id, type: 'CALL', dueAt: daysAhead(s.followUpIn, 15), notes: 'Follow up on requirement', createdById: s.assignee.id } });
    }
    if ((s.visitIn !== undefined || s.visitDone) && s.assignee) {
      await prisma.siteVisit.create({
        data: {
          leadId: lead.id,
          customerId: customer.id,
          projectId: s.projectId ?? null,
          propertyId,
          scheduledAt: s.visitDone ? daysAgo(Math.max(1, s.ago - 3), 11) : daysAhead(s.visitIn!, 11),
          status: s.visitDone ? 'COMPLETED' : 'SCHEDULED',
          assignedToId: s.assignee.id,
          meetingPoint: s.projectId ? 'Project site office' : 'At the property',
          outcome: s.visitDone ? 'Customer liked the location; discussing price' : null,
          completedAt: s.visitDone ? daysAgo(Math.max(1, s.ago - 3), 12) : null,
          createdById: s.assignee.id,
        },
      });
    }
  }
  // Lead-provider duplicate & rejected submissions (kept for the provider's statement)
  const dupOf = leadIds['Rohit Verma'];
  const dupCustomer = await prisma.customer.findFirstOrThrow({ where: { organizationId: platform, phone: '+917000000101' } });
  await prisma.lead.create({
    data: { leadNo: await nextRef(prisma, 'LD'), organizationId: platform, customerId: dupCustomer.id, name: 'Rohit Verma', phone: '+917000000101', sourceId: sourceByKey.get('LEAD_PROVIDER')!, leadProviderId: leadProvider.id, projectId: gv.id, status: 'LOST', intakeStatus: 'DUPLICATE', isDuplicate: true, duplicateOfId: dupOf, intakeNote: 'Customer already enquired directly 6 days earlier', lostReason: 'Duplicate of existing lead', isDemo: true, createdAt: daysAgo(1) },
  });

  // Deal for the converted lead → booking of plot A-03 with commissions
  const convertedLead = await prisma.lead.findUniqueOrThrow({ where: { id: leadIds['Shalini Saxena'] } });
  const unitA03 = await prisma.projectUnit.findFirstOrThrow({ where: { projectId: gv.id, code: 'A-03' } });
  const deal = await prisma.deal.create({
    data: { dealNo: await nextRef(prisma, 'DL'), organizationId: platform, leadId: convertedLead.id, customerId: convertedLead.customerId, projectId: gv.id, unitId: unitA03.id, dealType: 'SALE', status: 'BOOKED', dealValue: unitA03.totalPrice, expectedRevenue: unitA03.totalPrice, bookingDate: dateOnly(daysAgo(3)), salesUserId: sales1.id, notes: 'Demo booking', createdById: salesMgr.id, isDemo: true },
  });
  await prisma.dealPayment.create({ data: { dealId: deal.id, amount: 200000, receivedOn: dateOnly(daysAgo(3)), receivedBy: 'COMPANY', method: 'BANK_TRANSFER', referenceNo: 'DEMO-NEFT-0001', recordedById: accounts.id } });
  const ruleSales = await prisma.commissionRule.create({ data: { organizationId: platform, name: 'Sales executive incentive (Demo)', recipientType: 'SALES_EMPLOYEE', calcType: 'PERCENTAGE', value: 0.5, basis: 'DEAL_VALUE', dealType: 'SALE', priority: 10 } });
  await prisma.commissionRule.create({ data: { organizationId: platform, name: 'Sales manager override (Demo)', recipientType: 'SALES_MANAGER', calcType: 'PERCENTAGE', value: 0.1, basis: 'DEAL_VALUE', dealType: 'SALE', priority: 20 } });
  await prisma.commissionRule.create({ data: { organizationId: platform, name: 'Lead provider payout (Demo)', recipientType: 'LEAD_PROVIDER', calcType: 'PERCENTAGE', value: 0.25, basis: 'DEAL_VALUE', leadProviderId: leadProvider.id, priority: 30, maxPayout: 25000 } });
  await prisma.commissionRule.create({ data: { organizationId: platform, name: 'Co-broking share (Demo)', recipientType: 'BROKER', calcType: 'PERCENTAGE', value: 1, basis: 'DEAL_VALUE', priority: 40 } });
  const amount = Math.round(Number(unitA03.totalPrice) * 0.005 * 100) / 100;
  await prisma.commissionRecord.create({ data: { organizationId: platform, dealId: deal.id, ruleId: ruleSales.id, recipientType: 'SALES_EMPLOYEE', recipientUserId: sales1.id, recipientName: sales1.fullName, basisAmount: unitA03.totalPrice, calcType: 'PERCENTAGE', rate: 0.5, amount, status: 'PENDING_APPROVAL' } });

  // Unit reservation for the hot lead on plot A-04
  const unitA04 = await prisma.projectUnit.findFirstOrThrow({ where: { projectId: gv.id, code: 'A-04' } });
  await prisma.projectUnit.update({ where: { id: unitA04.id }, data: { status: 'RESERVED', version: { increment: 1 } } });
  await prisma.unitReservation.create({ data: { unitId: unitA04.id, leadId: leadIds['Neha Srivastava'], status: 'ACTIVE', expiresAt: daysAhead(2), reservedById: sales2.id, notes: 'Held pending negotiation' } });
  await prisma.unitStatusHistory.create({ data: { unitId: unitA04.id, fromStatus: 'AVAILABLE', toStatus: 'RESERVED', leadId: leadIds['Neha Srivastava'], reason: 'Reserved for lead during negotiation', changedById: sales2.id } });

  // Tasks
  await prisma.employeeTask.create({ data: { organizationId: platform, title: 'Prepare Green Valley price sheet for weekend site visits', assignedToId: sales1.id, createdById: salesMgr.id, dueAt: daysAhead(1, 17), priority: 'HIGH' } });
  await prisma.employeeTask.create({ data: { organizationId: platform, title: 'Call back Commerce Square booking-pending lead', assignedToId: sales3.id, createdById: salesMgr.id, leadId: leadIds['Sandeep Yadav'], dueAt: daysAhead(0, 16), priority: 'URGENT' } });

  // ───────────── Finance ─────────────
  const cat = async (name: string) => (await prisma.expenseCategory.findFirstOrThrow({ where: { organizationId: platform, name } })).id;
  await prisma.expense.create({ data: { organizationId: platform, categoryId: await cat('Office rent'), amount: 85000, expenseDate: dateOnly(daysAgo(22)), vendor: 'Demo landlord', description: 'Office rent — demo entry', status: 'PAID', createdById: accounts.id, approvedById: admin.id, approvedAt: daysAgo(21), paidAt: daysAgo(20) } });
  await prisma.expense.create({ data: { organizationId: platform, categoryId: await cat('Marketing & advertising'), amount: 42500, expenseDate: dateOnly(daysAgo(9)), vendor: 'Demo ad agency', description: 'Green Valley social campaign — demo entry', status: 'APPROVED', createdById: accounts.id, approvedById: admin.id, approvedAt: daysAgo(8) } });
  await prisma.expense.create({ data: { organizationId: platform, categoryId: await cat('Software & subscriptions'), amount: 6999, expenseDate: dateOnly(daysAgo(2)), vendor: 'Demo SaaS vendor', description: 'CRM telephony add-on — demo entry', status: 'PENDING', createdById: accounts.id } });
  const invoice = await prisma.invoice.create({
    data: {
      invoiceNo: await nextRef(prisma, 'INV'),
      organizationId: platform,
      billToName: d1.org.name,
      billToOrganizationId: d1.org.id,
      issueDate: dateOnly(daysAgo(12)),
      dueDate: dateOnly(daysAhead(18)),
      status: 'PARTIALLY_PAID',
      subtotal: 250000,
      taxTotal: 45000,
      total: 295000,
      amountPaid: 100000,
      notes: 'Demo invoice — tax rate entered on the line by the accountant.',
      createdById: accounts.id,
      lines: { create: [{ description: 'Sales & marketing services — Commerce Square (demo)', quantity: 1, unitPrice: 250000, taxRate: 18, amount: 250000, taxAmount: 45000 }] },
    },
  });
  await prisma.financeTransaction.create({ data: { txnNo: await nextRef(prisma, 'TXN'), organizationId: platform, type: 'INVOICE_RECEIPT', direction: 'INFLOW', amount: 100000, txnDate: dateOnly(daysAgo(5)), method: 'BANK_TRANSFER', referenceNo: 'DEMO-RTGS-0042', counterparty: d1.org.name, invoiceId: invoice.id, recordedById: accounts.id, description: 'Part payment' } });
  await prisma.financeTransaction.create({ data: { txnNo: await nextRef(prisma, 'TXN'), organizationId: platform, type: 'EXPENSE_PAYMENT', direction: 'OUTFLOW', amount: 85000, txnDate: dateOnly(daysAgo(20)), method: 'BANK_TRANSFER', counterparty: 'Demo landlord', description: 'Office rent', recordedById: accounts.id } });
  await prisma.financeTransaction.create({ data: { txnNo: await nextRef(prisma, 'TXN'), organizationId: platform, type: 'CUSTOMER_PAYMENT', direction: 'INFLOW', amount: 200000, txnDate: dateOnly(daysAgo(3)), method: 'BANK_TRANSFER', referenceNo: 'DEMO-NEFT-0001', counterparty: 'Shalini Saxena', dealId: deal.id, recordedById: accounts.id, description: 'Booking amount — Green Valley A-03 (demo)' } });

  // ───────────── CMS ─────────────
  const legalCallout = { type: 'CALLOUT', tone: 'warning', text: 'Template content for development. This page must be reviewed and completed by the company’s legal advisers before production use.' };
  await prisma.cmsPage.createMany({
    data: [
      {
        slug: 'about-us',
        title: 'About us',
        status: 'PUBLISHED',
        showInFooter: true,
        footerGroup: 'Company',
        publishedAt: now,
        seoDescription: 'How our Lucknow property marketplace works.',
        blocks: [
          { type: 'PARAGRAPH', text: 'We are a Lucknow-based real estate marketplace that brings together our own projects, verified brokers, developers and individual owners on one platform.' },
          { type: 'HEADING', text: 'How listings are reviewed', level: 2 },
          { type: 'PARAGRAPH', text: 'Every listing is reviewed by our operations team before it is published. Listings marked “Verified” have had ownership or authorisation documents checked by our team.' },
          { type: 'HEADING', text: 'How enquiries are handled', level: 2 },
          { type: 'LIST', ordered: true, items: ['You submit an enquiry and receive a reference number.', 'A relationship manager is assigned and contacts you.', 'Site visits are scheduled at a time that suits you.', 'Bookings are completed offline with written confirmation — we never take property payments on this website.'] },
        ],
      },
      { slug: 'privacy-policy', title: 'Privacy policy', status: 'PUBLISHED', showInFooter: true, footerGroup: 'Legal', publishedAt: now, blocks: [legalCallout, { type: 'PARAGRAPH', text: 'This policy describes what personal information we collect when you use the website (for example your name, phone number and email when you submit an enquiry), why we collect it, who we share it with (only the seller, agent or developer you enquire about) and how you can request access or deletion.' }] },
      { slug: 'terms-of-use', title: 'Terms of use', status: 'PUBLISHED', showInFooter: true, footerGroup: 'Legal', publishedAt: now, blocks: [legalCallout, { type: 'PARAGRAPH', text: 'These terms govern the use of the website by buyers, tenants, brokers, developers and owners, including listing rules, prohibited content and limitations of liability.' }] },
      { slug: 'listing-guidelines', title: 'Listing guidelines', status: 'PUBLISHED', showInFooter: true, footerGroup: 'Partners', publishedAt: now, blocks: [{ type: 'LIST', ordered: false, items: ['List only properties you own or are authorised to market.', 'Use real photographs of the property.', 'Show the full price; do not list a token or partial amount as the price.', 'Mark properties as sold or rented as soon as they are no longer available.'] }, { type: 'FAQ_GROUP', category: 'Partners' }] },
    ],
  });
  await prisma.faq.createMany({
    data: [
      { category: 'General', question: 'What does “Verified” mean on a listing?', answer: 'Our team has checked the documents that show the lister owns the property or is authorised to market it. Unverified listings have been reviewed for content but their documents have not yet been checked.', sortOrder: 1 },
      { category: 'General', question: 'How do I schedule a site visit?', answer: 'Open the property or project page and choose “Schedule a site visit”. Pick a preferred date and time slot and our team will confirm the appointment.', sortOrder: 2 },
      { category: 'General', question: 'Is my phone number shared publicly?', answer: 'No. Your details are shared only with the seller, agent or developer of the property you enquire about, and with our sales team.', sortOrder: 3 },
      { category: 'Projects', question: 'How is project availability calculated?', answer: 'Available units come straight from the project’s live inventory. Booked, reserved and sold units are never shown as available.', sortOrder: 1 },
      { category: 'Partners', question: 'How do I list properties as a broker?', answer: 'Register as a partner, upload your business documents and wait for verification. Once your account is approved you can publish listings after review.', sortOrder: 1 },
    ],
  });
  await prisma.systemSetting.upsert({ where: { key: 'contact.email' }, create: { key: 'contact.email', value: 'hello@example.com', group: 'Contact', isPublic: true }, update: {} });
  await prisma.systemSetting.upsert({ where: { key: 'contact.hours' }, create: { key: 'contact.hours', value: 'Mon–Sat, 10 AM – 7 PM', group: 'Contact', isPublic: true }, update: {} });

  void customerUser;
  console.log('  • Development data created (all records flagged as demo)');
}

function describe(s: { title: string; listing: 'SALE' | 'RENT'; locality: string; highlights?: string[] }): string {
  const where = s.locality.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  const intro = s.listing === 'RENT' ? `Available for rent in ${where}, Lucknow.` : `Offered for sale in ${where}, Lucknow.`;
  const body = (s.highlights ?? []).length ? ` Key features: ${(s.highlights ?? []).join('; ')}.` : '';
  return `${s.title}. ${intro}${body}\n\nThis is a demonstration listing created for development and testing — it is not a real property.`;
}
