import * as shared from '@estate/shared';
import { $Enums } from '../generated/prisma/client';
import { decryptField, encryptField, hashPassword, verifyPassword } from './crypto';
import { detectFileType } from '../modules/files/files.service';
import { AuthUser } from './auth/auth-user';

describe('enum parity between Prisma schema and @estate/shared', () => {
  const pairs: [string, readonly string[], Record<string, string>][] = [
    ['PropertyStatus', shared.PROPERTY_STATUSES, $Enums.PropertyStatus],
    ['ProjectStatus', shared.PROJECT_STATUSES, $Enums.ProjectStatus],
    ['UnitStatus', shared.UNIT_STATUSES, $Enums.UnitStatus],
    ['LeadStatus', shared.LEAD_STATUSES, $Enums.LeadStatus],
    ['EnquiryType', shared.ENQUIRY_TYPES, $Enums.EnquiryType],
    ['DomainStatus', shared.DOMAIN_STATUSES, $Enums.DomainStatus],
    ['CommissionStatus', shared.COMMISSION_STATUSES, $Enums.CommissionStatus],
    ['PayrollStatus', shared.PAYROLL_STATUSES, $Enums.PayrollStatus],
    ['AreaUnit', shared.AREA_UNITS, $Enums.AreaUnit],
    ['FormProfile', shared.FORM_PROFILE_KEYS, $Enums.FormProfile],
    ['OrganizationType', shared.ORGANIZATION_TYPES, $Enums.OrganizationType],
    ['DealStatus', shared.DEAL_STATUSES, $Enums.DealStatus],
    ['SiteVisitStatus', shared.SITE_VISIT_STATUSES, $Enums.SiteVisitStatus],
    ['AttendanceStatus', shared.ATTENDANCE_STATUSES, $Enums.AttendanceStatus],
  ];
  it.each(pairs)('%s matches', (_name, sharedValues, prismaEnum) => {
    expect([...sharedValues].sort()).toEqual(Object.values(prismaEnum).sort());
  });
});

describe('field encryption', () => {
  it('round-trips and detects tampering', () => {
    const payload = encryptField('1234567890123456');
    expect(payload.startsWith('v1.')).toBe(true);
    expect(payload).not.toContain('1234567890');
    expect(decryptField(payload)).toBe('1234567890123456');
    const parts = payload.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptField(parts.join('.'))).toThrow();
  });

  it('hashes passwords with argon2id', async () => {
    const hash = await hashPassword('Correct-Horse-1');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'Correct-Horse-1')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });
});

describe('upload type detection (magic bytes)', () => {
  it('recognises real file signatures and rejects disguised content', () => {
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))?.mime).toBe('image/jpeg');
    expect(detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime).toBe('image/png');
    expect(detectFileType(Buffer.from('%PDF-1.7\n%...'))?.kind).toBe('pdf');
    expect(detectFileType(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]))).toBeNull(); // Windows executable
  });
});

describe('AuthUser scope rules', () => {
  const user = new AuthUser(
    'u1',
    's1',
    'Test',
    null,
    null,
    'BROKER',
    [
      { key: 'BROKER', name: 'Broker', organizationId: 'org-a', permissions: ['property.edit', 'lead.view_all'] },
      { key: 'X', name: 'Viewer', organizationId: null, permissions: ['report.view'] },
    ],
    [],
    null,
    null,
  );
  it('applies organisation grants only to that organisation', () => {
    expect(user.can('property.edit', 'org-a')).toBe(true);
    expect(user.can('property.edit', 'org-b')).toBe(false);
    expect(user.orgsWith('lead.view_all')).toEqual(['org-a']);
    expect(user.orgsWith('report.view')).toBe('ALL');
    expect(() => user.assert('property.edit', 'org-b')).toThrow();
  });
});

describe('partial updates and query booleans', () => {
  const { z } = require('zod') as typeof import('zod');
  const { PatchPipe } = require('./zod.pipe') as typeof import('./zod.pipe');
  const city = z.object({ name: z.string().min(2), isActive: z.boolean().default(false), sortOrder: z.number().default(0) });

  it('PatchPipe returns only the fields that were sent — defaults never reset omitted fields', () => {
    expect(new PatchPipe(city).transform({ name: 'Kanpur' })).toEqual({ name: 'Kanpur' });
    expect(new PatchPipe(city).transform({ isActive: true })).toEqual({ isActive: true });
    expect(() => new PatchPipe(city).transform({ name: 'K' })).toThrow();
  });

  it('PatchPipe keeps refinements of schemas that are already partial', () => {
    const range = z
      .object({ from: z.number().optional(), to: z.number().optional(), status: z.string().default('DRAFT') })
      .refine((v) => v.from === undefined || v.to === undefined || v.to >= v.from, { path: ['to'] });
    const pipe = new PatchPipe(range, { alreadyPartial: true });
    expect(pipe.transform({ from: 1 })).toEqual({ from: 1 });
    expect(() => pipe.transform({ from: 5, to: 1 })).toThrow();
  });

  it('queryBoolean only accepts explicit values ("false" is false)', () => {
    expect(shared.queryBoolean.parse('false')).toBe(false);
    expect(shared.queryBoolean.parse('0')).toBe(false);
    expect(shared.queryBoolean.parse('true')).toBe(true);
    expect(shared.queryBoolean.parse('')).toBeUndefined();
    expect(shared.queryBoolean.parse('maybe')).toBeUndefined();
  });

  it('empty optional property attributes are accepted and dropped', () => {
    expect(shared.propertyAttributesSchema.parse({ liftAvailable: undefined, powerBackup: null, waterSupply: '', societyName: 'Shalimar' })).toEqual({ societyName: 'Shalimar' });
  });
});
