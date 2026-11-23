import { Body, Controller, Delete, Get, Injectable, Logger, Module, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  approvalDecisionSchema,
  EXPENSE_STATUSES,
  expenseCategorySchema,
  expenseSchema,
  INVOICE_STATUSES,
  invoiceCancelSchema,
  invoicePaymentSchema,
  invoiceSchema,
  paymentRecordSchema,
  REIMBURSEMENT_STATUSES,
  reimbursementPaySchema,
  reimbursementSchema,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_TYPES,
  transactionSchema,
  localDateString,
} from '@estate/shared';
import { env } from '../../config/env';
import { AuthUser } from '../../common/auth/auth-user';
import { ApiZodBody, CurrentUser, RequirePermissions } from '../../common/decorators';
import { paginationSchema } from '../../common/http';
import { UuidParam, ZodPipe } from '../../common/zod.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { FinanceService } from './finance.service';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const day = z.iso.date();
const txnQuery = paginationSchema.extend({
  type: z.enum(TRANSACTION_TYPES).optional(),
  direction: z.enum(TRANSACTION_DIRECTIONS).optional(),
  from: day.optional(),
  to: day.optional(),
  q: z.string().trim().max(100).optional(),
});
const invoiceQuery = paginationSchema.extend({ status: z.enum(INVOICE_STATUSES).optional(), q: z.string().trim().max(100).optional(), from: day.optional(), to: day.optional() });
const expenseQuery = paginationSchema.extend({ status: z.enum(EXPENSE_STATUSES).optional(), categoryId: z.uuid().optional(), from: day.optional(), to: day.optional(), q: z.string().trim().max(100).optional() });
const reimbursementQuery = paginationSchema.extend({ status: z.enum(REIMBURSEMENT_STATUSES).optional(), q: z.string().trim().max(100).optional() });
const reportQuery = z.object({ from: month, to: month });

