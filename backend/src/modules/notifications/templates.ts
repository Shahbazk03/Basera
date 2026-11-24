import type { NotificationChannel } from '@prisma/client';

export interface TemplateDefinition {
  subject?: string;
  body: string;
}

/**
 * Built-in templates (used until an administrator customises them in the console).
 * Placeholders use {{name}} syntax and are always inserted as escaped plain text.
 */
export const DEFAULT_TEMPLATES: Record<string, Partial<Record<NotificationChannel, TemplateDefinition>>> = {
  'auth.verify_email': {
    EMAIL: {
      subject: 'Verify your email for {{brand}}',
      body: 'Hello {{name}},\n\nPlease confirm your email address by opening the link below:\n{{link}}\n\nThe link expires in 24 hours. If you did not create an account, you can ignore this email.\n\n— {{brand}}',
    },
  },
  'auth.password_reset': {
    EMAIL: {
      subject: 'Reset your {{brand}} password',
      body: 'Hello {{name}},\n\nWe received a request to reset your password. Open the link below to choose a new one:\n{{link}}\n\nThe link expires in 60 minutes. If you did not request this, no action is needed.\n\n— {{brand}}',
    },
  },
  'auth.password_set_by_admin': {
    EMAIL: {
      subject: 'Your new {{brand}} password',
      body: 'Hello {{name}},\n\n{{administrator}} has set a new password for your {{brand}} account.\n\nTemporary password: {{password}}\n\nSign in here: {{link}}\nYou will be asked to choose your own password straight after signing in.\n\nIf you did not expect this, contact your administrator.\n\n— {{brand}}',
    },
  },
  'enquiry.received': {
    IN_APP: { subject: 'New enquiry {{reference}}', body: '{{customerName}} enquired about {{subject}}.' },
    EMAIL: {
      subject: 'New enquiry {{reference}} — {{subject}}',
      body: 'A new {{enquiryType}} enquiry was received.\n\nReference: {{reference}}\nCustomer: {{customerName}}\nRegarding: {{subject}}\n\nOpen the console to respond: {{link}}',
    },
  },
  'enquiry.acknowledgement': {
    EMAIL: {
      subject: 'We received your enquiry ({{reference}})',
      body: 'Hello {{name}},\n\nThank you for your interest in {{subject}}. Your reference number is {{reference}}. Our team will contact you shortly.\n\n— {{brand}}',
    },
    SMS: { body: '{{brand}}: Thanks {{name}}, we received your enquiry {{reference}} for {{subject}}. Our team will call you shortly.' },
    WHATSAPP: { body: 'Hello {{name}}, thank you for your enquiry about {{subject}}. Your reference is {{reference}}. Our team will contact you shortly. — {{brand}}' },
  },
  'lead.assigned': {
    IN_APP: { subject: 'Lead assigned: {{leadName}}', body: '{{leadNo}} ({{subject}}) has been assigned to you.' },
    EMAIL: {
      subject: 'New lead assigned — {{leadName}}',
      body: 'Hello {{name}},\n\nLead {{leadNo}} ({{leadName}}) regarding {{subject}} has been assigned to you.\nOpen: {{link}}',
    },
  },
  'followup.due': {
    IN_APP: { subject: 'Follow-up due: {{leadName}}', body: '{{followUpType}} follow-up with {{leadName}} is due at {{dueAt}}.' },
    EMAIL: { subject: 'Follow-up due — {{leadName}}', body: 'Reminder: your {{followUpType}} follow-up with {{leadName}} ({{leadNo}}) is due at {{dueAt}}.\nOpen: {{link}}' },
  },
  'sitevisit.scheduled': {
    IN_APP: { subject: 'Site visit scheduled', body: 'Site visit with {{customerName}} for {{subject}} on {{when}}.' },
    SMS: { body: '{{brand}}: Your site visit for {{subject}} is scheduled on {{when}}. Ref {{leadNo}}.' },
    EMAIL: { subject: 'Your site visit is scheduled — {{subject}}', body: 'Hello {{customerName}},\n\nYour site visit for {{subject}} is scheduled on {{when}}.\n\n— {{brand}}' },
  },
  'partner.registered': {
    IN_APP: { subject: 'New {{partnerType}} registration', body: '{{organizationName}} registered and is awaiting verification.' },
    EMAIL: { subject: 'New partner awaiting verification — {{organizationName}}', body: '{{organizationName}} ({{partnerType}}) registered and is awaiting verification.\nReview: {{link}}' },
  },
  'partner.decided': {
    IN_APP: { subject: 'Account {{decision}}', body: 'Your organisation {{organizationName}} was {{decision}}. {{reason}}' },
    EMAIL: { subject: 'Your {{brand}} partner account was {{decision}}', body: 'Hello {{name}},\n\nYour organisation {{organizationName}} was {{decision}}.\n{{reason}}\n\nSign in: {{link}}\n\n— {{brand}}' },
  },
  'listing.submitted': {
    IN_APP: { subject: 'Listing awaiting review', body: '{{title}} ({{reference}}) was submitted for review.' },
  },
  'listing.decided': {
    IN_APP: { subject: 'Listing {{decision}}', body: '{{title}} ({{reference}}) was {{decision}}. {{reason}}' },
    EMAIL: { subject: 'Your listing was {{decision}} — {{reference}}', body: 'Hello {{name}},\n\nYour listing "{{title}}" ({{reference}}) was {{decision}}.\n{{reason}}\n\nOpen: {{link}}\n\n— {{brand}}' },
  },
  'project.status_changed': {
    IN_APP: { subject: '{{projectName}}: {{status}}', body: 'Project {{projectName}} is now {{status}}.' },
  },
  'project.review': {
    IN_APP: { subject: 'Project awaiting review', body: '{{projectName}} was submitted for review.' },
  },
  'domain.verification': {
    IN_APP: { subject: 'Domain {{hostname}}: {{result}}', body: 'Verification of {{hostname}} for {{projectName}}: {{result}}. {{detail}}' },
    EMAIL: { subject: 'Domain {{hostname}} — {{result}}', body: 'Verification of {{hostname}} for {{projectName}}: {{result}}.\n{{detail}}' },
  },
  'leave.requested': {
    IN_APP: { subject: 'Leave request from {{employeeName}}', body: '{{employeeName}} requested {{days}} day(s) of {{leaveType}} from {{from}} to {{to}}.' },
  },
  'leave.decided': {
    IN_APP: { subject: 'Leave {{decision}}', body: 'Your {{leaveType}} request ({{from}} – {{to}}) was {{decision}}. {{note}}' },
    EMAIL: { subject: 'Your leave request was {{decision}}', body: 'Hello {{name}},\n\nYour {{leaveType}} request from {{from}} to {{to}} was {{decision}}.\n{{note}}' },
  },
  'payroll.approved': {
    IN_APP: { subject: 'Payroll approved: {{period}}', body: 'Payroll for {{period}} was approved by {{approver}}.' },
  },
  'payslip.available': {
    IN_APP: { subject: 'Payslip available: {{period}}', body: 'Your payslip for {{period}} is available.' },
    EMAIL: { subject: 'Your payslip for {{period}}', body: 'Hello {{name}},\n\nYour payslip for {{period}} is available in the staff portal: {{link}}' },
  },
};

export function renderTemplate(text: string, data: Record<string, unknown>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const v = data[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
