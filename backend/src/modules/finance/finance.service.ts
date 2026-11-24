import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { calculateInvoiceTotals, fromPaise, toPaise, MANUAL_TRANSACTION_TYPES, localDateString } from '@estate/shared';
import type { z } from 'zod';
import type {
  expenseCategorySchema,
  expenseSchema,
  invoicePaymentSchema,
  invoiceSchema,
  paymentRecordSchema,
  reimbursementPaySchema,
  reimbursementSchema,
  transactionSchema,
} from '@estate/shared';
import { Prisma, TransactionType } from '@prisma/client';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit.service';
import { nextReference, shortCode } from '../../common/references';
import { dateOnly, paginated, Pagination, skipTake } from '../../common/http';

export interface TxnQuery extends Pagination {
  type?: TransactionType;
  direction?: 'INFLOW' | 'OUTFLOW';
  from?: string;
  to?: string;
  q?: string;
}

const dateRange = (from?: string, to?: string) =>
  from || to ? { gte: from ? dateOnly(from) : undefined, lte: to ? dateOnly(to) : undefined } : undefined;

/** Company finance (platform organisation): ledger, invoices, expenses, reimbursements, reports. */
@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The company organisation; the caller must hold `perm` for it. */
  orgFor(user: AuthUser, perm: 'finance.view' | 'finance.manage'): string {
    const orgId = user.platformOrganizationId;
    if (!orgId) throw new ConflictException('The company organisation is not configured');
    user.assert(perm, orgId, perm === 'finance.manage' ? 'You cannot record finance entries' : 'You cannot view finance records');
    return orgId;
  }

  // ───────────────────────── Ledger ─────────────────────────

  async transactions(user: AuthUser, q: TxnQuery) {
    const orgId = this.orgFor(user, 'finance.view');
    const where: Prisma.FinanceTransactionWhereInput = {
      organizationId: orgId,
      ...(q.type ? { type: q.type } : {}),
      ...(q.direction ? { direction: q.direction } : {}),
      ...(dateRange(q.from, q.to) ? { txnDate: dateRange(q.from, q.to) } : {}),
      ...(q.q
        ? { OR: [{ txnNo: { contains: q.q, mode: 'insensitive' } }, { counterparty: { contains: q.q, mode: 'insensitive' } }, { referenceNo: { contains: q.q, mode: 'insensitive' } }, { description: { contains: q.q, mode: 'insensitive' } }] }
        : {}),
    };
    const [rows, total, sums] = await Promise.all([
      this.prisma.financeTransaction.findMany({
        where,
        orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          recordedBy: { select: { fullName: true } },
          deal: { select: { id: true, dealNo: true } },
          invoice: { select: { id: true, invoiceNo: true } },
          expense: { select: { id: true, description: true } },
          payout: { select: { id: true, payoutNo: true } },
          reimbursement: { select: { id: true, title: true } },
        },
        ...skipTake(q),
      }),
      this.prisma.financeTransaction.count({ where }),
      this.prisma.financeTransaction.groupBy({ by: ['direction'], where, _sum: { amount: true } }),
    ]);
    const inflow = Number(sums.find((s) => s.direction === 'INFLOW')?._sum.amount ?? 0);
    const outflow = Number(sums.find((s) => s.direction === 'OUTFLOW')?._sum.amount ?? 0);
    return { ...paginated(rows, total, q), totals: { inflow, outflow, net: fromPaise(toPaise(inflow) - toPaise(outflow)) } };
  }

  async createTransaction(user: AuthUser, input: z.output<typeof transactionSchema>) {
    const orgId = this.orgFor(user, 'finance.manage');
    if (!(MANUAL_TRANSACTION_TYPES as readonly string[]).includes(input.type)) {
      throw new BadRequestException({ message: 'This type is recorded by its own workflow (invoices, payouts, payroll, expenses or reimbursements)', details: [{ path: 'type', message: 'Not allowed manually' }] });
    }
    if (input.type === 'REFUND' && input.direction !== 'OUTFLOW') throw new BadRequestException({ message: 'A refund is money going out', details: [{ path: 'direction', message: 'Use outflow' }] });
    if (input.dealId && !(await this.prisma.deal.findFirst({ where: { id: input.dealId, organizationId: orgId }, select: { id: true } }))) {
      throw new BadRequestException({ message: 'Deal not found', details: [{ path: 'dealId', message: 'Not found' }] });
    }
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.financeTransaction.create({
        data: {
          txnNo: await nextReference(tx, 'TXN'),
          organizationId: orgId,
          type: input.type,
          direction: input.direction,
          amount: input.amount,
          txnDate: dateOnly(input.txnDate),
          method: input.method,
          referenceNo: input.referenceNo ?? null,
          counterparty: input.counterparty ?? null,
          description: input.description ?? null,
          dealId: input.dealId ?? null,
          recordedById: user.id,
        },
      });
      await this.audit.log({ actorId: user.id, action: 'finance.transaction.create', entityType: 'FinanceTransaction', entityId: t.id, organizationId: orgId, after: { txnNo: t.txnNo, type: t.type, direction: t.direction, amount: input.amount } }, tx);
      return t;
    });
  }

  async transactionsCsv(user: AuthUser, q: Omit<TxnQuery, 'page' | 'pageSize'>): Promise<string> {
    const orgId = this.orgFor(user, 'finance.view');
    const rows = await this.prisma.financeTransaction.findMany({
      where: {
        organizationId: orgId,
        ...(q.type ? { type: q.type } : {}),
        ...(q.direction ? { direction: q.direction } : {}),
        ...(dateRange(q.from, q.to) ? { txnDate: dateRange(q.from, q.to) } : {}),
      },
      orderBy: [{ txnDate: 'asc' }, { createdAt: 'asc' }],
      take: 20000,
    });
    await this.audit.log({ actorId: user.id, action: 'finance.transaction.export', entityType: 'FinanceTransaction', organizationId: orgId, metadata: { rows: rows.length, ...q } });
    return toCsv(
      ['Txn no', 'Date', 'Type', 'Direction', 'Amount', 'Method', 'Reference', 'Counterparty', 'Description'],
      rows.map((r) => [r.txnNo, r.txnDate.toISOString().slice(0, 10), r.type, r.direction, Number(r.amount).toFixed(2), r.method, r.referenceNo ?? '', r.counterparty ?? '', r.description ?? '']),
    );
  }

  // ───────────────────────── Invoices ─────────────────────────

  async invoices(user: AuthUser, q: Pagination & { status?: string; q?: string; from?: string; to?: string }) {
    const orgId = this.orgFor(user, 'finance.view');
    const base: Prisma.InvoiceWhereInput = {
      organizationId: orgId,
      ...(dateRange(q.from, q.to) ? { issueDate: dateRange(q.from, q.to) } : {}),
      ...(q.q ? { OR: [{ invoiceNo: { contains: q.q, mode: 'insensitive' } }, { billToName: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const where = { ...base, ...(q.status ? { status: q.status as never } : {}) };
    const [rows, total, counts, outstanding] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, invoiceNo: true, billToName: true, issueDate: true, dueDate: true, status: true, subtotal: true, taxTotal: true, total: true, amountPaid: true, createdAt: true, deal: { select: { dealNo: true } } },
        ...skipTake(q),
      }),
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.invoice.aggregate({ where: { organizationId: orgId, status: { in: ['ISSUED', 'PARTIALLY_PAID'] } }, _sum: { total: true, amountPaid: true } }),
    ]);
    const today = new Date(`${localDateString(new Date())}T00:00:00.000Z`);
    return {
      ...paginated(rows.map((r) => ({ ...r, isOverdue: ['ISSUED', 'PARTIALLY_PAID'].includes(r.status) && r.dueDate !== null && r.dueDate < today })), total, q),
      statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      outstanding: fromPaise(toPaise(Number(outstanding._sum.total ?? 0)) - toPaise(Number(outstanding._sum.amountPaid ?? 0))),
    };
  }

  async invoice(user: AuthUser, id: string) {
    const orgId = this.orgFor(user, 'finance.view');
    const inv = await this.prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      include: {
        lines: { orderBy: { sortOrder: 'asc' } },
        transactions: { orderBy: { txnDate: 'asc' }, select: { id: true, txnNo: true, txnDate: true, amount: true, method: true, referenceNo: true } },
        organization: { select: { name: true, legalName: true, addressLine: true, gstin: true, email: true, phone: true, city: { select: { name: true } }, pincode: true } },
        billToOrganization: { select: { id: true, name: true } },
        customer: { select: { id: true, fullName: true } },
        deal: { select: { id: true, dealNo: true } },
        createdBy: { select: { fullName: true } },
      },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    return { ...inv, outstanding: fromPaise(toPaise(Number(inv.total)) - toPaise(Number(inv.amountPaid))) };
  }

  private async validateInvoiceRefs(orgId: string, input: z.output<typeof invoiceSchema>) {
    if (input.billToOrganizationId && !(await this.prisma.organization.findUnique({ where: { id: input.billToOrganizationId }, select: { id: true } }))) {
      throw new BadRequestException({ message: 'Organisation not found', details: [{ path: 'billToOrganizationId', message: 'Not found' }] });
    }
    if (input.customerId && !(await this.prisma.customer.findFirst({ where: { id: input.customerId, organizationId: orgId }, select: { id: true } }))) {
      throw new BadRequestException({ message: 'Customer not found', details: [{ path: 'customerId', message: 'Not found' }] });
    }
    if (input.dealId && !(await this.prisma.deal.findFirst({ where: { id: input.dealId, organizationId: orgId }, select: { id: true } }))) {
      throw new BadRequestException({ message: 'Deal not found', details: [{ path: 'dealId', message: 'Not found' }] });
    }
    if (input.dueDate && input.dueDate < input.issueDate) throw new BadRequestException({ message: 'The due date cannot be before the issue date', details: [{ path: 'dueDate', message: 'Invalid' }] });
  }

  private invoiceData(input: z.output<typeof invoiceSchema>) {
    const totals = calculateInvoiceTotals(input.lines);
    return {
      header: {
        billToName: input.billToName,
        billToAddress: input.billToAddress ?? null,
        billToGstin: input.billToGstin || null,
        billToOrganizationId: input.billToOrganizationId ?? null,
        customerId: input.customerId ?? null,
        dealId: input.dealId ?? null,
        issueDate: dateOnly(input.issueDate),
        dueDate: input.dueDate ? dateOnly(input.dueDate) : null,
        notes: input.notes ?? null,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
      },
      lines: totals.lines.map((l, i) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate, amount: l.amount, taxAmount: l.taxAmount, sortOrder: i })),
    };
  }

  async createInvoice(user: AuthUser, input: z.output<typeof invoiceSchema>) {
    const orgId = this.orgFor(user, 'finance.manage');
    await this.validateInvoiceRefs(orgId, input);
    const { header, lines } = this.invoiceData(input);
    const inv = await this.prisma.$transaction(async (tx) => {
      // Drafts get a temporary number; the sequential invoice number is assigned when issued.
      const created = await tx.invoice.create({ data: { ...header, organizationId: orgId, invoiceNo: shortCode('DRAFT', 8), status: 'DRAFT', createdById: user.id, lines: { create: lines } } });
      await this.audit.log({ actorId: user.id, action: 'finance.invoice.create', entityType: 'Invoice', entityId: created.id, organizationId: orgId, after: { billTo: header.billToName, total: header.total } }, tx);
      return created;
    });
    return this.invoice(user, inv.id);
  }

  async updateInvoice(user: AuthUser, id: string, input: z.output<typeof invoiceSchema>) {
    const orgId = this.orgFor(user, 'finance.manage');
    const inv = await this.prisma.invoice.findFirst({ where: { id, organizationId: orgId } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status !== 'DRAFT') throw new ConflictException('Only draft invoices can be edited — cancel and re-issue instead');
    await this.validateInvoiceRefs(orgId, input);
    const { header, lines } = this.invoiceData(input);
    await this.prisma.$transaction(async (tx) => {
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
      await tx.invoice.update({ where: { id }, data: { ...header, lines: { create: lines } } });
      await this.audit.log({ actorId: user.id, action: 'finance.invoice.update', entityType: 'Invoice', entityId: id, organizationId: orgId, before: { total: Number(inv.total) }, after: { total: header.total } }, tx);
    });
    return this.invoice(user, id);
  }

  async issueInvoice(user: AuthUser, id: string) {
    const orgId = this.orgFor(user, 'finance.manage');
    const inv = await this.prisma.invoice.findFirst({ where: { id, organizationId: orgId } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status !== 'DRAFT') throw new ConflictException('Only draft invoices can be issued');
    if (Number(inv.total) <= 0) throw new ConflictException('An invoice must have a positive total');
    await this.prisma.$transaction(async (tx) => {
      const invoiceNo = await nextReference(tx, 'INV');
      const res = await tx.invoice.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'ISSUED', invoiceNo } });
      if (res.count !== 1) throw new ConflictException('This invoice was changed by someone else');
      await this.audit.log({ actorId: user.id, action: 'finance.invoice.issue', entityType: 'Invoice', entityId: id, organizationId: orgId, after: { invoiceNo, total: Number(inv.total) } }, tx);
    });
    return this.invoice(user, id);
  }

  async cancelInvoice(user: AuthUser, id: string, reason: string) {
    const orgId = this.orgFor(user, 'finance.manage');
    const inv = await this.prisma.invoice.findFirst({ where: { id, organizationId: orgId } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (!['DRAFT', 'ISSUED'].includes(inv.status)) throw new ConflictException('Only unpaid draft or issued invoices can be cancelled');
    if (Number(inv.amountPaid) > 0) throw new ConflictException('A paid invoice cannot be cancelled — record a refund instead');
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.invoice.updateMany({ where: { id, status: inv.status, amountPaid: 0 }, data: { status: 'CANCELLED', notes: [inv.notes, `Cancelled: ${reason}`].filter(Boolean).join('\n') } });
      if (res.count !== 1) throw new ConflictException('This invoice was changed by someone else');
      await this.audit.log({ actorId: user.id, action: 'finance.invoice.cancel', entityType: 'Invoice', entityId: id, organizationId: orgId, before: { status: inv.status }, after: { status: 'CANCELLED' }, metadata: { reason } }, tx);
    });
    return this.invoice(user, id);
  }

  async recordInvoicePayment(user: AuthUser, id: string, input: z.output<typeof invoicePaymentSchema>) {
    const orgId = this.orgFor(user, 'finance.manage');
    const inv = await this.prisma.invoice.findFirst({ where: { id, organizationId: orgId } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (!['ISSUED', 'PARTIALLY_PAID'].includes(inv.status)) throw new ConflictException('Payments can only be recorded against issued invoices');
    const outstandingPaise = toPaise(Number(inv.total)) - toPaise(Number(inv.amountPaid));
    const amountPaise = toPaise(input.amount);
    if (amountPaise > outstandingPaise) {
      throw new BadRequestException({ message: `The amount exceeds the outstanding balance of ₹${fromPaise(outstandingPaise).toLocaleString('en-IN')}`, code: 'OVERPAYMENT', details: [{ path: 'amount', message: 'More than outstanding' }] });
    }
    const newPaid = fromPaise(toPaise(Number(inv.amountPaid)) + amountPaise);
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.invoice.updateMany({ where: { id, amountPaid: inv.amountPaid, status: inv.status }, data: { amountPaid: newPaid, status: amountPaise === outstandingPaise ? 'PAID' : 'PARTIALLY_PAID' } });
      if (res.count !== 1) throw new ConflictException({ message: 'Another payment was recorded at the same time. Refresh and try again.', code: 'CONCURRENT_UPDATE' });
      const t = await tx.financeTransaction.create({
        data: {
          txnNo: await nextReference(tx, 'TXN'),
          organizationId: orgId,
          type: 'INVOICE_RECEIPT',
          direction: 'INFLOW',
          amount: input.amount,
          txnDate: dateOnly(input.txnDate),
          method: input.method,
          referenceNo: input.referenceNo ?? null,
          counterparty: inv.billToName,
          description: `Receipt against ${inv.invoiceNo}`,
          invoiceId: id,
          dealId: inv.dealId,
          recordedById: user.id,
        },
      });
      await this.audit.log({ actorId: user.id, action: 'finance.invoice.payment', entityType: 'Invoice', entityId: id, organizationId: orgId, before: { amountPaid: Number(inv.amountPaid) }, after: { amountPaid: newPaid, txnNo: t.txnNo } }, tx);
    });
    return this.invoice(user, id);
  }

  // ───────────────────────── Expenses ─────────────────────────

  categories(user: AuthUser) {
    const orgId = this.orgFor(user, 'finance.view');
    return this.prisma.expenseCategory.findMany({ where: { organizationId: orgId }, orderBy: { name: 'asc' }, include: { _count: { select: { expenses: true } } } });
  }

  async createCategory(user: AuthUser, input: z.output<typeof expenseCategorySchema>) {
    const orgId = this.orgFor(user, 'finance.manage');
    if (await this.prisma.expenseCategory.findUnique({ where: { organizationId_name: { organizationId: orgId, name: input.name } } })) throw new ConflictException('This category already exists');
    const c = await this.prisma.expenseCategory.create({ data: { organizationId: orgId, ...input } });
    await this.audit.log({ actorId: user.id, action: 'finance.category.create', entityType: 'ExpenseCategory', entityId: c.id, organizationId: orgId, after: c });
    return c;
  }

  async updateCategory(user: AuthUser, id: string, input: Partial<z.output<typeof expenseCategorySchema>>) {
    const orgId = this.orgFor(user, 'finance.manage');
    const before = await this.prisma.expenseCategory.findFirst({ where: { id, organizationId: orgId } });
    if (!before) throw new NotFoundException('Category not found');
    const c = await this.prisma.expenseCategory.update({ where: { id }, data: input });
    await this.audit.log({ actorId: user.id, action: 'finance.category.update', entityType: 'ExpenseCategory', entityId: id, organizationId: orgId, before, after: c });
    return c;
  }

  async expenses(user: AuthUser, q: Pagination & { status?: string; categoryId?: string; from?: string; to?: string; q?: string }) {
    const orgId = this.orgFor(user, 'finance.view');
    const base: Prisma.ExpenseWhereInput = {
      organizationId: orgId,
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(dateRange(q.from, q.to) ? { expenseDate: dateRange(q.from, q.to) } : {}),
      ...(q.q ? { OR: [{ description: { contains: q.q, mode: 'insensitive' } }, { vendor: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const where = { ...base, ...(q.status ? { status: q.status as never } : {}) };
    const [rows, total, counts, sum] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          category: { select: { id: true, name: true } },
          createdBy: { select: { id: true, fullName: true } },
          approvedBy: { select: { fullName: true } },
          receiptFile: { select: { id: true, fileName: true } },
        },
        ...skipTake(q),
      }),
      this.prisma.expense.count({ where }),
      this.prisma.expense.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.expense.aggregate({ where, _sum: { amount: true } }),
    ]);
    return { ...paginated(rows.map((r) => ({ ...r, isMine: r.createdById === user.id })), total, q), statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])), totalAmount: Number(sum._sum.amount ?? 0) };
  }

  private async assertReceipt(user: AuthUser, fileId: string | null | undefined) {
    if (!fileId) return;
    const file = await this.prisma.storedFile.findUnique({ where: { id: fileId } });
    if (!file || file.deletedAt || file.visibility !== 'PRIVATE') throw new BadRequestException({ message: 'Upload the receipt with purpose "receipt" first', details: [{ path: 'receiptFileId', message: 'Invalid file' }] });
    if (file.uploadedById !== user.id) throw new ForbiddenException('You can only attach receipts you uploaded');
  }

  async createExpense(user: AuthUser, input: z.output<typeof expenseSchema>) {
    const orgId = this.orgFor(user, 'finance.manage');
    const cat = await this.prisma.expenseCategory.findFirst({ where: { id: input.categoryId, organizationId: orgId, isActive: true } });
    if (!cat) throw new BadRequestException({ message: 'Choose an active category', details: [{ path: 'categoryId', message: 'Invalid category' }] });
    await this.assertReceipt(user, input.receiptFileId);
    return this.prisma.$transaction(async (tx) => {
      const e = await tx.expense.create({
        data: { organizationId: orgId, categoryId: cat.id, amount: input.amount, expenseDate: dateOnly(input.expenseDate), vendor: input.vendor ?? null, description: input.description, receiptFileId: input.receiptFileId ?? null, createdById: user.id },
      });
      await this.audit.log({ actorId: user.id, action: 'finance.expense.create', entityType: 'Expense', entityId: e.id, organizationId: orgId, after: { amount: input.amount, category: cat.name, description: input.description } }, tx);
      return e;
    });
  }

  async decideExpense(user: AuthUser, id: string, decision: 'APPROVE' | 'REJECT', note?: string) {
    const orgId = this.orgFor(user, 'finance.manage');
    const e = await this.prisma.expense.findFirst({ where: { id, organizationId: orgId } });
    if (!e) throw new NotFoundException('Expense not found');
    if (e.status !== 'PENDING') throw new ConflictException('Only pending expenses can be approved or rejected');
    if (e.createdById === user.id) throw new ForbiddenException('You cannot approve or reject an expense you recorded');
    const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.expense.updateMany({ where: { id, status: 'PENDING' }, data: { status, approvedById: user.id, approvedAt: new Date() } });
      if (res.count !== 1) throw new ConflictException('This expense was changed by someone else');
      await this.audit.log({ actorId: user.id, action: `finance.expense.${decision.toLowerCase()}`, entityType: 'Expense', entityId: id, organizationId: orgId, before: { status: 'PENDING' }, after: { status }, metadata: note ? { note } : undefined }, tx);
    });
    return { ok: true, status };
  }

  async payExpense(user: AuthUser, id: string, input: z.output<typeof paymentRecordSchema>) {
    const orgId = this.orgFor(user, 'finance.manage');
    const e = await this.prisma.expense.findFirst({ where: { id, organizationId: orgId }, include: { category: true } });
    if (!e) throw new NotFoundException('Expense not found');
    if (e.status !== 'APPROVED') throw new ConflictException('Only approved expenses can be marked paid');
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.expense.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'PAID', paidAt: new Date() } });
      if (res.count !== 1) throw new ConflictException('This expense was changed by someone else');
      const t = await tx.financeTransaction.create({
        data: {
          txnNo: await nextReference(tx, 'TXN'),
          organizationId: orgId,
          type: 'EXPENSE_PAYMENT',
          direction: 'OUTFLOW',
          amount: e.amount,
          txnDate: dateOnly(input.paidOn),
          method: input.method,
          referenceNo: input.referenceNo ?? null,
          counterparty: e.vendor,
          description: `${e.category.name}: ${e.description}`.slice(0, 500),
          expenseId: id,
          recordedById: user.id,
        },
      });
      await this.audit.log({ actorId: user.id, action: 'finance.expense.pay', entityType: 'Expense', entityId: id, organizationId: orgId, after: { status: 'PAID', txnNo: t.txnNo } }, tx);
    });
    return { ok: true };
  }

  // ───────────────────────── Reimbursements ─────────────────────────

  private reimbursementInclude = {
    employee: { select: { id: true, employeeCode: true, userId: true, user: { select: { fullName: true } }, manager: { select: { userId: true, user: { select: { fullName: true } } } } } },
    approver: { select: { fullName: true } },
    receiptFile: { select: { id: true, fileName: true } },
    transactions: { select: { txnNo: true, txnDate: true } },
  } satisfies Prisma.ReimbursementInclude;

  async reimbursements(user: AuthUser, q: Pagination & { status?: string; q?: string }) {
    const orgId = user.platformOrganizationId;
    const canFinance = Boolean(orgId && user.can('finance.view', orgId));
    // Managers see their direct reports' claims; finance sees all.
    let managerFilter: Prisma.ReimbursementWhereInput | null = null;
    if (!canFinance) {
      if (!user.employeeId) throw new ForbiddenException('You cannot view reimbursements');
      managerFilter = { employee: { managerId: user.employeeId } };
    }
    const base: Prisma.ReimbursementWhereInput = {
      ...(orgId ? { organizationId: orgId } : {}),
      ...(managerFilter ?? {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { employee: { user: { fullName: { contains: q.q, mode: 'insensitive' } } } }] } : {}),
    };
    const where = { ...base, ...(q.status ? { status: q.status as never } : {}) };
    const [rows, total, counts] = await Promise.all([
      this.prisma.reimbursement.findMany({ where, orderBy: { createdAt: 'desc' }, include: this.reimbursementInclude, ...skipTake(q) }),
      this.prisma.reimbursement.count({ where }),
      this.prisma.reimbursement.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);
    const adjustments = rows.length
      ? await this.prisma.payrollAdjustment.findMany({ where: { sourceRef: { in: rows.map((r) => `REIMBURSEMENT:${r.id}`) }, status: { not: 'CANCELLED' } }, select: { sourceRef: true, periodYear: true, periodMonth: true, status: true } })
      : [];
    const adjBy = new Map(adjustments.map((a) => [a.sourceRef!.slice('REIMBURSEMENT:'.length), a]));
    return {
      ...paginated(rows.map((r) => ({ ...r, isMine: r.employee.userId === user.id, payroll: adjBy.get(r.id) ?? null })), total, q),
      statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      canManage: Boolean(orgId && user.can('finance.manage', orgId)),
    };
  }

  async myReimbursements(user: AuthUser) {
    if (!user.employeeId) throw new ForbiddenException('Reimbursements are available to employees only');
    const rows = await this.prisma.reimbursement.findMany({ where: { employeeId: user.employeeId }, orderBy: { createdAt: 'desc' }, include: this.reimbursementInclude });
    const adjustments = rows.length
      ? await this.prisma.payrollAdjustment.findMany({ where: { sourceRef: { in: rows.map((r) => `REIMBURSEMENT:${r.id}`) }, status: { not: 'CANCELLED' } }, select: { sourceRef: true, periodYear: true, periodMonth: true, status: true } })
      : [];
    const adjBy = new Map(adjustments.map((a) => [a.sourceRef!.slice('REIMBURSEMENT:'.length), a]));
    return rows.map((r) => ({ ...r, payroll: adjBy.get(r.id) ?? null }));
  }

  async submitReimbursement(user: AuthUser, input: z.output<typeof reimbursementSchema>) {
    if (!user.employeeId) throw new ForbiddenException('Reimbursements are available to employees only');
    user.assert('reimbursement.self', undefined, 'You cannot submit reimbursement claims');
    const employee = await this.prisma.employee.findUniqueOrThrow({ where: { id: user.employeeId }, select: { id: true, organizationId: true } });
    await this.assertReceipt(user, input.receiptFileId);
    if (input.expenseDate > localDateString(new Date())) throw new BadRequestException({ message: 'The expense date cannot be in the future', details: [{ path: 'expenseDate', message: 'Future date' }] });
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.reimbursement.create({
        data: { organizationId: employee.organizationId, employeeId: employee.id, title: input.title, category: input.category, amount: input.amount, expenseDate: dateOnly(input.expenseDate), description: input.description ?? null, receiptFileId: input.receiptFileId ?? null },
      });
      await this.audit.log({ actorId: user.id, action: 'finance.reimbursement.submit', entityType: 'Reimbursement', entityId: r.id, organizationId: employee.organizationId, after: { title: r.title, amount: input.amount } }, tx);
      return r;
    });
  }

  async withdrawReimbursement(user: AuthUser, id: string) {
    const r = await this.prisma.reimbursement.findUnique({ where: { id }, include: { employee: { select: { userId: true } } } });
    if (!r || r.employee.userId !== user.id) throw new NotFoundException('Claim not found');
    if (r.status !== 'SUBMITTED') throw new ConflictException('Only claims that are still awaiting a decision can be withdrawn');
    await this.prisma.$transaction(async (tx) => {
      await tx.reimbursement.delete({ where: { id } });
      await this.audit.log({ actorId: user.id, action: 'finance.reimbursement.withdraw', entityType: 'Reimbursement', entityId: id, organizationId: r.organizationId, before: { title: r.title, amount: Number(r.amount) } }, tx);
    });
    return { ok: true };
  }

  async decideReimbursement(user: AuthUser, id: string, decision: 'APPROVE' | 'REJECT', note?: string) {
    const r = await this.prisma.reimbursement.findUnique({ where: { id }, include: { employee: { select: { userId: true, manager: { select: { userId: true } } } } } });
    if (!r) throw new NotFoundException('Claim not found');
    if (r.employee.userId === user.id) throw new ForbiddenException('You cannot approve or reject your own claim');
    const isManager = r.employee.manager?.userId === user.id;
    if (!isManager && !user.can('finance.manage', r.organizationId)) throw new ForbiddenException('Only the employee’s manager or the finance team can decide this claim');
    if (r.status !== 'SUBMITTED') throw new ConflictException('This claim has already been decided');
    const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.reimbursement.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status, approverId: user.id, decidedAt: new Date(), decisionNote: note ?? null } });
      if (res.count !== 1) throw new ConflictException('This claim was changed by someone else');
      await this.audit.log({ actorId: user.id, action: `finance.reimbursement.${decision.toLowerCase()}`, entityType: 'Reimbursement', entityId: id, organizationId: r.organizationId, before: { status: 'SUBMITTED' }, after: { status }, metadata: note ? { note } : undefined }, tx);
    });
    return { ok: true, status };
  }

  async payReimbursement(user: AuthUser, id: string, input: z.output<typeof reimbursementPaySchema>) {
    const orgId = this.orgFor(user, 'finance.manage');
    const r = await this.prisma.reimbursement.findFirst({ where: { id, organizationId: orgId }, include: { employee: { select: { id: true, userId: true, user: { select: { fullName: true } } } } } });
    if (!r) throw new NotFoundException('Claim not found');
    if (r.status !== 'APPROVED') throw new ConflictException('Only approved claims can be paid');
    if (r.employee.userId === user.id) throw new ForbiddenException('You cannot pay your own claim');
    const scheduled = await this.prisma.payrollAdjustment.count({ where: { sourceRef: `REIMBURSEMENT:${id}`, status: { in: ['PENDING', 'APPLIED'] } } });
    if (scheduled) throw new ConflictException('This claim is already scheduled through payroll');
    if (input.via === 'TRANSACTION') {
      await this.prisma.$transaction(async (tx) => {
        const res = await tx.reimbursement.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'PAID', paidAt: new Date() } });
        if (res.count !== 1) throw new ConflictException('This claim was changed by someone else');
        const t = await tx.financeTransaction.create({
          data: {
            txnNo: await nextReference(tx, 'TXN'),
            organizationId: orgId,
            type: 'REIMBURSEMENT_PAYMENT',
            direction: 'OUTFLOW',
            amount: r.amount,
            txnDate: dateOnly(input.paidOn),
            method: input.method,
            referenceNo: input.referenceNo ?? null,
            counterparty: r.employee.user.fullName,
            description: `Reimbursement: ${r.title}`.slice(0, 500),
            reimbursementId: id,
            recordedById: user.id,
          },
        });
        await this.audit.log({ actorId: user.id, action: 'finance.reimbursement.pay', entityType: 'Reimbursement', entityId: id, organizationId: orgId, after: { status: 'PAID', txnNo: t.txnNo } }, tx);
      });
      return { ok: true, status: 'PAID' };
    }
    const locked = await this.prisma.payrollRun.findFirst({ where: { organizationId: orgId, periodYear: input.periodYear, periodMonth: input.periodMonth, status: { in: ['APPROVED', 'PAID'] } }, select: { status: true } });
    if (locked) throw new ConflictException(`Payroll for ${input.periodYear}-${String(input.periodMonth).padStart(2, '0')} is already ${locked.status.toLowerCase()} — choose a later month`);
    await this.prisma.$transaction(async (tx) => {
      const adj = await tx.payrollAdjustment.create({
        data: { employeeId: r.employee.id, periodYear: input.periodYear, periodMonth: input.periodMonth, type: 'REIMBURSEMENT', amount: r.amount, description: `Reimbursement: ${r.title}`.slice(0, 200), sourceRef: `REIMBURSEMENT:${id}`, createdById: user.id },
      });
      await this.audit.log({ actorId: user.id, action: 'finance.reimbursement.pay_via_payroll', entityType: 'Reimbursement', entityId: id, organizationId: orgId, after: { adjustmentId: adj.id, period: `${input.periodYear}-${input.periodMonth}` } }, tx);
    });
    return { ok: true, status: 'APPROVED', scheduledThroughPayroll: `${input.periodYear}-${String(input.periodMonth).padStart(2, '0')}` };
  }

  /** Scheduled: claims paid through a PAID payroll run are marked PAID. */
  async syncPayrollPaidReimbursements(tx: Tx): Promise<number> {
    const adjustments = await tx.payrollAdjustment.findMany({
      where: { sourceRef: { startsWith: 'REIMBURSEMENT:' }, status: 'APPLIED', payrollRun: { status: 'PAID' } },
      select: { sourceRef: true, payrollRun: { select: { paidAt: true } } },
    });
    let n = 0;
    for (const a of adjustments) {
      const id = a.sourceRef!.slice('REIMBURSEMENT:'.length);
      const res = await tx.reimbursement.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'PAID', paidAt: a.payrollRun?.paidAt ?? new Date() } });
      if (res.count) {
        await this.audit.log({ actorId: null, action: 'finance.reimbursement.paid_via_payroll', entityType: 'Reimbursement', entityId: id, after: { status: 'PAID' } }, tx);
        n += 1;
      }
    }
    return n;
  }

  // ───────────────────────── Reports ─────────────────────────

  async monthlyReport(user: AuthUser, from: string, to: string) {
    const orgId = this.orgFor(user, 'finance.view');
    const start = new Date(`${from}-01T00:00:00Z`);
    const [ty, tm] = to.split('-').map(Number);
    const end = new Date(Date.UTC(ty, tm, 1)); // exclusive
    if (end <= start) throw new BadRequestException('The end month must be after the start month');
    if ((ty - start.getUTCFullYear()) * 12 + tm - (start.getUTCMonth() + 1) > 35) throw new BadRequestException('Report at most 36 months at a time');

    // Date-only fields (txnDate, receivedOn, expenseDate) are stored at UTC midnight, so their UTC
    // month is the calendar month. createdAt is an instant: bucket it by the IST month and filter on
    // IST month boundaries so no record lands outside the listed months.
    const IST_MS = 330 * 60 * 1000;
    const monthOf = (d: Date) => d.toISOString().slice(0, 7);
    const istMonthOf = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 7);
    const [txnRows, paymentRows, commissionRows, expenseRows] = await Promise.all([
      this.prisma.financeTransaction.findMany({ where: { organizationId: orgId, txnDate: { gte: start, lt: end } }, select: { txnDate: true, type: true, direction: true, amount: true } }),
      this.prisma.dealPayment.findMany({ where: { deal: { organizationId: orgId }, receivedOn: { gte: start, lt: end } }, select: { receivedOn: true, receivedBy: true, amount: true } }),
      this.prisma.commissionRecord.findMany({
        where: { organizationId: orgId, status: { not: 'CANCELLED' }, createdAt: { gte: new Date(start.getTime() - IST_MS), lt: new Date(end.getTime() - IST_MS) } },
        select: { createdAt: true, amount: true },
      }),
      this.prisma.expense.findMany({ where: { organizationId: orgId, status: { in: ['APPROVED', 'PAID'] }, expenseDate: { gte: start, lt: end } }, select: { amount: true, category: { select: { name: true } } } }),
    ]);
    /** Sums amounts (in paise, exactly) per key; returns rupees. */
    const sumBy = <T>(items: T[], key: (x: T) => string, amount: (x: T) => number) => {
      const totals = new Map<string, number>();
      for (const x of items) totals.set(key(x), (totals.get(key(x)) ?? 0) + toPaise(amount(x)));
      return [...totals].map(([k, paise]) => ({ key: k, total: fromPaise(paise) }));
    };
    const txns = sumBy(txnRows, (t) => `${monthOf(t.txnDate)}|${t.type}|${t.direction}`, (t) => t.amount).map(({ key, total }) => {
      const [month, type, direction] = key.split('|');
      return { month, type, direction, total };
    });
    const dealPayments = sumBy(paymentRows, (p) => `${monthOf(p.receivedOn)}|${p.receivedBy}`, (p) => p.amount).map(({ key, total }) => {
      const [month, receivedBy] = key.split('|');
      return { month, receivedBy, total };
    });
    const accrued = sumBy(commissionRows, (c) => istMonthOf(c.createdAt), (c) => c.amount).map(({ key, total }) => ({ month: key, total }));
    const expensesByCategory = sumBy(expenseRows, (e) => e.category.name, (e) => e.amount)
      .map(({ key, total }) => ({ category: key, total }))
      .sort((a, b) => b.total - a.total);
    const [invoiceOutstanding, commissionsOutstanding] = await Promise.all([
      this.prisma.invoice.aggregate({ where: { organizationId: orgId, status: { in: ['ISSUED', 'PARTIALLY_PAID'] } }, _sum: { total: true, amountPaid: true } }),
      this.prisma.commissionRecord.aggregate({ where: { organizationId: orgId, status: { in: ['APPROVED', 'PAYABLE'] } }, _sum: { amount: true, amountPaid: true } }),
    ]);

    const months: string[] = [];
    for (let d = new Date(start); d < end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) months.push(d.toISOString().slice(0, 7));
    const n = (v: number | null | undefined) => Number(v ?? 0);
    const rows = months.map((month) => {
      const t = txns.filter((x) => x.month === month);
      const sumType = (type: string) => t.filter((x) => x.type === type).reduce((s, x) => s + n(x.total), 0);
      const inflow = t.filter((x) => x.direction === 'INFLOW').reduce((s, x) => s + n(x.total), 0);
      const outflow = t.filter((x) => x.direction === 'OUTFLOW').reduce((s, x) => s + n(x.total), 0);
      const dp = dealPayments.filter((x) => x.month === month);
      return {
        month,
        revenueReceived: sumType('INVOICE_RECEIPT'),
        otherInflows: fromPaise(toPaise(inflow) - toPaise(sumType('INVOICE_RECEIPT'))),
        customerMoneyOnDeals: dp.reduce((s, x) => s + n(x.total), 0),
        customerMoneyByReceiver: Object.fromEntries(dp.map((x) => [x.receivedBy, n(x.total)])),
        commissionsAccrued: n(accrued.find((x) => x.month === month)?.total),
        commissionsPaid: sumType('COMMISSION_PAYOUT'),
        expensesPaid: sumType('EXPENSE_PAYMENT'),
        payrollCost: sumType('SALARY_PAYMENT'),
        reimbursementsPaid: sumType('REIMBURSEMENT_PAYMENT'),
        inflow,
        outflow,
        net: fromPaise(toPaise(inflow) - toPaise(outflow)),
      };
    });
    const sum = (k: keyof (typeof rows)[number]) => fromPaise(rows.reduce((s, r) => s + toPaise(Number(r[k] as number)), 0));
    return {
      from,
      to,
      months: rows,
      totals: {
        revenueReceived: sum('revenueReceived'),
        otherInflows: sum('otherInflows'),
        customerMoneyOnDeals: sum('customerMoneyOnDeals'),
        commissionsAccrued: sum('commissionsAccrued'),
        commissionsPaid: sum('commissionsPaid'),
        expensesPaid: sum('expensesPaid'),
        payrollCost: sum('payrollCost'),
        reimbursementsPaid: sum('reimbursementsPaid'),
        inflow: sum('inflow'),
        outflow: sum('outflow'),
        net: sum('net'),
      },
      expensesByCategory: expensesByCategory.map((e) => ({ category: e.category, total: n(e.total) })),
      snapshot: {
        invoicesOutstanding: fromPaise(toPaise(n(invoiceOutstanding._sum.total)) - toPaise(n(invoiceOutstanding._sum.amountPaid))),
        commissionsOutstanding: fromPaise(toPaise(n(commissionsOutstanding._sum.amount)) - toPaise(n(commissionsOutstanding._sum.amountPaid))),
      },
    };
  }

  async monthlyReportCsv(user: AuthUser, from: string, to: string): Promise<string> {
    const r = await this.monthlyReport(user, from, to);
    await this.audit.log({ actorId: user.id, action: 'finance.report.export', entityType: 'FinanceReport', organizationId: user.platformOrganizationId, metadata: { from, to } });
    const header = ['Month', 'Revenue received (invoice receipts)', 'Other inflows', 'Customer money on deals (not revenue)', 'Commissions accrued', 'Commissions paid', 'Expenses paid', 'Payroll cost', 'Reimbursements paid', 'Total inflow', 'Total outflow', 'Net cash'];
    const rows = r.months.map((m) => [m.month, m.revenueReceived, m.otherInflows, m.customerMoneyOnDeals, m.commissionsAccrued, m.commissionsPaid, m.expensesPaid, m.payrollCost, m.reimbursementsPaid, m.inflow, m.outflow, m.net].map((v) => (typeof v === 'number' ? v.toFixed(2) : v)));
    const t = r.totals;
    rows.push(['Total', t.revenueReceived, t.otherInflows, t.customerMoneyOnDeals, t.commissionsAccrued, t.commissionsPaid, t.expensesPaid, t.payrollCost, t.reimbursementsPaid, t.inflow, t.outflow, t.net].map((v) => (typeof v === 'number' ? v.toFixed(2) : v)));
    return toCsv(header, rows);
  }
}

/** RFC 4180 CSV with formula-injection protection for spreadsheet apps. */
export function toCsv(header: string[], rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
