import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  hrApprovalDecisionSchema,
  attendanceCorrectionSchema,
  attendanceManualSchema,
  holidaySchema,
  leaveApplySchema,
  leaveBalanceSetSchema,
  leaveDecisionSchema,
  leaveTypeSchema,
  leaveYearAllocateSchema,
  shiftSchema,
  taskSchema,
  taskUpdateSchema,
  TASK_STATUSES,
} from '@estate/shared';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, ReqMeta, RequestMeta } from '../../common/decorators';
import { paginationSchema } from '../../common/http';
import { UuidParam, ZodPipe } from '../../common/zod.pipe';
import { AttendanceService } from './attendance.service';
import { LeaveService } from './leave.service';
import { TasksService } from './tasks.service';
import { monthQuery, parseMonth, PatchPipe, requireEmployee, todayIst } from './hr.util';

const dateQuery = z.object({ date: z.iso.date().optional(), departmentId: z.uuid().optional() });
const monthOnly = z.object({ month: monthQuery, departmentId: z.uuid().optional() });
const correctionList = paginationSchema.extend({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(), scope: z.enum(['mine', 'review']).default('mine') });
const leaveList = paginationSchema.extend({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(), scope: z.enum(['mine', 'team', 'all']).default('mine'), employeeId: z.uuid().optional() });
const yearQuery = z.object({ year: z.coerce.number().int().min(2020).max(2100).default(new Date().getUTCFullYear()), employeeId: z.uuid().optional() });
const taskList = paginationSchema.extend({ scope: z.enum(['mine', 'all']).default('mine'), status: z.enum(TASK_STATUSES).optional(), assignedToId: z.uuid().optional(), q: z.string().trim().max(100).optional() });

