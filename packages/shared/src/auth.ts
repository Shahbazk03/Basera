import { z } from 'zod';
import { phoneSchema } from './crm';
import { ORG_DOCUMENT_TYPES } from './enums';

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Include at least one letter and one number');

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter your email or mobile number').max(160),
  password: z.string().min(1, 'Enter your password').max(128),
});
export type LoginInput = z.input<typeof loginSchema>;

export const customerRegisterSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(100),
  email: z.email('Enter a valid email').max(160),
  phone: phoneSchema,
  password: passwordSchema,
  acceptTerms: z.literal(true, { error: 'Accept the terms to continue' }),
});
export type CustomerRegisterInput = z.input<typeof customerRegisterSchema>;

export const PARTNER_TYPES = ['BROKERAGE', 'DEVELOPER', 'INDIVIDUAL_OWNER'] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];

export const partnerRegisterSchema = z
  .object({
    partnerType: z.enum(PARTNER_TYPES),
    fullName: z.string().trim().min(2, 'Enter your full name').max(100),
    email: z.email('Enter a valid email').max(160),
    phone: phoneSchema,
    password: passwordSchema,
    organizationName: z.string().trim().max(160).optional(),
    businessAddress: z.string().trim().min(5, 'Enter your business address').max(300),
    cityId: z.uuid('Select a city'),
    pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code').optional().or(z.literal('')),
    reraNumber: z.string().trim().max(80).optional(),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[0-9]{2}[A-Z0-9]{13}$/, 'Invalid GSTIN')
      .optional()
      .or(z.literal('')),
    experienceYears: z.coerce.number().int().min(0).max(70).optional(),
    about: z.string().trim().max(2000).optional(),
    website: z.url().optional().or(z.literal('')),
    acceptTerms: z.literal(true, { error: 'Accept the partner terms to continue' }),
  })
  .superRefine((v, ctx) => {
    if (v.partnerType !== 'INDIVIDUAL_OWNER' && (!v.organizationName || v.organizationName.length < 2)) {
      ctx.addIssue({ code: 'custom', path: ['organizationName'], message: 'Enter your business / company name' });
    }
  });
export type PartnerRegisterInput = z.input<typeof partnerRegisterSchema>;

export const leadProviderRegisterSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.email().max(160),
  phone: phoneSchema,
  password: passwordSchema,
  organizationName: z.string().trim().min(2).max(160),
});

export const forgotPasswordSchema = z.object({ email: z.email('Enter a valid email') });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema });
export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });

/**
 * Self-service profile (PATCH /auth/me — send only what changes). The photo is a file uploaded with
 * purpose "avatar"; null removes it. Email and mobile number are sign-in identifiers and are not changed here.
 */
export const profileUpdateSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name').max(100),
  avatarFileId: z.uuid().nullable(),
});

export const organizationUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  legalName: z.string().trim().max(200).optional().nullable(),
  email: z.email().optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(20).optional().nullable(),
  whatsappNumber: z.string().trim().max(20).optional().nullable(),
  website: z.url().optional().nullable().or(z.literal('')),
  logoUrl: z.string().max(2000).optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
  addressLine: z.string().trim().max(300).optional().nullable(),
  cityId: z.uuid().optional().nullable(),
  pincode: z.string().trim().max(10).optional().nullable(),
  gstin: z.string().trim().toUpperCase().max(15).optional().nullable(),
  panNumber: z.string().trim().toUpperCase().max(10).optional().nullable(),
  reraRegistrationNo: z.string().trim().max(80).optional().nullable(),
  showContactPublicly: z.boolean().optional(),
});

export const orgDocumentSchema = z.object({
  docType: z.enum(ORG_DOCUMENT_TYPES),
  title: z.string().trim().min(2).max(160),
  fileId: z.uuid(),
});

export const orgVerificationDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'SUSPEND', 'REACTIVATE']),
  reason: z.string().trim().max(1000).optional(),
  projectPublishMode: z.enum(['REQUIRES_APPROVAL', 'DIRECT']).optional(),
});

export const memberInviteSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.email().max(160),
  phone: phoneSchema.optional(),
  roleKey: z.string().trim().min(2).max(40),
  title: z.string().trim().max(80).optional(),
  password: passwordSchema,
});

export const userRoleGrantSchema = z.object({
  roleKey: z.string().trim().min(2).max(40),
  organizationId: z.uuid().optional().nullable(),
});

export const roleSchema = z.object({
  key: z.string().trim().toUpperCase().min(2).max(40).regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional().nullable(),
  scope: z.enum(['PLATFORM', 'ORGANIZATION']).default('PLATFORM'),
  permissions: z.array(z.string().max(60)).max(200),
});
