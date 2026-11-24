/**
 * Permission catalogue. Seeded into the `permissions` table; system roles below are seeded into
 * `roles`/`role_permissions`. Administrators can create additional roles from these permissions.
 *
 * Scope semantics (enforced by the API):
 *   • A role granted with organizationId = NULL applies platform-wide (all organisations).
 *   • A role granted with an organizationId applies only to resources owned by that organisation.
 */

export const PERMISSIONS = {
  // Dashboard & reporting
  'dashboard.view': { group: 'General', description: 'View the dashboard for the active workspace' },
  'report.view': { group: 'General', description: 'View business reports' },

  // Marketplace
  'property.view_all': { group: 'Properties', description: 'View all listings (including unpublished) in scope' },
  'property.create': { group: 'Properties', description: 'Create property listings' },
  'property.edit': { group: 'Properties', description: 'Edit property listings in scope' },
  'property.delete': { group: 'Properties', description: 'Delete (archive) property listings in scope' },
  'property.approve': { group: 'Properties', description: 'Approve or reject listings submitted for review' },
  'property.feature': { group: 'Properties', description: 'Mark listings as featured' },
  'property.report.manage': { group: 'Properties', description: 'Review listing reports from the public' },
  'catalog.manage': { group: 'Properties', description: 'Manage property types and amenities' },
  'location.manage': { group: 'Properties', description: 'Manage states, cities and localities' },

  // Projects
  'project.view_all': { group: 'Projects', description: 'View all projects (including drafts) in scope' },
  'project.create': { group: 'Projects', description: 'Create projects' },
  'project.edit': { group: 'Projects', description: 'Edit projects in scope' },
  'project.delete': { group: 'Projects', description: 'Archive projects in scope' },
  'project.approve': { group: 'Projects', description: 'Approve or reject projects submitted for review' },
  'project.publish': { group: 'Projects', description: 'Publish or unpublish project pages' },
  'project.inventory.manage': { group: 'Projects', description: 'Manage blocks, units and reservations' },
  'project.page.manage': { group: 'Projects', description: 'Edit project microsite pages' },
  'project.domain.manage': { group: 'Projects', description: 'Manage project subdomains and custom domains' },

  // Partners
  'broker.view': { group: 'Partners', description: 'View broker organisations' },
  'broker.verify': { group: 'Partners', description: 'Verify, approve, suspend brokers' },
  'developer.view': { group: 'Partners', description: 'View developer organisations' },
  'developer.verify': { group: 'Partners', description: 'Verify, approve, suspend developers' },
  'organization.manage': { group: 'Partners', description: 'Manage own organisation profile, documents and team' },
  'subscription.manage': { group: 'Partners', description: 'Manage subscription plans and assignments' },

  // CRM
  'customer.view': { group: 'CRM', description: 'View customers in scope' },
  'customer.manage': { group: 'CRM', description: 'Create and edit customers in scope' },
  'enquiry.view': { group: 'CRM', description: 'View enquiries in scope' },
  'enquiry.manage': { group: 'CRM', description: 'Process enquiries (mark spam, close)' },
  'lead.view_all': { group: 'CRM', description: 'View all leads in scope' },
  'lead.view_assigned': { group: 'CRM', description: 'View leads assigned to self' },
  'lead.create': { group: 'CRM', description: 'Create leads manually' },
  'lead.edit': { group: 'CRM', description: 'Update leads, log activities and follow-ups' },
  'lead.assign': { group: 'CRM', description: 'Assign and reassign leads' },
  'lead.import': { group: 'CRM', description: 'Import leads from CSV' },
  'lead.export': { group: 'CRM', description: 'Export leads' },
  'lead_provider.manage': { group: 'CRM', description: 'Manage lead providers' },
  'lead_provider.portal': { group: 'CRM', description: 'Submit leads as a lead provider' },
  'assignment.manage': { group: 'CRM', description: 'Manage sales teams and assignment rules' },
  'site_visit.manage': { group: 'CRM', description: 'Schedule and update site visits' },
  'deal.view': { group: 'CRM', description: 'View deals and bookings in scope' },
  'deal.manage': { group: 'CRM', description: 'Create and update deals and bookings' },
  'marketing.manage': { group: 'CRM', description: 'Manage marketing campaigns' },

  // People
  'employee.view': { group: 'People', description: 'View employee directory and profiles' },
  'employee.manage': { group: 'People', description: 'Create and edit employees, departments, designations' },
  'attendance.self': { group: 'People', description: 'Check in/out and view own attendance' },
  'attendance.manage': { group: 'People', description: 'Manage shifts, holidays and attendance corrections' },
  'leave.self': { group: 'People', description: 'Apply for leave and view own balances' },
  'leave.approve': { group: 'People', description: 'Approve leave for direct reports' },
  'leave.manage': { group: 'People', description: 'Manage leave types and all leave requests' },
  'task.manage': { group: 'People', description: 'Create and manage employee tasks' },

  // Payroll & finance
  'payroll.view': { group: 'Finance', description: 'View payroll runs and payslips' },
  'payroll.manage': { group: 'Finance', description: 'Configure salary and prepare payroll' },
  'payroll.approve': { group: 'Finance', description: 'Approve payroll runs (never own payroll)' },
  'payslip.self': { group: 'Finance', description: 'View own payslips' },
  'commission.view': { group: 'Finance', description: 'View commission records' },
  'commission.manage': { group: 'Finance', description: 'Manage commission rules, records and payouts' },
  'commission.approve': { group: 'Finance', description: 'Approve commission records' },
  'commission.self': { group: 'Finance', description: 'View own / own-organisation commission statements' },
  'finance.view': { group: 'Finance', description: 'View transactions, invoices and expenses' },
  'finance.manage': { group: 'Finance', description: 'Record transactions, invoices, expenses and reimbursements' },
  'reimbursement.self': { group: 'Finance', description: 'Submit own reimbursement claims' },

  // Administration
  'cms.manage': { group: 'Administration', description: 'Manage website content, banners, FAQs and SEO' },
  'notification.manage': { group: 'Administration', description: 'Manage notification templates and view delivery logs' },
  'user.manage': { group: 'Administration', description: 'Manage user accounts and role assignments' },
  'role.manage': { group: 'Administration', description: 'Create and edit roles and their permissions' },
  'audit.view': { group: 'Administration', description: 'View audit logs' },
  'settings.manage': { group: 'Administration', description: 'Manage system settings and feature flags' },
} as const satisfies Record<string, { group: string; description: string }>;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export type RoleScope = 'PLATFORM' | 'ORGANIZATION';

