import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { HrOpsController } from './hr-ops.controller';
import { LeaveService } from './leave.service';
import { TasksService } from './tasks.service';

@Module({
  controllers: [EmployeesController, HrOpsController],
  providers: [EmployeesService, AttendanceService, LeaveService, TasksService],
  exports: [EmployeesService, AttendanceService, LeaveService],
})
export class HrModule {}
