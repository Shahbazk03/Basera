export interface EmployeeRow {
  id: string;
  employeeCode: string;
  joiningDate: string;
  exitDate: string | null;
  employmentType: string;
  employmentStatus: string;
  workLocation: string | null;
  isDemo: boolean;
  user: { id: string; fullName: string; email: string | null; phone: string | null; avatarUrl: string | null; status: string };
  department: { id: string; name: string } | null;
  designation: { id: string; name: string } | null;
  manager: { id: string; employeeCode: string; user: { fullName: string } } | null;
}

export interface EmployeeOption {
  id: string;
  employeeCode: string;
  userId: string;
  user: { fullName: string };
  designation: { name: string } | null;
  department: { name: string } | null;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  description: string | null;
  parentId: string | null;
  parent: { id: string; name: string } | null;
  headEmployeeId: string | null;
  headName: string | null;
  isActive: boolean;
  _count: { employees: number; designations: number };
}

export interface Designation {
  id: string;
  name: string;
  level: number;
  departmentId: string | null;
  department: { id: string; name: string } | null;
  isActive: boolean;
  _count: { employees: number };
}

export interface Shift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  weeklyOffDays: number[];
  timezone: string;
  isDefault: boolean;
  _count?: { employees: number };
}

export interface AttendanceRecordOut {
  id: string;
  date: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  status: string;
  isLate: boolean;
  workMinutes: number;
  source: string;
  notes: string | null;
}

export interface AttendanceMonth {
  employee: { id: string; name: string; employeeCode: string };
  shift: { name: string; startTime: string; endTime: string; weeklyOffDays: number[] };
  month: string;
  days: { date: string; state: string; working: boolean; holiday: string | null; leave: string | null; record: AttendanceRecordOut | null }[];
  summary: { present: number; halfDay: number; absent: number; onLeave: number; notMarked: number; late: number; workHours: number };
}

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  isPaid: boolean;
  annualQuota: number;
  carryForward: boolean;
  maxCarryForward: number | null;
  allowHalfDay: boolean;
  isActive: boolean;
}

export interface LeaveBalance {
  id: string;
  year: number;
  employee: { id: string; employeeCode: string; name: string };
  leaveType: { id: string; name: string; code: string; isPaid: boolean };
  allocated: number;
  carriedForward: number;
  used: number;
  pending: number;
  available: number;
}

export interface LeaveRequestRow {
  id: string;
  status: string;
  startDate: string;
  endDate: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  days: number;
  reason: string;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  leaveType: { id: string; name: string; code: string; isPaid: boolean };
  employee: { id: string; employeeCode: string; user: { fullName: string }; department: { name: string } | null };
  approver: { fullName: string } | null;
  canDecide: boolean;
  canCancel: boolean;
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function currentMonth(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
}

export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function timeOf(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}

export function hoursOf(minutes: number): string {
  if (!minutes) return '—';
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** Local IST "HH:mm" for a time input → ISO instant on a given date. */
export function istInstant(date: string, hhmm: string): string {
  return `${date}T${hhmm}:00+05:30`;
}
