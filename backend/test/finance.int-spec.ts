import request from 'supertest';
import { localDateString } from '@estate/shared';
import { createApp, createUser, loginAgent, ORIGIN, uniq, type TestContext } from './helpers';

/**
 * Money workflows through the HTTP API: configured commission rules (no hard-coded rates), idempotent
 * generation, no self-approval, payouts → ledger, customer payments kept apart from revenue,
 * invoices (overpayment refused) and expense maker-checker.
 */
describe('Commissions & finance', () => {
  let ctx: TestContext;
  let platformOrgId: string;
  const today = localDateString(new Date());

  beforeAll(async () => {
    ctx = await createApp();
    platformOrgId = (await ctx.prisma.organization.findFirstOrThrow({ where: { type: 'PLATFORM' } })).id;
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('generates commissions from rules, enforces approvals and pays through the ledger', async () => {
    const admin = await createUser(ctx.prisma, { roleKey: 'ADMIN' });
    const acc1 = await createUser(ctx.prisma, { roleKey: 'ACCOUNTANT', memberOf: platformOrgId });
    const acc2 = await createUser(ctx.prisma, { roleKey: 'ACCOUNTANT', memberOf: platformOrgId });
    const seller = await createUser(ctx.prisma, { roleKey: 'SALES_EXECUTIVE', memberOf: platformOrgId });
    const adminAgent = await loginAgent(ctx, admin.email!);
    const a1 = await loginAgent(ctx, acc1.email!);
    const a2 = await loginAgent(ctx, acc2.email!);

    // A lead from the website and a booked deal (dealing in customer money, not company revenue).
    const phone = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    const enq = await request(ctx.app.getHttpServer()).post('/api/v1/public/enquiries').set('Origin', ORIGIN).send({ type: 'GENERAL', name: 'Finance Test Buyer', phone, consent: true, formStartedAt: Date.now() - 10_000 });
    expect(enq.status).toBe(201);
    const leadId = (await ctx.prisma.enquiry.findUniqueOrThrow({ where: { referenceNo: enq.body.referenceNo } })).leadId!;
    const deal = await adminAgent.post('/api/v1/crm/deals').set('Origin', ORIGIN).send({ leadId, dealType: 'SALE', dealValue: 8_000_000, expectedRevenue: 160_000, salesUserId: seller.id });
    expect(deal.status).toBe(201);
    const dealId: string = deal.body.id;

    // Rules are configuration: 0.5% of deal value, capped at ₹30,000.
    const rule = await a1.post('/api/v1/commissions/rules').set('Origin', ORIGIN).send({ name: uniq('Sales incentive '), recipientType: 'SALES_EMPLOYEE', calcType: 'PERCENTAGE', value: 0.5, basis: 'DEAL_VALUE', maxPayout: 30_000, priority: 1 });
    expect(rule.status).toBe(201);
    expect((await a1.post('/api/v1/commissions/rules').set('Origin', ORIGIN).send({ name: 'Impossible rate', recipientType: 'COMPANY', calcType: 'PERCENTAGE', value: 150 })).status).toBe(400);

    // Not generated before booking; generated once (idempotent) after.
    const early = await a1.post(`/api/v1/commissions/deals/${dealId}/generate`).set('Origin', ORIGIN);
    expect(early.status).toBe(201);
    expect(early.body.created).toHaveLength(0);
    expect((await adminAgent.post(`/api/v1/crm/deals/${dealId}/status`).set('Origin', ORIGIN).send({ status: 'BOOKED' })).status).toBe(201);
    const gen = await a1.post(`/api/v1/commissions/deals/${dealId}/generate`).set('Origin', ORIGIN);
    expect(gen.status).toBe(201);
    const mine = gen.body.created.filter((c: { rule: string }) => c.rule === rule.body.name);
    expect(mine).toHaveLength(1);
    expect(mine[0].amount).toBe(30_000); // 0.5% of 80,00,000 = 40,000 → capped
    const again = await a1.post(`/api/v1/commissions/deals/${dealId}/generate`).set('Origin', ORIGIN);
    expect(again.body.created.filter((c: { rule: string }) => c.rule === rule.body.name)).toHaveLength(0);
    const recordId: string = mine[0].id;

    // The recipient cannot approve their own commission (sales staff lack the permission; an accountant
    // who is the recipient of a manual record is refused).
    const sellerAgent = await loginAgent(ctx, seller.email!);
    expect((await sellerAgent.post(`/api/v1/commissions/${recordId}/status`).set('Origin', ORIGIN).send({ status: 'APPROVED' })).status).toBe(403);
    const manual = await a2.post('/api/v1/commissions').set('Origin', ORIGIN).send({ dealId, recipientType: 'SALES_EMPLOYEE', recipientUserId: acc1.id, recipientName: 'Accountant One', calcType: 'FIXED', value: 5_000, basisAmount: 8_000_000, notes: 'Referral' });
    expect(manual.status).toBe(201);
    expect((await a1.post(`/api/v1/commissions/${manual.body.id}/status`).set('Origin', ORIGIN).send({ status: 'APPROVED' })).status).toBe(403);
    expect((await a2.post(`/api/v1/commissions/${manual.body.id}/status`).set('Origin', ORIGIN).send({ status: 'APPROVED' })).status).toBe(201);

    // Approve → payable → payout → paid; the payout is a ledger outflow, paid once.
    expect((await a1.post(`/api/v1/commissions/${recordId}/status`).set('Origin', ORIGIN).send({ status: 'APPROVED' })).status).toBe(201);
    expect((await a1.post(`/api/v1/commissions/${recordId}/status`).set('Origin', ORIGIN).send({ status: 'PAYABLE' })).status).toBe(201);
    const payout = await a1.post('/api/v1/commissions/payouts').set('Origin', ORIGIN).send({ commissionRecordIds: [recordId] });
    expect(payout.status).toBe(201);
    const paid = await a1.post(`/api/v1/commissions/payouts/${payout.body.id}/pay`).set('Origin', ORIGIN).send({ paidOn: today, method: 'BANK_TRANSFER', referenceNo: 'TEST-PAYOUT-1' });
    expect(paid.status).toBe(201);
    expect((await a1.post(`/api/v1/commissions/payouts/${payout.body.id}/pay`).set('Origin', ORIGIN).send({ paidOn: today, method: 'BANK_TRANSFER' })).status).toBe(409);
    const record = await ctx.prisma.commissionRecord.findUniqueOrThrow({ where: { id: recordId } });
    expect(record.status).toBe('PAID');
    const payoutTxn = await ctx.prisma.financeTransaction.findFirstOrThrow({ where: { payoutId: payout.body.id } });
    expect(payoutTxn).toMatchObject({ type: 'COMMISSION_PAYOUT', direction: 'OUTFLOW' });
    expect(Number(payoutTxn.amount)).toBe(30_000);

    // Customer money received by the company is an inflow on the ledger — never revenue.
    expect((await adminAgent.post(`/api/v1/crm/deals/${dealId}/payments`).set('Origin', ORIGIN).send({ amount: 200_000, receivedOn: today, receivedBy: 'COMPANY', method: 'UPI', referenceNo: 'TOKEN-1' })).status).toBe(201);
    expect((await adminAgent.post(`/api/v1/crm/deals/${dealId}/payments`).set('Origin', ORIGIN).send({ amount: 9_000_000, receivedOn: today, receivedBy: 'DEVELOPER', method: 'BANK_TRANSFER' })).status).toBe(400); // exceeds deal value
    const custTxn = await ctx.prisma.financeTransaction.findFirstOrThrow({ where: { dealId, type: 'CUSTOMER_PAYMENT' } });
    expect(custTxn.direction).toBe('INFLOW');

    // Invoice: tax rate entered per line; overpayment refused; full payment → PAID + revenue receipt.
    const inv = await a1.post('/api/v1/finance/invoices').set('Origin', ORIGIN).send({ billToName: 'Developer Partner Pvt Ltd', issueDate: today, dealId, lines: [{ description: 'Marketing services', quantity: 1, unitPrice: 100_000, taxRate: 18 }] });
    expect(inv.status).toBe(201);
    expect((await a1.post(`/api/v1/finance/invoices/${inv.body.id}/issue`).set('Origin', ORIGIN)).status).toBe(201);
    expect((await a1.post(`/api/v1/finance/invoices/${inv.body.id}/payments`).set('Origin', ORIGIN).send({ amount: 120_000, txnDate: today, method: 'BANK_TRANSFER' })).status).toBe(400);
    expect((await a1.post(`/api/v1/finance/invoices/${inv.body.id}/payments`).set('Origin', ORIGIN).send({ amount: 118_000, txnDate: today, method: 'BANK_TRANSFER', referenceNo: 'NEFT-1' })).status).toBe(201);
    const invoice = await ctx.prisma.invoice.findUniqueOrThrow({ where: { id: inv.body.id } });
    expect(invoice.status).toBe('PAID');
    expect(Number(invoice.total)).toBe(118_000);

    // Expense maker-checker: the creator cannot approve their own expense.
    const category = await ctx.prisma.expenseCategory.findFirstOrThrow({ where: { organizationId: platformOrgId } });
    const exp = await a1.post('/api/v1/finance/expenses').set('Origin', ORIGIN).send({ categoryId: category.id, amount: 4_500, expenseDate: today, description: 'Printed brochures for site visits' });
    expect(exp.status).toBe(201);
    expect((await a1.post(`/api/v1/finance/expenses/${exp.body.id}/decision`).set('Origin', ORIGIN).send({ decision: 'APPROVE' })).status).toBe(403);
    expect((await a2.post(`/api/v1/finance/expenses/${exp.body.id}/decision`).set('Origin', ORIGIN).send({ decision: 'APPROVE' })).status).toBe(201);

    // The monthly report keeps revenue and customer money apart.
    const month = today.slice(0, 7);
    const report = await a1.get(`/api/v1/finance/reports/monthly?from=${month}&to=${month}`);
    expect(report.status).toBe(200);
    const row = (report.body.rows ?? report.body.months ?? report.body.data).find((r: { month: string }) => r.month === month);
    expect(row.revenueReceived).toBeGreaterThanOrEqual(118_000);
    expect(row.customerMoneyOnDeals).toBeGreaterThanOrEqual(200_000);
    expect(row.commissionsPaid).toBeGreaterThanOrEqual(30_000);
  });
});
