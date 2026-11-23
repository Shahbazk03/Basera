import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  ADJUSTMENT_STATUSES,
  payrollAdjustmentSchema,
  payrollPaymentSchema,
  payrollRunCancelSchema,
  payrollRunCreateSchema,
  salaryComponentSchema,
  salaryStructureSchema,
} from '@estate/shared';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators';
import { paginationSchema } from '../../common/http';
import { UuidParam, ZodPipe } from '../../common/zod.pipe';
import { PatchPipe } from '../hr/hr.util';
import { PayrollService } from './payroll.service';

const adjustmentList = paginationSchema.extend({
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  employeeId: z.uuid().optional(),
  status: z.enum(ADJUSTMENT_STATUSES).optional(),
});

@ApiTags('Payroll')
@Controller({ path: 'payroll', version: '1' })
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('components')
  components(@CurrentUser() user: AuthUser) {
    return this.payroll.components(user);
  }

  @Post('components')
  createComponent(@CurrentUser() user: AuthUser, @Body(new ZodPipe(salaryComponentSchema)) body: z.output<typeof salaryComponentSchema>) {
    return this.payroll.saveComponent(user, null, body);
  }

  @Patch('components/:id')
  updateComponent(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new PatchPipe(salaryComponentSchema)) body: Partial<z.output<typeof salaryComponentSchema>>) {
    return this.payroll.saveComponent(user, id, body);
  }

  @Get('structures')
  structures(@CurrentUser() user: AuthUser) {
    return this.payroll.structuresOverview(user);
  }

  @Get('structures/:employeeId')
  employeeStructures(@CurrentUser() user: AuthUser, @Param('employeeId', UuidParam) employeeId: string) {
    return this.payroll.employeeStructures(user, employeeId);
  }

  @Post('structures/:employeeId')
  createStructure(@CurrentUser() user: AuthUser, @Param('employeeId', UuidParam) employeeId: string, @Body(new ZodPipe(salaryStructureSchema)) body: z.output<typeof salaryStructureSchema>) {
    return this.payroll.createStructure(user, employeeId, body);
  }

  @Get('adjustments')
  adjustments(@CurrentUser() user: AuthUser, @Query(new ZodPipe(adjustmentList)) q: z.output<typeof adjustmentList>) {
    return this.payroll.adjustments(user, q);
  }

  @Post('adjustments')
  createAdjustment(@CurrentUser() user: AuthUser, @Body(new ZodPipe(payrollAdjustmentSchema)) body: z.output<typeof payrollAdjustmentSchema>) {
    return this.payroll.createAdjustment(user, body);
  }

  @Post('adjustments/:id/cancel')
  cancelAdjustment(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.payroll.cancelAdjustment(user, id);
  }

  @Get('runs')
  runs(@CurrentUser() user: AuthUser, @Query(new ZodPipe(paginationSchema)) q: z.output<typeof paginationSchema>) {
    return this.payroll.runs(user, q);
  }

  @Post('runs')
  createRun(@CurrentUser() user: AuthUser, @Body(new ZodPipe(payrollRunCreateSchema)) body: z.output<typeof payrollRunCreateSchema>) {
    return this.payroll.createRun(user, body);
  }

  @Get('runs/:id')
  run(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.payroll.getRun(user, id);
  }

  @Post('runs/:id/calculate')
  calculate(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.payroll.calculate(user, id);
  }

  @Post('runs/:id/approve')
  approve(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.payroll.approve(user, id);
  }

  @Post('runs/:id/payments')
  pay(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(payrollPaymentSchema)) body: z.output<typeof payrollPaymentSchema>) {
    return this.payroll.pay(user, id, body);
  }

  @Post('runs/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(payrollRunCancelSchema)) body: z.output<typeof payrollRunCancelSchema>) {
    return this.payroll.cancel(user, id, body.reason);
  }

  @Get('payslips/:id')
  payslip(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.payroll.payslip(user, id);
  }

  @Get('me/payslips')
  myPayslips(@CurrentUser() user: AuthUser) {
    return this.payroll.myPayslips(user);
  }
}
