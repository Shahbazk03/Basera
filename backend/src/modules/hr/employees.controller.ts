import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  departmentSchema,
  designationSchema,
  EMPLOYMENT_STATUSES,
  employeeCreateSchema,
  employeeDocumentSchema,
  employeeExitSchema,
  employeeSensitiveSchema,
  employeeUpdateSchema,
} from '@estate/shared';
import { AuthUser } from '../../common/auth/auth-user';
import { ApiZodBody, CurrentUser, ReqMeta, RequestMeta } from '../../common/decorators';
import { conflict, notFound, paginationSchema } from '../../common/http';
import { UuidParam, ZodPipe } from '../../common/zod.pipe';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmployeesService } from './employees.service';
import { assertHr, PatchPipe, platformOrg } from './hr.util';

const listQuery = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  departmentId: z.uuid().optional(),
  designationId: z.uuid().optional(),
  managerId: z.uuid().optional(),
  status: z.enum(EMPLOYMENT_STATUSES).optional(),
});

@ApiTags('HR — employees')
@Controller({ path: 'hr', version: '1' })
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('employees')
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listQuery)) q: z.output<typeof listQuery>) {
    return this.employees.list(user, q);
  }

  @Get('employees/options')
  options(@CurrentUser() user: AuthUser) {
    return this.employees.options(user);
  }

  @Get('employees/assignable-roles')
  assignableRoles(@CurrentUser() user: AuthUser) {
    return this.employees.assignableRoles(user);
  }

  @Get('employees/:id')
  detail(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.employees.detail(user, id);
  }

  @Post('employees')
  @ApiZodBody(employeeCreateSchema)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(employeeCreateSchema)) body: z.output<typeof employeeCreateSchema>, @ReqMeta() meta: RequestMeta) {
    return this.employees.create(user, body, meta.ip);
  }

  @Patch('employees/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new PatchPipe(employeeUpdateSchema)) body: Partial<z.output<typeof employeeUpdateSchema>>) {
    return this.employees.update(user, id, body);
  }

  @Post('employees/:id/exit')
  exit(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(employeeExitSchema)) body: z.output<typeof employeeExitSchema>) {
    return this.employees.exit(user, id, body);
  }

  @Put('employees/:id/sensitive')
  setSensitive(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(employeeSensitiveSchema)) body: z.output<typeof employeeSensitiveSchema>) {
    return this.employees.setSensitive(user, id, body);
  }

  @Post('employees/:id/sensitive/reveal')
  reveal(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @ReqMeta() meta: RequestMeta) {
    return this.employees.revealSensitive(user, id, meta.ip);
  }

  @Post('employees/:id/documents')
  addDocument(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(employeeDocumentSchema)) body: z.output<typeof employeeDocumentSchema>) {
    return this.employees.addDocument(user, id, body);
  }

  @Delete('employees/:id/documents/:docId')
  removeDocument(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Param('docId', UuidParam) docId: string) {
    return this.employees.removeDocument(user, id, docId);
  }

  @Get('org-chart')
  orgChart(@CurrentUser() user: AuthUser) {
    return this.employees.orgChart(user);
  }

  // ───────────── Departments ─────────────

  @Get('departments')
  async departments(@CurrentUser() user: AuthUser) {
    const org = platformOrg(user);
    assertHr(user, 'employee.view', 'employee.manage', 'attendance.manage', 'leave.manage', 'payroll.view');
    const rows = await this.prisma.department.findMany({
      where: { organizationId: org },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { parent: { select: { id: true, name: true } }, _count: { select: { employees: { where: { deletedAt: null, employmentStatus: { not: 'EXITED' } } }, designations: true } } },
    });
    const headIds = rows.map((r) => r.headEmployeeId).filter((v): v is string => Boolean(v));
    const heads = await this.prisma.employee.findMany({ where: { id: { in: headIds } }, select: { id: true, user: { select: { fullName: true } } } });
    const headName = new Map(heads.map((h) => [h.id, h.user.fullName]));
    return rows.map((r) => ({ ...r, headName: r.headEmployeeId ? (headName.get(r.headEmployeeId) ?? null) : null }));
  }

  @Post('departments')
  async createDepartment(@CurrentUser() user: AuthUser, @Body(new ZodPipe(departmentSchema)) body: z.output<typeof departmentSchema>) {
    const org = platformOrg(user);
    assertHr(user, 'employee.manage');
    if (await this.prisma.department.findFirst({ where: { organizationId: org, code: body.code } })) conflict(`Department code ${body.code} already exists`);
    await this.checkDepartmentRefs(org, body.parentId ?? null, body.headEmployeeId ?? null, null);
    const row = await this.prisma.department.create({ data: { organizationId: org, name: body.name, code: body.code, description: body.description ?? null, parentId: body.parentId ?? null, headEmployeeId: body.headEmployeeId ?? null, isActive: body.isActive ?? true } });
    await this.audit.log({ actorId: user.id, action: 'hr.department.create', entityType: 'Department', entityId: row.id, organizationId: org, after: row });
    return row;
  }

  @Patch('departments/:id')
  async updateDepartment(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new PatchPipe(departmentSchema)) body: Partial<z.output<typeof departmentSchema>>) {
    const org = platformOrg(user);
    assertHr(user, 'employee.manage');
    const before = await this.prisma.department.findFirst({ where: { id, organizationId: org } });
    if (!before) notFound('Department');
    if (body.code && body.code !== before.code && (await this.prisma.department.findFirst({ where: { organizationId: org, code: body.code } }))) conflict(`Department code ${body.code} already exists`);
    await this.checkDepartmentRefs(org, body.parentId ?? null, body.headEmployeeId ?? null, id);
    const row = await this.prisma.department.update({ where: { id }, data: body });
    await this.audit.log({ actorId: user.id, action: 'hr.department.update', entityType: 'Department', entityId: id, organizationId: org, before, after: row });
    return row;
  }

  private async checkDepartmentRefs(org: string, parentId: string | null, headId: string | null, selfId: string | null) {
    if (parentId) {
      if (parentId === selfId) conflict('A department cannot be its own parent');
      let cursor: string | null = parentId;
      for (let i = 0; cursor && i < 50; i += 1) {
        const p: { id: string; parentId: string | null; organizationId: string } | null = await this.prisma.department.findUnique({ where: { id: cursor }, select: { id: true, parentId: true, organizationId: true } });
        if (!p || p.organizationId !== org) notFound('Parent department');
        if (selfId && p.parentId === selfId) conflict('This would create a department loop');
        cursor = p.parentId;
      }
    }
    if (headId && !(await this.prisma.employee.findFirst({ where: { id: headId, organizationId: org, deletedAt: null } }))) notFound('Head employee');
  }

  // ───────────── Designations ─────────────

  @Get('designations')
  async designations(@CurrentUser() user: AuthUser) {
    const org = platformOrg(user);
    assertHr(user, 'employee.view', 'employee.manage', 'payroll.view');
    return this.prisma.designation.findMany({
      where: { organizationId: org },
      orderBy: [{ isActive: 'desc' }, { level: 'desc' }, { name: 'asc' }],
      include: { department: { select: { id: true, name: true } }, _count: { select: { employees: { where: { deletedAt: null, employmentStatus: { not: 'EXITED' } } } } } },
    });
  }

  @Post('designations')
  async createDesignation(@CurrentUser() user: AuthUser, @Body(new ZodPipe(designationSchema)) body: z.output<typeof designationSchema>) {
    const org = platformOrg(user);
    assertHr(user, 'employee.manage');
    if (await this.prisma.designation.findFirst({ where: { organizationId: org, name: body.name } })) conflict('A designation with this name already exists');
    if (body.departmentId && !(await this.prisma.department.findFirst({ where: { id: body.departmentId, organizationId: org } }))) notFound('Department');
    const row = await this.prisma.designation.create({ data: { organizationId: org, name: body.name, level: body.level, departmentId: body.departmentId ?? null, isActive: body.isActive ?? true } });
    await this.audit.log({ actorId: user.id, action: 'hr.designation.create', entityType: 'Designation', entityId: row.id, organizationId: org, after: row });
    return row;
  }

  @Patch('designations/:id')
  async updateDesignation(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new PatchPipe(designationSchema)) body: Partial<z.output<typeof designationSchema>>) {
    const org = platformOrg(user);
    assertHr(user, 'employee.manage');
    const before = await this.prisma.designation.findFirst({ where: { id, organizationId: org } });
    if (!before) notFound('Designation');
    if (body.name && body.name !== before.name && (await this.prisma.designation.findFirst({ where: { organizationId: org, name: body.name } }))) conflict('A designation with this name already exists');
    if (body.departmentId && !(await this.prisma.department.findFirst({ where: { id: body.departmentId, organizationId: org } }))) notFound('Department');
    const row = await this.prisma.designation.update({ where: { id }, data: body });
    await this.audit.log({ actorId: user.id, action: 'hr.designation.update', entityType: 'Designation', entityId: id, organizationId: org, before, after: row });
    return row;
  }
}