export interface SystemRoleDefinition {
  key: string;
  name: string;
  description: string;
  scope: RoleScope;
  permissions: PermissionKey[] | 'ALL';
}

const SELF_SERVICE: PermissionKey[] = [
  'dashboard.view',
  'attendance.self',
  'leave.self',
  'payslip.self',
  'reimbursement.self',
];

export const SYSTEM_ROLES: SystemRoleDefinition[] = [
  {
    key: 'SUPER_ADMIN',
    name: 'Super Admin',
    description: 'Unrestricted platform owner access, including roles and permissions.',
    scope: 'PLATFORM',
    permissions: 'ALL',
  },
  {
    key: 'ADMIN',
    name: 'Admin',
    description: 'Full business administration except role/permission design.',
    scope: 'PLATFORM',
    permissions: (Object.keys(PERMISSIONS) as PermissionKey[]).filter((p) => p !== 'role.manage'),
  },
  {
    key: 'OPERATIONS_MANAGER',
    name: 'Operations Manager',
    description: 'Runs marketplace operations: listings, projects, partners, enquiries and content.',
    scope: 'PLATFORM',
    permissions: [
      ...SELF_SERVICE,
      'report.view',
      'property.view_all',
      'property.create',
      'property.edit',
      'property.approve',
      'property.feature',
      'property.report.manage',
      'catalog.manage',
      'location.manage',
      'project.view_all',
      'project.create',
      'project.edit',
      'project.approve',
      'project.publish',
      'project.inventory.manage',
      'project.page.manage',
      'project.domain.manage',
      'broker.view',
      'broker.verify',
      'developer.view',
      'developer.verify',
      'customer.view',
      'enquiry.view',
      'enquiry.manage',
      'lead.view_all',
      'lead.assign',
      'site_visit.manage',
      'deal.view',
      'cms.manage',
      'task.manage',
    ],
  },
  {
    key: 'SALES_MANAGER',
    name: 'Sales Manager',
    description: 'Manages the sales pipeline, teams, assignment rules and deals.',
    scope: 'PLATFORM',
    permissions: [
      ...SELF_SERVICE,
      'report.view',
      'property.view_all',
      'project.view_all',
      'project.inventory.manage',
      'customer.view',
      'customer.manage',
      'enquiry.view',
      'enquiry.manage',
      'lead.view_all',
      'lead.view_assigned',
      'lead.create',
      'lead.edit',
      'lead.assign',
      'lead.import',
      'lead.export',
      'assignment.manage',
      'site_visit.manage',
      'deal.view',
      'deal.manage',
      'marketing.manage',
      'commission.view',
      'commission.self',
      'employee.view',
      'leave.approve',
      'task.manage',
    ],
  },
  {
    key: 'SALES_EXECUTIVE',
    name: 'Sales Executive',
    description: 'Works assigned leads: calls, follow-ups and site visits.',
    scope: 'PLATFORM',
    permissions: [
      ...SELF_SERVICE,
      'property.view_all',
      'project.view_all',
      'customer.view',
      'enquiry.view',
      'lead.view_assigned',
      'lead.create',
      'lead.edit',
      'site_visit.manage',
      'deal.view',
      'commission.self',
    ],
  },
  {
    key: 'BROKER_MANAGER',
    name: 'Broker Manager',
    description: 'Manages the broker and developer network, verifications, subscriptions and listing approvals.',
    scope: 'PLATFORM',
    permissions: [
      ...SELF_SERVICE,
      'report.view',
      'broker.view',
      'broker.verify',
      'developer.view',
      'developer.verify',
      'subscription.manage',
      'property.view_all',
      'property.approve',
      'property.report.manage',
      'project.view_all',
      'project.approve',
    ],
  },
  {
    key: 'HR_MANAGER',
    name: 'HR Manager',
    description: 'Manages employees, attendance, leave and prepares payroll.',
    scope: 'PLATFORM',
    permissions: [
      ...SELF_SERVICE,
      'report.view',
      'employee.view',
      'employee.manage',
      'attendance.manage',
      'leave.approve',
      'leave.manage',
      'task.manage',
      'payroll.view',
      'payroll.manage',
    ],
  },
  {
    key: 'ACCOUNTANT',
    name: 'Accountant',
    description: 'Finance, invoices, expenses, commission payouts and payroll approval.',
    scope: 'PLATFORM',
    permissions: [
      ...SELF_SERVICE,
      'report.view',
      'deal.view',
      'finance.view',
      'finance.manage',
      'commission.view',
      'commission.manage',
      'commission.approve',
      'payroll.view',
      'payroll.approve',
    ],
  },
  {
    key: 'CUSTOMER_SUPPORT',
    name: 'Customer Support',
    description: 'Handles enquiries and customer queries, reviews listing reports.',
    scope: 'PLATFORM',
    permissions: [
      ...SELF_SERVICE,
      'customer.view',
      'customer.manage',
      'enquiry.view',
      'enquiry.manage',
      'lead.create',
      'property.view_all',
      'project.view_all',
      'property.report.manage',
    ],
  },
  // ── Organisation-scoped roles (always granted with an organizationId) ──
  {
    key: 'BROKER',
    name: 'Broker',
    description: 'Principal of a brokerage: listings, leads, team and organisation profile.',
    scope: 'ORGANIZATION',
    permissions: [
      'dashboard.view',
      'organization.manage',
      'property.view_all',
      'property.create',
      'property.edit',
      'property.delete',
      'customer.view',
      'customer.manage',
      'enquiry.view',
      'enquiry.manage',
      'lead.view_all',
      'lead.create',
      'lead.edit',
      'lead.assign',
      'lead.export',
      'site_visit.manage',
      'deal.view',
      'commission.self',
    ],
  },
  {
    key: 'BROKER_AGENT',
    name: 'Broker Agent',
    description: 'Team member of a brokerage working own listings and assigned leads.',
    scope: 'ORGANIZATION',
    permissions: [
      'dashboard.view',
      'property.view_all',
      'property.create',
      'property.edit',
      'customer.view',
      'enquiry.view',
      'lead.view_assigned',
      'lead.edit',
      'site_visit.manage',
    ],
  },
  {
    key: 'DEVELOPER',
    name: 'Developer',
    description: 'Builder/developer organisation: projects, inventory, enquiries and team.',
    scope: 'ORGANIZATION',
    permissions: [
      'dashboard.view',
      'organization.manage',
      'project.view_all',
      'project.create',
      'project.edit',
      'project.inventory.manage',
      'project.page.manage',
      'property.view_all',
      'property.create',
      'property.edit',
      'customer.view',
      'enquiry.view',
      'enquiry.manage',
      'lead.view_all',
      'lead.edit',
      'lead.assign',
      'site_visit.manage',
      'deal.view',
    ],
  },
  {
    key: 'OWNER',
    name: 'Property Owner',
    description: 'Individual owner listing their own property.',
    scope: 'ORGANIZATION',
    permissions: ['dashboard.view', 'property.view_all', 'property.create', 'property.edit', 'enquiry.view', 'lead.view_all'],
  },
  {
    key: 'LEAD_PROVIDER',
    name: 'Lead Provider',
    description: 'External partner submitting leads and tracking their outcome and commission.',
    scope: 'ORGANIZATION',
    permissions: ['dashboard.view', 'lead_provider.portal', 'commission.self', 'organization.manage'],
  },
];

export function resolveRolePermissions(role: SystemRoleDefinition): PermissionKey[] {
  return role.permissions === 'ALL' ? [...PERMISSION_KEYS] : [...new Set(role.permissions)];
}

/** Permissions as delivered to clients: platform-wide set + per-organisation sets. */
export interface PermissionGrants {
  global: PermissionKey[];
  byOrganization: Record<string, PermissionKey[]>;
}

/** Pure check mirroring the server-side rule (used by UIs to hide controls; the API re-checks). */
export function grantsAllow(grants: PermissionGrants, permission: PermissionKey, organizationId?: string | null): boolean {
  if (grants.global.includes(permission)) return true;
  if (organizationId) return grants.byOrganization[organizationId]?.includes(permission) ?? false;
  return Object.values(grants.byOrganization).some((perms) => perms.includes(permission));
}