@ApiTags('Finance')
@Controller({ path: 'finance', version: '1' })
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  // Ledger
  @Get('transactions')
  @RequirePermissions('finance.view')
  transactions(@CurrentUser() user: AuthUser, @Query(new ZodPipe(txnQuery)) q: z.output<typeof txnQuery>) {
    return this.finance.transactions(user, q);
  }

  @Get('transactions/export')
  @RequirePermissions('finance.view')
  async exportTransactions(@CurrentUser() user: AuthUser, @Query(new ZodPipe(txnQuery.omit({ page: true, pageSize: true }))) q: Omit<z.output<typeof txnQuery>, 'page' | 'pageSize'>, @Res() res: Response) {
    const csv = await this.finance.transactionsCsv(user, q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="transactions-${localDateString(new Date())}.csv"`);
    res.send(csv);
  }

  @Post('transactions')
  @RequirePermissions('finance.manage')
  @ApiZodBody(transactionSchema)
  createTransaction(@CurrentUser() user: AuthUser, @Body(new ZodPipe(transactionSchema)) body: z.output<typeof transactionSchema>) {
    return this.finance.createTransaction(user, body);
  }

  // Invoices
  @Get('invoices')
  @RequirePermissions('finance.view')
  invoices(@CurrentUser() user: AuthUser, @Query(new ZodPipe(invoiceQuery)) q: z.output<typeof invoiceQuery>) {
    return this.finance.invoices(user, q);
  }

  @Get('invoices/:id')
  @RequirePermissions('finance.view')
  invoice(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.finance.invoice(user, id);
  }

  @Post('invoices')
  @RequirePermissions('finance.manage')
  @ApiZodBody(invoiceSchema)
  createInvoice(@CurrentUser() user: AuthUser, @Body(new ZodPipe(invoiceSchema)) body: z.output<typeof invoiceSchema>) {
    return this.finance.createInvoice(user, body);
  }

  @Patch('invoices/:id')
  @RequirePermissions('finance.manage')
  @ApiZodBody(invoiceSchema)
  updateInvoice(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(invoiceSchema)) body: z.output<typeof invoiceSchema>) {
    return this.finance.updateInvoice(user, id, body);
  }

  @Post('invoices/:id/issue')
  @RequirePermissions('finance.manage')
  issue(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.finance.issueInvoice(user, id);
  }

  @Post('invoices/:id/cancel')
  @RequirePermissions('finance.manage')
  cancelInvoice(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(invoiceCancelSchema)) body: z.output<typeof invoiceCancelSchema>) {
    return this.finance.cancelInvoice(user, id, body.reason);
  }

  @Post('invoices/:id/payments')
  @RequirePermissions('finance.manage')
  @ApiZodBody(invoicePaymentSchema)
  invoicePayment(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(invoicePaymentSchema)) body: z.output<typeof invoicePaymentSchema>) {
    return this.finance.recordInvoicePayment(user, id, body);
  }

  // Expenses
  @Get('expense-categories')
  @RequirePermissions('finance.view')
  categories(@CurrentUser() user: AuthUser) {
    return this.finance.categories(user);
  }

  @Post('expense-categories')
  @RequirePermissions('finance.manage')
  createCategory(@CurrentUser() user: AuthUser, @Body(new ZodPipe(expenseCategorySchema)) body: z.output<typeof expenseCategorySchema>) {
    return this.finance.createCategory(user, body);
  }

  @Patch('expense-categories/:id')
  @RequirePermissions('finance.manage')
  updateCategory(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(z.object({ name: z.string().trim().min(2).max(80).optional(), isActive: z.boolean().optional() }))) body: { name?: string; isActive?: boolean }) {
    return this.finance.updateCategory(user, id, body);
  }

  @Get('expenses')
  @RequirePermissions('finance.view')
  expenses(@CurrentUser() user: AuthUser, @Query(new ZodPipe(expenseQuery)) q: z.output<typeof expenseQuery>) {
    return this.finance.expenses(user, q);
  }

  @Post('expenses')
  @RequirePermissions('finance.manage')
  @ApiZodBody(expenseSchema)
  createExpense(@CurrentUser() user: AuthUser, @Body(new ZodPipe(expenseSchema)) body: z.output<typeof expenseSchema>) {
    return this.finance.createExpense(user, body);
  }

  @Post('expenses/:id/decision')
  @RequirePermissions('finance.manage')
  decideExpense(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(approvalDecisionSchema)) body: z.output<typeof approvalDecisionSchema>) {
    return this.finance.decideExpense(user, id, body.decision, body.note);
  }

  @Post('expenses/:id/pay')
  @RequirePermissions('finance.manage')
  payExpense(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(paymentRecordSchema)) body: z.output<typeof paymentRecordSchema>) {
    return this.finance.payExpense(user, id, body);
  }

  // Reimbursements (finance team & managers)
  @Get('reimbursements')
  reimbursements(@CurrentUser() user: AuthUser, @Query(new ZodPipe(reimbursementQuery)) q: z.output<typeof reimbursementQuery>) {
    return this.finance.reimbursements(user, q);
  }

  @Post('reimbursements/:id/decision')
  decideReimbursement(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(approvalDecisionSchema)) body: z.output<typeof approvalDecisionSchema>) {
    return this.finance.decideReimbursement(user, id, body.decision, body.note);
  }

  @Post('reimbursements/:id/pay')
  @RequirePermissions('finance.manage')
  payReimbursement(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(reimbursementPaySchema)) body: z.output<typeof reimbursementPaySchema>) {
    return this.finance.payReimbursement(user, id, body);
  }

  // Reports
  @Get('reports/monthly')
  @RequirePermissions('finance.view')
  monthly(@CurrentUser() user: AuthUser, @Query(new ZodPipe(reportQuery)) q: z.output<typeof reportQuery>) {
    return this.finance.monthlyReport(user, q.from, q.to);
  }

  @Get('reports/monthly/export')
  @RequirePermissions('finance.view')
  async monthlyCsv(@CurrentUser() user: AuthUser, @Query(new ZodPipe(reportQuery)) q: z.output<typeof reportQuery>, @Res() res: Response) {
    const csv = await this.finance.monthlyReportCsv(user, q.from, q.to);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="finance-${q.from}-to-${q.to}.csv"`);
    res.send(csv);
  }
}

@ApiTags('Finance — self service')
@Controller({ path: 'me/reimbursements', version: '1' })
export class MyReimbursementsController {
  constructor(private readonly finance: FinanceService) {}

  @Get()
  @RequirePermissions('reimbursement.self')
  list(@CurrentUser() user: AuthUser) {
    return this.finance.myReimbursements(user);
  }

  @Post()
  @RequirePermissions('reimbursement.self')
  @ApiZodBody(reimbursementSchema)
  submit(@CurrentUser() user: AuthUser, @Body(new ZodPipe(reimbursementSchema)) body: z.output<typeof reimbursementSchema>) {
    return this.finance.submitReimbursement(user, body);
  }

  @Delete(':id')
  @RequirePermissions('reimbursement.self')
  withdraw(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.finance.withdrawReimbursement(user, id);
  }
}

/** Hourly: mark reimbursements paid through a PAID payroll run as paid. */
@Injectable()
export class FinanceScheduler {
  private readonly logger = new Logger('FinanceScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    if (env().APP_ENV === 'test') return;
    try {
      const n = await this.prisma.withAdvisoryLock('jobs:reimbursement-payroll-sync', (tx) => this.finance.syncPayrollPaidReimbursements(tx));
      if (n) this.logger.log(`Marked ${n} payroll-paid reimbursement(s) as paid`);
    } catch (err) {
      this.logger.error('Reimbursement sync failed', err instanceof Error ? err.stack : String(err));
    }
  }
}

@Module({ controllers: [FinanceController, MyReimbursementsController], providers: [FinanceService, FinanceScheduler], exports: [FinanceService] })
export class FinanceModule {}
