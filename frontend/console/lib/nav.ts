import type { PermissionKey, WorkspaceKey } from '@estate/shared';
import {
  Activity,
  BadgeCheck,
  Banknote,
  BarChart3,
  Bell,
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Coins,
  CreditCard,
  FileText,
  Flag,
  FolderKanban,
  Globe,
  Handshake,
  Home,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Layers,
  ListChecks,
  MapPin,
  Megaphone,
  Network,
  PiggyBank,
  Receipt,
  ScrollText,
  Send,
  Settings,
  ShieldCheck,
  Target,
  UserCircle,
  UserCog,
  Users,
  Wallet,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Shown when the user holds ANY of these permissions (in any scope). */
  anyOf?: PermissionKey[];
  /** Restrict to workspaces (default: all). */
  workspaces?: WorkspaceKey[];
  /** Requires an employee record (self-service). */
  employeeOnly?: boolean;
  /**
   * manage — running the business (approvals, people, finance, website, settings): the Administration workspace,
   *          and the staff portal only for people who have no Administration workspace (e.g. a sales manager);
   * self   — your own records (attendance, leave, payslips…): the staff portal;
   * work   — day-to-day work (default): every workspace where the permission allows it.
   */
  area?: 'manage' | 'self' | 'work';
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

const PLATFORM: WorkspaceKey[] = ['admin', 'staff'];
const PARTNER: WorkspaceKey[] = ['broker', 'developer', 'owner'];

export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', href: '/', icon: LayoutDashboard },
      { label: 'Reports', href: '/reports', icon: BarChart3, area: 'manage', anyOf: ['report.view'], workspaces: PLATFORM },
      { label: 'Notifications', href: '/notifications', icon: Bell },
    ],
  },
  {
    label: 'Marketplace',
    items: [
      { label: 'Listings', href: '/listings', icon: Home, anyOf: ['property.view_all'] },
      { label: 'Listing approvals', href: '/listings/reviews', icon: ClipboardCheck, area: 'manage', anyOf: ['property.approve'], workspaces: PLATFORM },
      { label: 'Listing reports', href: '/listings/reports', icon: Flag, area: 'manage', anyOf: ['property.report.manage'], workspaces: PLATFORM },
      { label: 'Projects', href: '/projects', icon: Building2, anyOf: ['project.view_all'], workspaces: [...PLATFORM, 'developer'] },
      { label: 'Project approvals', href: '/projects/reviews', icon: BadgeCheck, area: 'manage', anyOf: ['project.approve'], workspaces: PLATFORM },
    ],
  },
  {
    label: 'Sales & CRM',
    items: [
      { label: 'Leads', href: '/crm/leads', icon: Target, anyOf: ['lead.view_all', 'lead.view_assigned'], workspaces: [...PLATFORM, ...PARTNER] },
      { label: 'Enquiries', href: '/crm/enquiries', icon: Inbox, anyOf: ['enquiry.view'], workspaces: [...PLATFORM, ...PARTNER] },
      { label: 'Follow-ups', href: '/crm/follow-ups', icon: CalendarClock, anyOf: ['lead.view_all', 'lead.view_assigned'], workspaces: [...PLATFORM, 'broker', 'developer'] },
      { label: 'Site visits', href: '/crm/site-visits', icon: CalendarCheck, anyOf: ['site_visit.manage'], workspaces: [...PLATFORM, 'broker', 'developer'] },
      { label: 'Customers', href: '/crm/customers', icon: Users, anyOf: ['customer.view'], workspaces: [...PLATFORM, 'broker', 'developer'] },
      { label: 'Deals & bookings', href: '/crm/deals', icon: Handshake, anyOf: ['deal.view'], workspaces: [...PLATFORM, 'broker', 'developer'] },
      { label: 'Teams & routing', href: '/crm/routing', icon: Workflow, area: 'manage', anyOf: ['assignment.manage'], workspaces: [...PLATFORM, 'broker'] },
      { label: 'Campaigns', href: '/crm/campaigns', icon: Megaphone, area: 'manage', anyOf: ['marketing.manage'], workspaces: PLATFORM },
      { label: 'Lead providers', href: '/crm/lead-providers', icon: Network, area: 'manage', anyOf: ['lead_provider.manage'], workspaces: PLATFORM },
    ],
  },
  {
    label: 'Lead partner',
    items: [
      { label: 'Submit leads', href: '/provider/submit', icon: Send, anyOf: ['lead_provider.portal'], workspaces: ['lead-provider'] },
      { label: 'My leads', href: '/provider/leads', icon: ListChecks, anyOf: ['lead_provider.portal'], workspaces: ['lead-provider'] },
      { label: 'Commission statement', href: '/provider/statement', icon: Coins, anyOf: ['lead_provider.portal'], workspaces: ['lead-provider'] },
    ],
  },
  {
    label: 'Partners',
    items: [
      { label: 'Brokers & developers', href: '/partners', icon: ShieldCheck, area: 'manage', anyOf: ['broker.verify', 'developer.verify', 'broker.view', 'developer.view'], workspaces: PLATFORM },
      { label: 'Subscription plans', href: '/partners/plans', icon: CreditCard, area: 'manage', anyOf: ['subscription.manage'], workspaces: PLATFORM },
      { label: 'My organisation', href: '/organization', icon: Building2, anyOf: ['organization.manage'], workspaces: [...PARTNER, 'lead-provider'] },
    ],
  },
  {
    label: 'People',
    items: [
      { label: 'Employees', href: '/hr/employees', icon: UserCog, area: 'manage', anyOf: ['employee.view', 'employee.manage'], workspaces: PLATFORM },
      { label: 'Organisation structure', href: '/hr/structure', icon: Layers, area: 'manage', anyOf: ['employee.manage'], workspaces: PLATFORM },
      { label: 'Attendance', href: '/hr/attendance', icon: CalendarDays, area: 'manage', anyOf: ['attendance.manage'], workspaces: PLATFORM },
      { label: 'Leave', href: '/hr/leave', icon: CalendarCheck, area: 'manage', anyOf: ['leave.approve', 'leave.manage'], workspaces: PLATFORM },
      { label: 'Tasks', href: '/hr/tasks', icon: ClipboardList, area: 'manage', anyOf: ['task.manage'], workspaces: PLATFORM },
    ],
  },
  {
    label: 'Finance',
    items: [
      { label: 'Payroll', href: '/payroll', icon: Wallet, area: 'manage', anyOf: ['payroll.view', 'payroll.manage'], workspaces: PLATFORM },
      { label: 'Commissions', href: '/commissions', icon: Coins, area: 'manage', anyOf: ['commission.view', 'commission.manage'], workspaces: PLATFORM },
      { label: 'Transactions', href: '/finance/transactions', icon: Activity, area: 'manage', anyOf: ['finance.view'], workspaces: PLATFORM },
      { label: 'Invoices', href: '/finance/invoices', icon: Receipt, area: 'manage', anyOf: ['finance.view'], workspaces: PLATFORM },
      { label: 'Expenses', href: '/finance/expenses', icon: Banknote, area: 'manage', anyOf: ['finance.view'], workspaces: PLATFORM },
      { label: 'Reimbursements', href: '/finance/reimbursements', icon: PiggyBank, area: 'manage', anyOf: ['finance.view'], workspaces: PLATFORM },
      { label: 'Commission statement', href: '/statement', icon: Coins, anyOf: ['commission.self'], workspaces: ['broker'] },
    ],
  },
  {
    label: 'My workspace',
    items: [
      { label: 'My attendance', href: '/me/attendance', icon: CalendarDays, area: 'self', employeeOnly: true },
      { label: 'My leave', href: '/me/leave', icon: CalendarCheck, area: 'self', employeeOnly: true },
      { label: 'My tasks', href: '/me/tasks', icon: ListChecks, area: 'self', employeeOnly: true },
      { label: 'Payslips', href: '/me/payslips', icon: FileText, area: 'self', employeeOnly: true },
      { label: 'Reimbursements', href: '/me/reimbursements', icon: PiggyBank, area: 'self', employeeOnly: true },
      { label: 'My incentives', href: '/me/commissions', icon: Coins, area: 'self', employeeOnly: true },
    ],
  },
  {
    label: 'Website',
    items: [
      { label: 'Pages & content', href: '/cms/pages', icon: ScrollText, area: 'manage', anyOf: ['cms.manage'], workspaces: PLATFORM },
      { label: 'Homepage & banners', href: '/cms/home', icon: Globe, area: 'manage', anyOf: ['cms.manage'], workspaces: PLATFORM },
      { label: 'FAQs & SEO', href: '/cms/seo', icon: FolderKanban, area: 'manage', anyOf: ['cms.manage'], workspaces: PLATFORM },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Users', href: '/admin/users', icon: UserCircle, area: 'manage', anyOf: ['user.manage'], workspaces: PLATFORM },
      { label: 'Roles & permissions', href: '/admin/roles', icon: KeyRound, area: 'manage', anyOf: ['role.manage', 'user.manage'], workspaces: PLATFORM },
      { label: 'Locations', href: '/admin/locations', icon: MapPin, area: 'manage', anyOf: ['location.manage'], workspaces: PLATFORM },
      { label: 'Property catalogue', href: '/admin/catalog', icon: Layers, area: 'manage', anyOf: ['catalog.manage'], workspaces: PLATFORM },
      { label: 'Notifications', href: '/admin/notifications', icon: Bell, area: 'manage', anyOf: ['notification.manage'], workspaces: PLATFORM },
      { label: 'Audit log', href: '/admin/audit', icon: ScrollText, area: 'manage', anyOf: ['audit.view'], workspaces: PLATFORM },
      { label: 'Settings', href: '/admin/settings', icon: Settings, area: 'manage', anyOf: ['settings.manage'], workspaces: PLATFORM },
    ],
  },
];

