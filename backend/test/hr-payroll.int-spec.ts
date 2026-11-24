import { localDateString } from '@estate/shared';
import { createApp, createUser, loginAgent, ORIGIN, PASSWORD, uniq, type TestContext } from './helpers';

/**
 * People workflows end to end through the HTTP API: attendance, leave approval (never one's own),
 * payroll calculation, per-payslip approval with maker-checker (nobody approves their own pay) and payment.
 */
describe('HR & payroll', () => {
  let ctx: TestContext;
  let platformOrgId: string;

  const today = localDateString(new Date());
  const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

  /** A Tuesday at least 8 days ahead whose following Wednesday is in the same calendar year. */
  function futureTuesday(): string {
    let d = addDays(today, 8);
    while (weekday(d) !== 2 || addDays(d, 1).slice(0, 4) !== d.slice(0, 4)) d = addDays(d, 1);
    return d;
  }
  /** Most recent Monday–Saturday strictly before today. */
  function lastWorkingDay(): string {
    let d = addDays(today, -1);
    while (weekday(d) === 0) d = addDays(d, -1);
    return d;
  }
  const previousMonth = () => {
    const [y, m] = today.split('-').map(Number);
    return m === 1 ? { periodYear: y - 1, periodMonth: 12 } : { periodYear: y, periodMonth: m - 1 };
  };

  async function staffEmployee(roleKey: string) {
    const user = await createUser(ctx.prisma, { roleKey });
    const employee = await ctx.prisma.employee.create({
      data: { organizationId: platformOrgId, userId: user.id, employeeCode: uniq('E').toUpperCase().slice(0, 18), joiningDate: new Date('2024-01-01T00:00:00Z'), employmentStatus: 'ACTIVE' },
    });
    return { user, employee };
  }

  beforeAll(async () => {
    ctx = await createApp();
    platformOrgId = (await ctx.prisma.organization.findFirstOrThrow({ where: { type: 'PLATFORM' } })).id;
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('runs attendance, leave and a two-approver payroll without anyone approving their own records', async () => {
    // ── People: HR manager, an admin (prepares payroll), two accountants (approvers) — all employees with payslips.
    const hr = await staffEmployee('HR_MANAGER');
    const admin = await staffEmployee('ADMIN');
    const acc1 = await staffEmployee('ACCOUNTANT');
    const acc2 = await staffEmployee('ACCOUNTANT');
    const hrAgent = await loginAgent(ctx, hr.user.email!);

    // HR creates a regular employee through the API (an HR manager cannot grant roles beyond their own powers).
    const denied = await hrAgent.post('/api/v1/hr/employees').set('Origin', ORIGIN).send({
      fullName: 'Role Escalation Attempt',
      email: `${uniq('esc')}@example.test`,
      employeeCode: uniq('X').toUpperCase().slice(0, 18),
      joiningDate: '2024-01-01',
      roleKeys: ['ADMIN'],
      password: PASSWORD,
    });
    expect(denied.status).toBe(403);

    const staffEmail = `${uniq('staff')}@example.test`;
    const created = await hrAgent.post('/api/v1/hr/employees').set('Origin', ORIGIN).send({
      fullName: 'Payroll Test Employee',
      email: staffEmail,
      employeeCode: uniq('S').toUpperCase().slice(0, 18),
      joiningDate: '2024-01-01',
      roleKeys: [],
      password: PASSWORD,
    });
    expect(created.status).toBe(201);
    const staffEmployeeId: string = created.body.id;
    const staffAgent = await loginAgent(ctx, staffEmail);

    // ── Attendance: one check-in per day.
    expect((await staffAgent.post('/api/v1/hr/attendance/check-in').set('Origin', ORIGIN)).status).toBe(201);
    const again = await staffAgent.post('/api/v1/hr/attendance/check-in').set('Origin', ORIGIN);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_CHECKED_IN');
    expect((await staffAgent.post('/api/v1/hr/attendance/check-out').set('Origin', ORIGIN)).status).toBe(201);

    // Corrections: a future date is refused; HR cannot approve their own; another reviewer can.
    const day = lastWorkingDay();
    const future = await staffAgent.post('/api/v1/hr/attendance/corrections').set('Origin', ORIGIN).send({ date: addDays(today, 2), requestedCheckIn: `${addDays(today, 2)}T09:30:00+05:30`, reason: 'Forgot to check in' });
    expect(future.status).toBe(400);
    const ownCorrection = await hrAgent.post('/api/v1/hr/attendance/corrections').set('Origin', ORIGIN).send({ date: day, requestedCheckIn: `${day}T09:30:00+05:30`, requestedCheckOut: `${day}T18:40:00+05:30`, reason: 'Was at a client site visit all day' });
    expect(ownCorrection.status).toBe(201);
    const selfReview = await hrAgent.post(`/api/v1/hr/attendance/corrections/${ownCorrection.body.id}/decision`).set('Origin', ORIGIN).send({ decision: 'APPROVE' });
    expect(selfReview.status).toBe(403);
    const adminAgent = await loginAgent(ctx, admin.user.email!);
    const rejectNoReason = await adminAgent.post(`/api/v1/hr/attendance/corrections/${ownCorrection.body.id}/decision`).set('Origin', ORIGIN).send({ decision: 'REJECT' });
    expect(rejectNoReason.status).toBe(400);
    const reviewed = await adminAgent.post(`/api/v1/hr/attendance/corrections/${ownCorrection.body.id}/decision`).set('Origin', ORIGIN).send({ decision: 'APPROVE' });
    expect(reviewed.status).toBe(201);
    const record = await ctx.prisma.attendanceRecord.findFirst({ where: { employeeId: hr.employee.id, date: new Date(`${day}T00:00:00Z`) } });
    expect(record?.checkInAt).toBeTruthy();
    expect(record?.checkOutAt).toBeTruthy();

    // ── Leave: balance, overlap, no self-approval, approval deducts the balance.
    const cl = await hrAgent.post('/api/v1/hr/leave/types').set('Origin', ORIGIN).send({ name: 'Casual leave', code: uniq('C').toUpperCase().slice(0, 8), isPaid: true, annualQuota: 12 });
    expect(cl.status).toBe(201);
    const start = futureTuesday();
    const year = Number(start.slice(0, 4));
    const bal = await hrAgent.put('/api/v1/hr/leave/balances').set('Origin', ORIGIN).send({ employeeId: staffEmployeeId, leaveTypeId: cl.body.id, year, allocated: 12 });
    expect(bal.status).toBe(200);

    const applied = await staffAgent.post('/api/v1/hr/leave/requests').set('Origin', ORIGIN).send({ leaveTypeId: cl.body.id, startDate: start, endDate: addDays(start, 1), reason: 'Family function' });
    expect(applied.status).toBe(201);
    const overlap = await staffAgent.post('/api/v1/hr/leave/requests').set('Origin', ORIGIN).send({ leaveTypeId: cl.body.id, startDate: addDays(start, 1), endDate: addDays(start, 1), reason: 'Overlapping request' });
    expect(overlap.status).toBe(409);
    expect((await staffAgent.post(`/api/v1/hr/leave/requests/${applied.body.id}/decision`).set('Origin', ORIGIN).send({ decision: 'APPROVE' })).status).toBe(403);
    const approved = await hrAgent.post(`/api/v1/hr/leave/requests/${applied.body.id}/decision`).set('Origin', ORIGIN).send({ decision: 'APPROVE' });
    expect(approved.status).toBe(201);
    const balance = await ctx.prisma.leaveBalance.findFirstOrThrow({ where: { employeeId: staffEmployeeId, leaveTypeId: cl.body.id, year } });
    expect(Number(balance.used)).toBe(2);
    const twice = await hrAgent.post(`/api/v1/hr/leave/requests/${applied.body.id}/decision`).set('Origin', ORIGIN).send({ decision: 'REJECT', note: 'Changed my mind' });
    expect(twice.status).toBe(409);

    // HR's own leave goes to someone else.
    const lwp = await hrAgent.post('/api/v1/hr/leave/types').set('Origin', ORIGIN).send({ name: 'Leave without pay', code: uniq('L').toUpperCase().slice(0, 8), isPaid: false, annualQuota: 0 });
    const hrLeave = await hrAgent.post('/api/v1/hr/leave/requests').set('Origin', ORIGIN).send({ leaveTypeId: lwp.body.id, startDate: addDays(start, 7), endDate: addDays(start, 7), reason: 'Personal work' });
    expect(hrLeave.status).toBe(201);
    expect((await hrAgent.post(`/api/v1/hr/leave/requests/${hrLeave.body.id}/decision`).set('Origin', ORIGIN).send({ decision: 'APPROVE' })).status).toBe(403);
    expect((await adminAgent.post(`/api/v1/hr/leave/requests/${hrLeave.body.id}/decision`).set('Origin', ORIGIN).send({ decision: 'APPROVE' })).status).toBe(201);

    // ── Payroll configuration (amounts are test configuration, not statutory rates).
    const comp = async (body: Record<string, unknown>) => {
      const r = await hrAgent.post('/api/v1/payroll/components').set('Origin', ORIGIN).send(body);
      expect(r.status).toBe(201);
      return r.body.id as string;
    };
    const basic = await comp({ code: 'BASIC', name: 'Basic salary', type: 'EARNING', calcType: 'FIXED', prorateByAttendance: true });
    const hra = await comp({ code: 'HRA', name: 'House rent allowance', type: 'EARNING', calcType: 'PERCENT_OF_BASIC', prorateByAttendance: true });
    const fixedDeduction = await comp({ code: 'TESTDED', name: 'Test deduction', type: 'DEDUCTION', calcType: 'FIXED', prorateByAttendance: false });

    const { periodYear, periodMonth } = previousMonth();
    const periodStart = `${periodYear}-${String(periodMonth).padStart(2, '0')}-01`;
    for (const employeeId of [staffEmployeeId, admin.employee.id, acc1.employee.id, acc2.employee.id]) {
      const s = await hrAgent.post(`/api/v1/payroll/structures/${employeeId}`).set('Origin', ORIGIN).send({
        effectiveFrom: periodStart,
        lines: [
          { componentId: basic, value: 30000 },
          { componentId: hra, value: 40 },
          { componentId: fixedDeduction, value: 200 },
        ],
      });
      expect(s.status).toBe(201);
    }
    // Nobody edits their own salary.
    expect((await hrAgent.post(`/api/v1/payroll/structures/${hr.employee.id}`).set('Origin', ORIGIN).send({ effectiveFrom: periodStart, lines: [{ componentId: basic, value: 99999 }] })).status).toBe(403);

    // ── Payroll run: future months are refused; the admin prepares the previous month.
    const [ny, nm] = addDays(today, 40).split('-').map(Number);
    expect((await adminAgent.post('/api/v1/payroll/runs').set('Origin', ORIGIN).send({ periodYear: ny, periodMonth: nm })).status).toBe(400);
    const run = await adminAgent.post('/api/v1/payroll/runs').set('Origin', ORIGIN).send({ periodYear, periodMonth });
    expect(run.status).toBe(201);
    const runId: string = run.body.id;
    const calc = await adminAgent.post(`/api/v1/payroll/runs/${runId}/calculate`).set('Origin', ORIGIN);
    expect(calc.status).toBe(201);

    const detail = await adminAgent.get(`/api/v1/payroll/runs/${runId}`);
    const slipOf = (employeeId: string) => detail.body.payslips.find((p: { employee: { id: string } }) => p.employee.id === employeeId);
    const staffSlip = slipOf(staffEmployeeId);
    // Full month, no loss of pay: 30,000 basic + 40% HRA − 200 deduction.
    expect(staffSlip.grossEarnings).toBe(42000);
    expect(staffSlip.totalDeductions).toBe(200);
    expect(staffSlip.netPay).toBe(41800);
    expect(slipOf(hr.employee.id)).toBeUndefined(); // no structure → skipped with a warning
    expect(detail.body.warnings.some((w: string) => w.includes('no salary structure'))).toBe(true);

    // ── Approval: HR lacks the permission; the preparer is blocked (maker-checker);
    // an accountant approves everyone except themself; a second approver finishes.
    expect((await hrAgent.post(`/api/v1/payroll/runs/${runId}/approve`).set('Origin', ORIGIN)).status).toBe(403);
    const maker = await adminAgent.post(`/api/v1/payroll/runs/${runId}/approve`).set('Origin', ORIGIN);
    expect(maker.status).toBe(403);
    expect(maker.body.code).toBe('MAKER_CHECKER');

    const acc1Agent = await loginAgent(ctx, acc1.user.email!);
    const first = await acc1Agent.post(`/api/v1/payroll/runs/${runId}/approve`).set('Origin', ORIGIN);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ status: 'CALCULATED', awaitingOtherApprover: 1 });
    const ownSlip = await ctx.prisma.payslip.findFirstOrThrow({ where: { payrollRunId: runId, employeeId: acc1.employee.id } });
    expect(ownSlip.status).toBe('DRAFT');
    const repeat = await acc1Agent.post(`/api/v1/payroll/runs/${runId}/approve`).set('Origin', ORIGIN);
    expect(repeat.status).toBe(403);
    expect(repeat.body.code).toBe('OWN_PAYSLIP_IN_RUN');
    // Nothing is paid before the whole run is approved.
    expect((await acc1Agent.post(`/api/v1/payroll/runs/${runId}/payments`).set('Origin', ORIGIN).send({ paidOn: today, method: 'BANK_TRANSFER' })).status).toBe(409);

    const acc2Agent = await loginAgent(ctx, acc2.user.email!);
    const second = await acc2Agent.post(`/api/v1/payroll/runs/${runId}/approve`).set('Origin', ORIGIN);
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({ status: 'APPROVED', approvedPayslips: 1 });
    expect((await adminAgent.post(`/api/v1/payroll/runs/${runId}/calculate`).set('Origin', ORIGIN)).status).toBe(409);

    // ── Payment: every payslip paid → run PAID, one ledger transaction per payslip, totals match.
    const paid = await acc1Agent.post(`/api/v1/payroll/runs/${runId}/payments`).set('Origin', ORIGIN).send({ paidOn: today, method: 'BANK_TRANSFER', referenceNo: 'TEST-BATCH-1' });
    expect(paid.status).toBe(201);
    const after = await ctx.prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    expect(after.status).toBe('PAID');
    const txns = await ctx.prisma.financeTransaction.findMany({ where: { type: 'SALARY_PAYMENT', salaryPayment: { payslip: { payrollRunId: runId } } } });
    expect(txns).toHaveLength(4);
    expect(txns.reduce((s, t) => s + Number(t.amount), 0)).toBeCloseTo(Number(after.totalNet), 2);

    // ── Employees see only their own payslips.
    const mine = await staffAgent.get('/api/v1/payroll/me/payslips');
    expect(mine.status).toBe(200);
    const list = Array.isArray(mine.body) ? mine.body : mine.body.data;
    expect(list.map((p: { id: string }) => p.id)).toContain(staffSlip.id);
    expect((await staffAgent.get(`/api/v1/payroll/payslips/${ownSlip.id}`)).status).toBe(404);
    expect((await staffAgent.get(`/api/v1/payroll/runs/${runId}`)).status).toBe(403);
  });
});
