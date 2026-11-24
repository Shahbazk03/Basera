import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import type { taskSchema, taskUpdateSchema } from '@estate/shared';
import { Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit.service';
import { paginated, Pagination, skipTake } from '../../common/http';
import { canHr, platformOrg } from './hr.util';
import { segmentedPage, type Segment } from '../../common/ordering';

export interface TaskListQuery extends Pagination {
  scope: 'mine' | 'all';
  status?: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  assignedToId?: string;
  q?: string;
}

const taskInclude = {
  assignedTo: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
  lead: { select: { id: true, leadNo: true, name: true } },
} satisfies Prisma.EmployeeTaskInclude;

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, q: TaskListQuery) {
    const org = platformOrg(user);
    let where: Prisma.EmployeeTaskWhereInput = { organizationId: org };
    if (q.scope === 'mine') where = { ...where, assignedToId: user.id };
    else if (!canHr(user, 'task.manage')) throw new ForbiddenException();
    if (q.status) where = { ...where, status: q.status };
    else if (q.scope === 'mine') where = { ...where, status: { in: ['TODO', 'IN_PROGRESS', 'DONE'] } };
    if (q.assignedToId) where = { ...where, assignedToId: q.assignedToId };
    if (q.q) where = { ...where, title: { contains: q.q, mode: 'insensitive' } };
    type TaskSegment = Segment<Prisma.EmployeeTaskWhereInput, Prisma.EmployeeTaskOrderByWithRelationInput[]>;
    const segments = Object.values(TaskStatus).flatMap((status): TaskSegment[] => [
      { where: { AND: [where, { status }, { dueAt: { not: null } }] }, orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }] },
      { where: { AND: [where, { status }, { dueAt: null }] }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] },
    ]);
    const [{ rows, total }, counts] = await Promise.all([
      segmentedPage(segments, { count: (w) => this.prisma.employeeTask.count({ where: w }), find: (a) => this.prisma.employeeTask.findMany({ ...a, include: taskInclude }) }, skipTake(q)),
      this.prisma.employeeTask.groupBy({ by: ['status'], where: { ...where, status: undefined }, _count: { _all: true } }),
    ]);
    const now = Date.now();
    return {
      ...paginated(
        rows.map((t) => ({ ...t, overdue: Boolean(t.dueAt && t.dueAt.getTime() < now && (t.status === 'TODO' || t.status === 'IN_PROGRESS')), canEdit: canHr(user, 'task.manage'), canUpdateStatus: t.assignedToId === user.id || canHr(user, 'task.manage') })),
        total,
        q,
      ),
      statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    };
  }

  private async validateRefs(org: string, assignedToId?: string, leadId?: string | null) {
    if (assignedToId) {
      const member = await this.prisma.employee.findFirst({ where: { userId: assignedToId, organizationId: org, deletedAt: null, employmentStatus: { not: 'EXITED' } } });
      if (!member) throw new BadRequestException({ message: 'Tasks can only be assigned to active employees', details: [{ path: 'assignedToId', message: 'Not an active employee' }] });
    }
    if (leadId && !(await this.prisma.lead.findFirst({ where: { id: leadId, organizationId: org, deletedAt: null } }))) {
      throw new BadRequestException({ message: 'Linked lead not found', details: [{ path: 'leadId', message: 'Unknown lead' }] });
    }
  }

  async create(user: AuthUser, input: z.output<typeof taskSchema>) {
    const org = platformOrg(user);
    if (!canHr(user, 'task.manage')) throw new ForbiddenException();
    await this.validateRefs(org, input.assignedToId, input.leadId);
    const row = await this.prisma.employeeTask.create({
      data: { organizationId: org, title: input.title, description: input.description ?? null, assignedToId: input.assignedToId, createdById: user.id, leadId: input.leadId ?? null, dueAt: input.dueAt ? new Date(input.dueAt) : null, priority: input.priority },
      include: taskInclude,
    });
    await this.audit.log({ actorId: user.id, action: 'task.create', entityType: 'EmployeeTask', entityId: row.id, organizationId: org, after: { title: row.title, assignedToId: row.assignedToId } });
    return row;
  }

  async update(user: AuthUser, id: string, patch: Partial<z.output<typeof taskUpdateSchema>>) {
    const org = platformOrg(user);
    const task = await this.prisma.employeeTask.findFirst({ where: { id, organizationId: org } });
    if (!task) throw new NotFoundException('Task not found');
    const manage = canHr(user, 'task.manage');
    const isAssignee = task.assignedToId === user.id;
    if (!manage) {
      if (!isAssignee) throw new NotFoundException('Task not found');
      const keys = Object.keys(patch);
      if (keys.some((k) => k !== 'status')) throw new ForbiddenException('You can only update the status of tasks assigned to you');
    }
    await this.validateRefs(org, patch.assignedToId, patch.leadId);
    const data: Prisma.EmployeeTaskUncheckedUpdateInput = {};
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'dueAt') data.dueAt = v ? new Date(v as string) : null;
      else (data as Record<string, unknown>)[k] = v ?? null;
    }
    if (patch.status === 'DONE' && task.status !== 'DONE') data.completedAt = new Date();
    if (patch.status && patch.status !== 'DONE') data.completedAt = null;
    const row = await this.prisma.employeeTask.update({ where: { id }, data, include: taskInclude });
    await this.audit.log({ actorId: user.id, action: 'task.update', entityType: 'EmployeeTask', entityId: id, organizationId: org, before: { status: task.status, assignedToId: task.assignedToId }, after: patch });
    return row;
  }
}