@ApiTags('HR — attendance, leave & tasks')
@Controller({ path: 'hr', version: '1' })
export class HrOpsController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly leave: LeaveService,
    private readonly tasks: TasksService,
  ) {}

  // ───────────── Attendance (self) ─────────────

  @Get('attendance/me/today')
  today(@CurrentUser() user: AuthUser) {
    return this.attendance.today(user);
  }

  @Post('attendance/check-in')
  checkIn(@CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.attendance.checkIn(user, meta.ip);
  }

  @Post('attendance/check-out')
  checkOut(@CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.attendance.checkOut(user, meta.ip);
  }

  @Get('attendance/me')
  myMonth(@CurrentUser() user: AuthUser, @Query(new ZodPipe(monthOnly)) q: z.output<typeof monthOnly>) {
    const { year, month } = parseMonth(q.month);
    return this.attendance.month(user, requireEmployee(user), year, month);
  }

  // ───────────── Attendance (team / HR) ─────────────

  @Get('attendance/board')
  board(@CurrentUser() user: AuthUser, @Query(new ZodPipe(dateQuery)) q: z.output<typeof dateQuery>) {
    return this.attendance.board(user, q.date ?? todayIst(), q.departmentId);
  }

  @Get('attendance/report')
  report(@CurrentUser() user: AuthUser, @Query(new ZodPipe(monthOnly)) q: z.output<typeof monthOnly>) {
    const { year, month } = parseMonth(q.month);
    return this.attendance.report(user, year, month, q.departmentId);
  }

  @Get('attendance/employees/:employeeId')
  employeeMonth(@CurrentUser() user: AuthUser, @Param('employeeId', UuidParam) employeeId: string, @Query(new ZodPipe(monthOnly)) q: z.output<typeof monthOnly>) {
    const { year, month } = parseMonth(q.month);
    return this.attendance.month(user, employeeId, year, month);
  }

  @Put('attendance/manual')
  manual(@CurrentUser() user: AuthUser, @Body(new ZodPipe(attendanceManualSchema)) body: z.output<typeof attendanceManualSchema>) {
    return this.attendance.manual(user, body);
  }

  @Post('attendance/corrections')
  requestCorrection(@CurrentUser() user: AuthUser, @Body(new ZodPipe(attendanceCorrectionSchema)) body: z.output<typeof attendanceCorrectionSchema>) {
    return this.attendance.requestCorrection(user, body);
  }

  @Get('attendance/corrections')
  corrections(@CurrentUser() user: AuthUser, @Query(new ZodPipe(correctionList)) q: z.output<typeof correctionList>) {
    return this.attendance.listCorrections(user, q);
  }

  @Post('attendance/corrections/:id/decision')
  decideCorrection(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(hrApprovalDecisionSchema)) body: z.output<typeof hrApprovalDecisionSchema>) {
    return this.attendance.decideCorrection(user, id, body);
  }

  @Post('attendance/corrections/:id/cancel')
  cancelCorrection(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.attendance.cancelCorrection(user, id);
  }

  // ───────────── Shifts & holidays ─────────────

  @Get('shifts')
  shifts(@CurrentUser() user: AuthUser) {
    return this.attendance.shifts(user);
  }

  @Post('shifts')
  createShift(@CurrentUser() user: AuthUser, @Body(new ZodPipe(shiftSchema)) body: z.output<typeof shiftSchema>) {
    return this.attendance.saveShift(user, null, body);
  }

  @Patch('shifts/:id')
  updateShift(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new PatchPipe(shiftSchema)) body: Partial<z.output<typeof shiftSchema>>) {
    return this.attendance.saveShift(user, id, body);
  }

  @Get('holidays')
  holidays(@CurrentUser() user: AuthUser, @Query(new ZodPipe(yearQuery)) q: z.output<typeof yearQuery>) {
    return this.attendance.holidays(user, q.year);
  }

  @Post('holidays')
  addHoliday(@CurrentUser() user: AuthUser, @Body(new ZodPipe(holidaySchema)) body: z.output<typeof holidaySchema>) {
    return this.attendance.addHoliday(user, body);
  }

  @Delete('holidays/:id')
  removeHoliday(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.attendance.removeHoliday(user, id);
  }

  // ───────────── Leave ─────────────

  @Get('leave/types')
  leaveTypes(@CurrentUser() user: AuthUser) {
    return this.leave.types(user);
  }

  @Post('leave/types')
  createLeaveType(@CurrentUser() user: AuthUser, @Body(new ZodPipe(leaveTypeSchema)) body: z.output<typeof leaveTypeSchema>) {
    return this.leave.saveType(user, null, body);
  }

  @Patch('leave/types/:id')
  updateLeaveType(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new PatchPipe(leaveTypeSchema)) body: Partial<z.output<typeof leaveTypeSchema>>) {
    return this.leave.saveType(user, id, body);
  }

  @Get('leave/balances')
  balances(@CurrentUser() user: AuthUser, @Query(new ZodPipe(yearQuery)) q: z.output<typeof yearQuery>) {
    return this.leave.balances(user, q.year, q.employeeId);
  }

  @Get('leave/balances/me')
  myBalances(@CurrentUser() user: AuthUser, @Query(new ZodPipe(yearQuery)) q: z.output<typeof yearQuery>) {
    return this.leave.balances(user, q.year, requireEmployee(user));
  }

  @Put('leave/balances')
  setBalance(@CurrentUser() user: AuthUser, @Body(new ZodPipe(leaveBalanceSetSchema)) body: z.output<typeof leaveBalanceSetSchema>) {
    return this.leave.setBalance(user, body);
  }

  @Post('leave/balances/allocate-year')
  allocateYear(@CurrentUser() user: AuthUser, @Body(new ZodPipe(leaveYearAllocateSchema)) body: z.output<typeof leaveYearAllocateSchema>) {
    return this.leave.allocateYear(user, body);
  }

  @Get('leave/my-calendar')
  myCalendar(@CurrentUser() user: AuthUser, @Query(new ZodPipe(yearQuery)) q: z.output<typeof yearQuery>) {
    return this.leave.myCalendar(user, q.year);
  }

  @Post('leave/requests')
  apply(@CurrentUser() user: AuthUser, @Body(new ZodPipe(leaveApplySchema)) body: z.output<typeof leaveApplySchema>) {
    return this.leave.apply(user, body);
  }

  @Get('leave/requests')
  requests(@CurrentUser() user: AuthUser, @Query(new ZodPipe(leaveList)) q: z.output<typeof leaveList>) {
    return this.leave.list(user, q);
  }

  @Post('leave/requests/:id/decision')
  decide(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(leaveDecisionSchema)) body: z.output<typeof leaveDecisionSchema>) {
    return this.leave.decide(user, id, body);
  }

  @Post('leave/requests/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.leave.cancel(user, id);
  }

  @Get('leave/calendar')
  calendar(@CurrentUser() user: AuthUser, @Query(new ZodPipe(monthOnly)) q: z.output<typeof monthOnly>) {
    const { year, month } = parseMonth(q.month);
    return this.leave.calendar(user, year, month);
  }

  // ───────────── Tasks ─────────────

  @Get('tasks')
  taskList(@CurrentUser() user: AuthUser, @Query(new ZodPipe(taskList)) q: z.output<typeof taskList>) {
    return this.tasks.list(user, q);
  }

  @Post('tasks')
  createTask(@CurrentUser() user: AuthUser, @Body(new ZodPipe(taskSchema)) body: z.output<typeof taskSchema>) {
    return this.tasks.create(user, body);
  }

  @Patch('tasks/:id')
  updateTask(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new PatchPipe(taskUpdateSchema)) body: Partial<z.output<typeof taskUpdateSchema>>) {
    return this.tasks.update(user, id, body);
  }
}