export const WORKSPACE_LABELS: Record<WorkspaceKey, string> = {
  admin: 'Administration',
  staff: 'Staff portal',
  broker: 'Broker workspace',
  developer: 'Developer workspace',
  'lead-provider': 'Lead partner portal',
  owner: 'Owner workspace',
};

export const WORKSPACE_DESCRIPTIONS: Record<WorkspaceKey, string> = {
  admin: 'Run the business — approvals, people, finance, website and settings',
  staff: 'Your own work — leads, follow-ups, attendance, leave and payslips',
  broker: 'Your agency’s listings, leads and team',
  developer: 'Your projects, inventory and leads',
  'lead-provider': 'Submit leads and track your commission',
  owner: 'Your own property listings and enquiries',
};

export function visibleNav(opts: { workspace: WorkspaceKey; workspaces: WorkspaceKey[]; canAny: (p: PermissionKey[]) => boolean; isEmployee: boolean }): NavGroup[] {
  const hasAdministration = opts.workspaces.includes('admin');
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((it) => {
      if (it.workspaces && !it.workspaces.includes(opts.workspace)) return false;
      if (it.area === 'manage' && opts.workspace === 'staff' && hasAdministration) return false;
      if (it.area === 'self' && opts.workspace !== 'staff') return false;
      if (it.employeeOnly) return opts.isEmployee && opts.workspace === 'staff';
      return !it.anyOf || opts.canAny(it.anyOf);
    }),
  })).filter((g) => g.items.length > 0);
}
