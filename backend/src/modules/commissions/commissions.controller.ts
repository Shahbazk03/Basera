import { Body, Controller, Get, Injectable, Logger, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  COMMISSION_RECIPIENT_TYPES,
  COMMISSION_STATUSES,
  commissionManualSchema,
  commissionPayViaPayrollSchema,
  commissionRuleSchema,
  commissionStatusSchema,
  payoutCreateSchema,
  payoutPaySchema,
} from '@estate/shared';
import { env } from '../../config/env';
import { AuthUser } from '../../common/auth/auth-user';
import { ApiZodBody, CurrentUser, RequirePermissions } from '../../common/decorators';
import { paginationSchema } from '../../common/http';
import { UuidParam, ZodPipe } from '../../common/zod.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { CommissionsService } from './commissions.service';

const recordsQuery = paginationSchema.extend({
  status: z.enum(COMMISSION_STATUSES).optional(),
  recipientType: z.enum(COMMISSION_RECIPIENT_TYPES).optional(),
  q: z.string().trim().max(100).optional(),
  dealId: z.uuid().optional(),
});
// Partial update schema built from the shared rule shape (without its create-time defaults being applied to absent keys).
const ruleUpdateSchema = z.object(commissionRuleSchema.shape).partial();

@ApiTags('Commissions')
@Controller({ path: 'commissions', version: '1' })
export class CommissionsController {
  constructor(private readonly commissions: CommissionsService) {}

  @Get()
  @RequirePermissions('commission.view')
  records(@CurrentUser() user: AuthUser, @Query(new ZodPipe(recordsQuery)) q: z.output<typeof recordsQuery>) {
    return this.commissions.records(user, q);
  }

  @Get('statement')
  statement(@CurrentUser() user: AuthUser, @Query(new ZodPipe(paginationSchema.extend({ status: z.enum(COMMISSION_STATUSES).optional() }))) q: { page: number; pageSize: number; status?: (typeof COMMISSION_STATUSES)[number] }) {
    return this.commissions.statement(user, q);
  }

  @Post()
  @RequirePermissions('commission.manage')
  @ApiZodBody(commissionManualSchema)
  createManual(@CurrentUser() user: AuthUser, @Body(new ZodPipe(commissionManualSchema)) body: z.output<typeof commissionManualSchema>) {
    return this.commissions.createManual(user, body);
  }

  @Post(':id/status')
  @ApiZodBody(commissionStatusSchema)
  status(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(commissionStatusSchema)) body: z.output<typeof commissionStatusSchema>) {
    return this.commissions.transition(user, id, body.status, body.notes);
  }

  @Get('rules')
  @RequirePermissions('commission.view')
  rules(@CurrentUser() user: AuthUser) {
    return this.commissions.rules(user);
  }

  @Post('rules')
  @RequirePermissions('commission.manage')
  @ApiZodBody(commissionRuleSchema)
  createRule(@CurrentUser() user: AuthUser, @Body(new ZodPipe(commissionRuleSchema)) body: z.output<typeof commissionRuleSchema>) {
    return this.commissions.createRule(user, body);
  }

  @Patch('rules/:id')
  @RequirePermissions('commission.manage')
  updateRule(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body() raw: Record<string, unknown>) {
    const parsed = new ZodPipe(ruleUpdateSchema).transform(raw ?? {});
    const present = Object.fromEntries(Object.entries(parsed).filter(([k]) => raw && k in raw)) as Partial<z.output<typeof commissionRuleSchema>>;
    return this.commissions.updateRule(user, id, present);
  }

  @Get('deals')
  @RequirePermissions('commission.manage')
  deals(@CurrentUser() user: AuthUser, @Query(new ZodPipe(z.object({ q: z.string().trim().max(60).optional() }))) q: { q?: string }) {
    return this.commissions.eligibleDeals(user, q);
  }

  @Post('deals/:dealId/generate')
  @RequirePermissions('commission.manage')
  generate(@CurrentUser() user: AuthUser, @Param('dealId', UuidParam) dealId: string) {
    return this.commissions.generateForDeal(dealId, user);
  }

  @Post('pay-via-payroll')
  @RequirePermissions('commission.manage')
  @ApiZodBody(commissionPayViaPayrollSchema)
  payViaPayroll(@CurrentUser() user: AuthUser, @Body(new ZodPipe(commissionPayViaPayrollSchema)) body: z.output<typeof commissionPayViaPayrollSchema>) {
    return this.commissions.payViaPayroll(user, body);
  }

  @Get('payouts')
  @RequirePermissions('commission.view')
  payouts(@CurrentUser() user: AuthUser, @Query(new ZodPipe(paginationSchema.extend({ status: z.enum(['PENDING', 'PAID', 'CANCELLED']).optional() }))) q: { page: number; pageSize: number; status?: 'PENDING' | 'PAID' | 'CANCELLED' }) {
    return this.commissions.payouts(user, q);
  }

  @Post('payouts')
  @RequirePermissions('commission.manage')
  @ApiZodBody(payoutCreateSchema)
  createPayout(@CurrentUser() user: AuthUser, @Body(new ZodPipe(payoutCreateSchema)) body: z.output<typeof payoutCreateSchema>) {
    return this.commissions.createPayout(user, body);
  }

  @Post('payouts/:id/pay')
  @RequirePermissions('commission.manage')
  @ApiZodBody(payoutPaySchema)
  pay(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(payoutPaySchema)) body: z.output<typeof payoutPaySchema>) {
    return this.commissions.payPayout(user, id, body);
  }

  @Post('payouts/:id/cancel')
  @RequirePermissions('commission.manage')
  cancelPayout(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.commissions.cancelPayout(user, id);
  }
}

/** Hourly: generate commissions for booked deals and mark payroll-paid commissions as paid. */
@Injectable()
export class CommissionsScheduler {
  private readonly logger = new Logger('CommissionsScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly commissions: CommissionsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    if (env().APP_ENV === 'test') return;
    try {
      const created = await this.prisma.withJobLock('jobs:commission-generation', (tx) => this.commissions.generateForEligibleDeals(tx));
      if (created) this.logger.log(`Generated ${created} commission record(s)`);
      const synced = await this.prisma.withJobLock('jobs:commission-payroll-sync', (tx) => this.commissions.syncPayrollPaidCommissions(tx));
      if (synced) this.logger.log(`Marked ${synced} payroll-paid commission(s) as paid`);
    } catch (err) {
      this.logger.error('Commission job failed', err instanceof Error ? err.stack : String(err));
    }
  }
}

@Module({ controllers: [CommissionsController], providers: [CommissionsService, CommissionsScheduler], exports: [CommissionsService] })
export class CommissionsModule {}
