/** Response shapes of the CRM endpoints used by console pages. */

export interface LeadRow {
  id: string;
  leadNo: string;
  name: string;
  phone: string;
  email: string | null;
  status: string;
  priority: string;
  intakeStatus: string;
  isDuplicate: boolean;
  enquiryType: string;
  listingType: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  nextFollowUpAt: string | null;
  lastContactedAt: string | null;
  createdAt: string;
  updatedAt: string;
  isDemo: boolean;
  organization: { id: string; name: string; type: string };
  source: { key: string; name: string };
  assignedTo: { id: string; fullName: string } | null;
  project: { id: string; name: string; slug: string } | null;
  property: { id: string; title: string; referenceCode: string; slug: string } | null;
  unit: { id: string; code: string } | null;
  leadProvider: { id: string; name: string } | null;
}

export interface Activity {
  id: string;
  type: string;
  direction: string | null;
  outcome: string | null;
  summary: string;
  details: string | null;
  durationSeconds: number | null;
  occurredAt: string;
  performedBy: { id: string; fullName: string } | null;
}

export interface FollowUp {
  id: string;
  type: string;
  dueAt: string;
  status: string;
  notes: string | null;
  outcome: string | null;
  completedAt: string | null;
  assignedTo: { id: string; fullName: string };
}

export interface SiteVisit {
  id: string;
  status: string;
  scheduledAt: string;
  meetingPoint: string | null;
  notes: string | null;
  outcome: string | null;
  customerFeedback: string | null;
  completedAt: string | null;
  assignedTo: { id: string; fullName: string } | null;
  property: { id: string; title: string; referenceCode?: string } | null;
  project: { id: string; name: string } | null;
  unit: { id: string; code: string } | null;
  lead?: { id: string; leadNo: string; name: string; phone: string; status: string };
  customer?: { id: string; fullName: string; phone: string | null; email: string | null };
}

export interface LeadDetail extends Omit<LeadRow, 'unit' | 'property'> {
  organizationId: string;
  requirement: string | null;
  locationPreference: string | null;
  lostReason: string | null;
  intakeNote: string | null;
  tags: string[];
  convertedAt: string | null;
  customer: { id: string; fullName: string; phone: string | null; email: string | null; alternatePhone: string | null; city: string | null; occupation: string | null };
  campaign: { id: string; name: string; code: string } | null;
  property: { id: string; title: string; slug: string; referenceCode: string; price: number; listingType: string } | null;
  unit: { id: string; code: string; status: string; totalPrice: number } | null;
  preferredCity: { id: string; name: string } | null;
  preferredLocality: { id: string; name: string } | null;
  assignedTeam: { id: string; name: string } | null;
  createdBy: { id: string; fullName: string } | null;
  duplicateOf: { id: string; leadNo: string; status: string } | null;
  _count: { duplicates: number };
  activities: Activity[];
  assignments: { id: string; method: string; reason: string | null; isCurrent: boolean; assignedAt: string; endedAt: string | null; assignedTo: { fullName: string }; assignedBy: { fullName: string } | null; rule: { name: string } | null; team: { name: string } | null }[];
  followUps: FollowUp[];
  siteVisits: SiteVisit[];
  enquiries: { id: string; referenceNo: string; type: string; status: string; message: string | null; sourcePage: string | null; preferredDate: string | null; preferredTimeSlot: string | null; createdAt: string }[];
  deals: { id: string; dealNo: string; status: string; dealValue: number; dealType: string; createdAt: string }[];
  reservations: { id: string; status: string; expiresAt: string | null; createdAt: string; unit: { id: string; code: string; project: { name: string } } }[];
  tasks: { id: string; title: string; status: string; dueAt: string | null; assignedTo: { fullName: string } }[];
  allowedStatuses: string[];
  canEdit: boolean;
  canAssign: boolean;
  canManageVisits: boolean;
  canCreateDeal: boolean;
}

export interface Assignee {
  id: string;
  fullName: string;
  email: string | null;
  openLeads: number;
}

export interface DealRow {
  id: string;
  dealNo: string;
  status: string;
  dealType: string;
  dealValue: number;
  amountReceived: number;
  bookingDate: string | null;
  createdAt: string;
  customer: { fullName: string };
  project: { name: string } | null;
  unit: { code: string } | null;
  property: { title: string; referenceCode: string } | null;
  salesUser: { fullName: string } | null;
  organization: { name: string };
}
