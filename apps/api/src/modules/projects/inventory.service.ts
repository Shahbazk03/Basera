import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BOOKABLE_PROJECT_STATUSES, canTransitionUnit, toSqft, type UnitStatus } from '@estate/shared';
import type { z } from 'zod';
import type { projectBlockSchema, projectUnitSchema, projectUnitUpdateSchema, unitBulkCreateSchema } from '@estate/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit.service';
import { paginated, Pagination, skipTake } from '../../common/http';
import { ProjectsService } from './projects.service';

export interface UnitListQuery extends Pagination {
  status?: UnitStatus;
  blockId?: string;
  unitType?: string;
  q?: string;
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly projects: ProjectsService,
  ) {}

  private async project(user: AuthUser, projectId: string, manage = true) {
    const p = await this.projects.loadForAccess(user, projectId);
    if (manage) user.assert('project.inventory.manage', p.organizationId, 'You cannot manage inventory for this project');
    return p;
  }

  private async unit(user: AuthUser, unitId: string) {
    const unit = await this.prisma.projectUnit.findUnique({
      where: { id: unitId },
      include: { project: { select: { id: true, name: true, organizationId: true, developerOrgId: true, deletedAt: true, status: true, autoStatus: true, bookingOpensAt: true, bookingClosesAt: true, closingSoonHours: true } } },
    });
    if (!unit || unit.project.deletedAt || !this.projects.canView(user, unit.project)) throw new NotFoundException('Unit not found');
    user.assert('project.inventory.manage', unit.project.organizationId, 'You cannot manage inventory for this project');
    return unit;
  }

  private async afterInventoryChange(projectId: string, actorId: string, tx: Tx) {
    return this.projects.syncStatus(projectId, tx, actorId);
  }

  // ───────────────────────── Blocks ─────────────────────────

  async blocks(user: AuthUser, projectId: string) {
    await this.project(user, projectId, false);
    return this.prisma.projectBlock.findMany({ where: { projectId }, orderBy: { sortOrder: 'asc' }, include: { _count: { select: { units: true } } } });
  }

  async createBlock(user: AuthUser, projectId: string, input: z.output<typeof projectBlockSchema>) {
    const p = await this.project(user, projectId);
    if (await this.prisma.projectBlock.count({ where: { projectId, name: input.name } })) throw new ConflictException({ message: `A block named "${input.name}" already exists`, details: [{ path: 'name', message: 'Already exists' }] });
    const sortOrder = input.sortOrder ?? (await this.prisma.projectBlock.count({ where: { projectId } }));
    const block = await this.prisma.projectBlock.create({ data: { projectId, name: input.name, type: input.type, totalFloors: input.totalFloors ?? null, description: input.description ?? null, sortOrder } });
    await this.audit.log({ actorId: user.id, action: 'project.block.create', entityType: 'Project', entityId: projectId, organizationId: p.organizationId, after: block });
    return block;
  }

  async updateBlock(user: AuthUser, projectId: string, blockId: string, input: Partial<z.output<typeof projectBlockSchema>>) {
    const p = await this.project(user, projectId);
    const block = await this.prisma.projectBlock.findFirst({ where: { id: blockId, projectId } });
    if (!block) throw new NotFoundException('Block not found');
    if (input.name && input.name !== block.name && (await this.prisma.projectBlock.count({ where: { projectId, name: input.name } }))) {
      throw new ConflictException({ message: `A block named "${input.name}" already exists`, details: [{ path: 'name', message: 'Already exists' }] });
    }
    const updated = await this.prisma.projectBlock.update({ where: { id: blockId }, data: input });
    await this.audit.log({ actorId: user.id, action: 'project.block.update', entityType: 'Project', entityId: projectId, organizationId: p.organizationId, before: block, after: updated });
    return updated;
  }

  async deleteBlock(user: AuthUser, projectId: string, blockId: string) {
    const p = await this.project(user, projectId);
    const block = await this.prisma.projectBlock.findFirst({ where: { id: blockId, projectId }, include: { _count: { select: { units: true } } } });
    if (!block) throw new NotFoundException('Block not found');
    if (block._count.units) throw new ConflictException(`Move or delete the ${block._count.units} unit(s) in ${block.name} first`);
    await this.prisma.projectBlock.delete({ where: { id: blockId } });
    await this.audit.log({ actorId: user.id, action: 'project.block.delete', entityType: 'Project', entityId: projectId, organizationId: p.organizationId, before: block });
    return { ok: true };
  }

  // ───────────────────────── Units ─────────────────────────

  async listUnits(user: AuthUser, projectId: string, q: UnitListQuery) {
    await this.project(user, projectId, false);
    const where: Prisma.ProjectUnitWhereInput = {
      projectId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.blockId ? { blockId: q.blockId === 'none' ? null : q.blockId } : {}),
      ...(q.unitType ? { unitType: q.unitType as never } : {}),
      ...(q.q ? { OR: [{ code: { contains: q.q.toUpperCase() } }, { configuration: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total, counts] = await Promise.all([
      this.prisma.projectUnit.findMany({
        where,
        include: {
          block: { select: { id: true, name: true, sortOrder: true } },
          reservations: { where: { status: 'ACTIVE' }, select: { id: true, expiresAt: true, notes: true, lead: { select: { id: true, leadNo: true, name: true } }, reservedBy: { select: { fullName: true } } } },
        },
        orderBy: [{ block: { sortOrder: 'asc' } }, { code: 'asc' }],
        ...skipTake(q),
      }),
      this.prisma.projectUnit.count({ where }),
      this.prisma.projectUnit.groupBy({ by: ['status'], where: { ...where, status: undefined }, _count: { _all: true } }),
    ]);
    rows.sort((a, b) => (a.block?.sortOrder ?? 999) - (b.block?.sortOrder ?? 999) || collator.compare(a.code, b.code));
    return { ...paginated(rows, total, q), statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) };
  }

  private unitData(input: Partial<z.output<typeof projectUnitSchema>>, current?: { area: Prisma.Decimal; areaUnit: string; basePrice: Prisma.Decimal; additionalCharges: Prisma.Decimal }) {
    const out: Record<string, unknown> = { ...input };
    const area = input.area ?? (current ? current.area.toNumber() : undefined);
    const unit = (input.areaUnit ?? current?.areaUnit) as z.output<typeof projectUnitSchema>['areaUnit'] | undefined;
    if (area !== undefined && unit) out.areaSqft = toSqft(area, unit);
    const base = input.basePrice ?? current?.basePrice.toNumber();
    const extra = input.additionalCharges ?? current?.additionalCharges.toNumber() ?? 0;
    if (base !== undefined) out.totalPrice = Math.round((base + extra) * 100) / 100;
    return out;
  }

  private async assertBlock(projectId: string, blockId: string | null | undefined) {
    if (!blockId) return;
    if (!(await this.prisma.projectBlock.count({ where: { id: blockId, projectId } }))) throw new BadRequestException({ message: 'Select a block of this project', details: [{ path: 'blockId', message: 'Invalid block' }] });
  }

  async createUnit(user: AuthUser, projectId: string, input: z.output<typeof projectUnitSchema>) {
    const p = await this.project(user, projectId);
    await this.assertBlock(projectId, input.blockId);
    const status = input.status ?? 'AVAILABLE';
    if (!['AVAILABLE', 'NOT_RELEASED', 'BLOCKED'].includes(status)) throw new BadRequestException({ message: 'New units start as available, not released or blocked', details: [{ path: 'status', message: 'Invalid initial status' }] });
    if (await this.prisma.projectUnit.count({ where: { projectId, code: input.code } })) throw new ConflictException({ message: `Unit ${input.code} already exists in this project`, details: [{ path: 'code', message: 'Already exists' }] });
    let change = null;
    const unit = await this.prisma.$transaction(async (tx) => {
      const created = await tx.projectUnit.create({
        data: { ...(this.unitData(input) as Prisma.ProjectUnitUncheckedCreateInput), projectId, status, additionalCharges: input.additionalCharges ?? 0, blockId: input.blockId ?? null },
      });
      await tx.unitStatusHistory.create({ data: { unitId: created.id, fromStatus: null, toStatus: status, changedById: user.id, reason: 'Unit created', priceAfter: created.totalPrice } });
      await this.audit.log({ actorId: user.id, action: 'project.unit.create', entityType: 'ProjectUnit', entityId: created.id, organizationId: p.organizationId, after: { code: created.code, totalPrice: created.totalPrice, status } }, tx);
      change = await this.afterInventoryChange(projectId, user.id, tx);
      return created;
    });
    if (change) await this.projects.notifyStatusChange(projectId, (change as { to: never }).to);
    return unit;
  }

  async bulkCreate(user: AuthUser, projectId: string, input: z.output<typeof unitBulkCreateSchema>) {
    const p = await this.project(user, projectId);
    await this.assertBlock(projectId, input.blockId);
    const last = input.startNumber + input.count - 1;
    const width = Math.max(2, String(last).length);
    const codes = Array.from({ length: input.count }, (_, i) => `${input.prefix}${String(input.startNumber + i).padStart(width, '0')}`);
    const clash = await this.prisma.projectUnit.findMany({ where: { projectId, code: { in: codes } }, select: { code: true } });
    if (clash.length) {
      throw new ConflictException({ message: `These unit codes already exist: ${clash.slice(0, 10).map((c) => c.code).join(', ')}${clash.length > 10 ? '…' : ''}`, code: 'DUPLICATE_UNITS' });
    }
    const areaSqft = toSqft(input.area, input.areaUnit);
    const additional = input.additionalCharges ?? 0;
    const total = Math.round((input.basePrice + additional) * 100) / 100;
    let change = null;
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.projectUnit.createMany({
        data: codes.map((code) => ({
          projectId,
          blockId: input.blockId ?? null,
          code,
          unitType: input.unitType,
          floorNumber: input.floorNumber ?? null,
          configuration: input.configuration ?? null,
          bedrooms: input.bedrooms ?? null,
          area: input.area,
          areaUnit: input.areaUnit,
          areaSqft,
          basePrice: input.basePrice,
          additionalCharges: additional,
          totalPrice: total,
          status: input.status,
        })),
      });
      const units = await tx.projectUnit.findMany({ where: { projectId, code: { in: codes } }, select: { id: true } });
      await tx.unitStatusHistory.createMany({ data: units.map((u) => ({ unitId: u.id, fromStatus: null, toStatus: input.status, changedById: user.id, reason: 'Created in bulk', priceAfter: total })) });
      await this.audit.log({ actorId: user.id, action: 'project.unit.bulk_create', entityType: 'Project', entityId: projectId, organizationId: p.organizationId, metadata: { count: codes.length, from: codes[0], to: codes[codes.length - 1] } }, tx);
      change = await this.afterInventoryChange(projectId, user.id, tx);
      return units.length;
    });
    if (change) await this.projects.notifyStatusChange(projectId, (change as { to: never }).to);
    return { created, codes };
  }

  async updateUnit(user: AuthUser, unitId: string, input: z.output<typeof projectUnitUpdateSchema> & { expectedVersion?: number }) {
    const unit = await this.unit(user, unitId);
    const { expectedVersion, ...changes } = input;
    await this.assertBlock(unit.projectId, changes.blockId);
    const priceChange = changes.basePrice !== undefined || changes.additionalCharges !== undefined;
    if (priceChange && ['BOOKED', 'SOLD'].includes(unit.status)) throw new ConflictException({ message: 'Prices of booked or sold units cannot be changed', code: 'UNIT_LOCKED' });
    if (changes.code && changes.code !== unit.code && (await this.prisma.projectUnit.count({ where: { projectId: unit.projectId, code: changes.code } }))) {
      throw new ConflictException({ message: `Unit ${changes.code} already exists`, details: [{ path: 'code', message: 'Already exists' }] });
    }
    const data = this.unitData(changes, unit);
    return this.prisma.$transaction(async (tx) => {
      const res = await tx.projectUnit.updateMany({ where: { id: unitId, version: expectedVersion ?? unit.version }, data: { ...(data as Prisma.ProjectUnitUncheckedUpdateManyInput), version: { increment: 1 } } });
      if (!res.count) throw new ConflictException({ message: 'This unit was changed by someone else. Refresh and try again.', code: 'CONCURRENT_UPDATE' });
      const updated = await tx.projectUnit.findUniqueOrThrow({ where: { id: unitId } });
      if (priceChange && !updated.totalPrice.equals(unit.totalPrice)) {
        await tx.unitStatusHistory.create({ data: { unitId, fromStatus: unit.status, toStatus: unit.status, changedById: user.id, reason: 'Price updated', priceBefore: unit.totalPrice, priceAfter: updated.totalPrice } });
      }
      await this.audit.log({ actorId: user.id, action: 'project.unit.update', entityType: 'ProjectUnit', entityId: unitId, organizationId: unit.project.organizationId, before: { code: unit.code, totalPrice: unit.totalPrice }, after: changes }, tx);
      return updated;
    });
  }

  async deleteUnit(user: AuthUser, unitId: string) {
    const unit = await this.unit(user, unitId);
    if (!['AVAILABLE', 'NOT_RELEASED', 'BLOCKED'].includes(unit.status)) throw new ConflictException('Only available, unreleased or blocked units can be deleted');
    const refs = await this.prisma.projectUnit.findUniqueOrThrow({ where: { id: unitId }, select: { _count: { select: { deals: true, reservations: true, enquiries: true, leads: true, siteVisits: true } } } });
    const used = Object.entries(refs._count).filter(([, n]) => n > 0).map(([k]) => k);
    if (used.length) throw new ConflictException(`This unit is referenced by ${used.join(', ')} — mark it blocked instead of deleting it`);
    let change = null;
    await this.prisma.$transaction(async (tx) => {
      await tx.projectUnit.delete({ where: { id: unitId } });
      await this.audit.log({ actorId: user.id, action: 'project.unit.delete', entityType: 'ProjectUnit', entityId: unitId, organizationId: unit.project.organizationId, before: { code: unit.code } }, tx);
      change = await this.afterInventoryChange(unit.projectId, user.id, tx);
    });
    if (change) await this.projects.notifyStatusChange(unit.projectId, (change as { to: never }).to);
    return { ok: true };
  }

  /**
   * Validated status change with optimistic concurrency: the row only changes if it still has the
   * status and version we read. RESERVED is set through reserve() so it is tied to a reservation.
   */
  async changeStatus(user: AuthUser, unitId: string, input: { status: UnitStatus; reason?: string; expectedVersion?: number; holdHours?: number }) {
    const unit = await this.unit(user, unitId);
    const to = input.status;
    if (to === unit.status) throw new ConflictException(`Unit ${unit.code} is already ${to.replace(/_/g, ' ').toLowerCase()}`);
    if (to === 'RESERVED') throw new BadRequestException({ message: 'Use “Reserve” to hold a unit for a customer', code: 'USE_RESERVE' });
    if (!canTransitionUnit(unit.status, to)) {
      throw new ConflictException({ message: `A ${unit.status.replace(/_/g, ' ').toLowerCase()} unit cannot become ${to.replace(/_/g, ' ').toLowerCase()}`, code: 'INVALID_TRANSITION' });
    }
    const holdExpiresAt = to === 'ON_HOLD' && input.holdHours ? new Date(Date.now() + input.holdHours * 3_600_000) : null;
    let change = null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.projectUnit.updateMany({
        where: { id: unitId, status: unit.status, version: input.expectedVersion ?? unit.version },
        data: { status: to, holdExpiresAt, version: { increment: 1 } },
      });
      if (!res.count) throw new ConflictException({ message: `Unit ${unit.code} was changed by someone else. Refresh and try again.`, code: 'CONCURRENT_UPDATE' });
      if (unit.status === 'RESERVED') {
        await tx.unitReservation.updateMany({ where: { unitId, status: 'ACTIVE' }, data: { status: to === 'BOOKED' ? 'CONVERTED' : 'RELEASED' } });
      }
      await tx.unitStatusHistory.create({ data: { unitId, fromStatus: unit.status, toStatus: to, changedById: user.id, reason: input.reason?.trim() || null } });
      await this.audit.log({ actorId: user.id, action: 'project.unit.status', entityType: 'ProjectUnit', entityId: unitId, organizationId: unit.project.organizationId, before: { status: unit.status }, after: { status: to }, metadata: input.reason ? { reason: input.reason } : undefined }, tx);
      change = await this.afterInventoryChange(unit.projectId, user.id, tx);
      return tx.projectUnit.findUniqueOrThrow({ where: { id: unitId } });
    });
    if (change) await this.projects.notifyStatusChange(unit.projectId, (change as { to: never }).to);
    return updated;
  }

  /** Atomically reserves an available (or held) unit; concurrent attempts cannot both succeed. */
  async reserve(user: AuthUser, unitId: string, input: { leadId?: string | null; expiresInHours: number; notes?: string; expectedVersion?: number }) {
    const unit = await this.unit(user, unitId);
    const effective = await this.projects.effectiveStatus(this.prisma, unit.project);
    if (!BOOKABLE_PROJECT_STATUSES.includes(effective)) {
      throw new ConflictException({ message: `Reservations open when booking is open — the project is ${effective.replace(/_/g, ' ').toLowerCase()}`, code: 'PROJECT_NOT_BOOKABLE' });
    }
    let customerId: string | null = null;
    if (input.leadId) {
      const lead = await this.prisma.lead.findFirst({ where: { id: input.leadId, deletedAt: null }, select: { id: true, organizationId: true, customerId: true } });
      if (!lead || lead.organizationId !== unit.project.organizationId) throw new BadRequestException({ message: 'Select a lead that belongs to this project’s organisation', details: [{ path: 'leadId', message: 'Invalid lead' }] });
      customerId = lead.customerId;
    }
    const expiresAt = new Date(Date.now() + input.expiresInHours * 3_600_000);
    let change = null;
    const result = await this.prisma.$transaction(async (tx) => {
      // The UPDATE re-checks the row after acquiring its lock, so only one concurrent request can match.
      const res = await tx.projectUnit.updateMany({
        where: { id: unitId, status: { in: ['AVAILABLE', 'ON_HOLD'] }, ...(input.expectedVersion !== undefined ? { version: input.expectedVersion } : {}) },
        data: { status: 'RESERVED', holdExpiresAt: null, version: { increment: 1 } },
      });
      if (!res.count) throw new ConflictException({ message: `Unit ${unit.code} is no longer available`, code: 'UNIT_UNAVAILABLE' });
      const current = await tx.projectUnit.findUniqueOrThrow({ where: { id: unitId } });
      const reservation = await tx.unitReservation.create({ data: { unitId, leadId: input.leadId ?? null, customerId, status: 'ACTIVE', expiresAt, notes: input.notes?.trim() || null, reservedById: user.id } });
      await tx.unitStatusHistory.create({ data: { unitId, fromStatus: unit.status, toStatus: 'RESERVED', leadId: input.leadId ?? null, changedById: user.id, reason: input.notes?.trim() || `Reserved until ${expiresAt.toISOString()}` } });
      if (input.leadId) {
        await tx.leadActivity.create({ data: { leadId: input.leadId, type: 'SYSTEM', summary: `Unit ${unit.code} reserved`, details: `Reservation expires ${expiresAt.toISOString()}`, performedById: user.id } });
      }
      await this.audit.log({ actorId: user.id, action: 'project.unit.reserve', entityType: 'ProjectUnit', entityId: unitId, organizationId: unit.project.organizationId, after: { reservationId: reservation.id, leadId: input.leadId ?? null, expiresAt } }, tx);
      change = await this.afterInventoryChange(unit.projectId, user.id, tx);
      return { unit: current, reservation };
    });
    if (change) await this.projects.notifyStatusChange(unit.projectId, (change as { to: never }).to);
    return result;
  }

  async release(user: AuthUser, unitId: string, reason?: string) {
    const unit = await this.unit(user, unitId);
    if (unit.status !== 'RESERVED') throw new ConflictException(`Unit ${unit.code} is not reserved`);
    let change = null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.projectUnit.updateMany({ where: { id: unitId, status: 'RESERVED' }, data: { status: 'AVAILABLE', version: { increment: 1 } } });
      if (!res.count) throw new ConflictException({ message: 'The unit was changed by someone else. Refresh and try again.', code: 'CONCURRENT_UPDATE' });
      await tx.unitReservation.updateMany({ where: { unitId, status: 'ACTIVE' }, data: { status: 'RELEASED' } });
      await tx.unitStatusHistory.create({ data: { unitId, fromStatus: 'RESERVED', toStatus: 'AVAILABLE', changedById: user.id, reason: reason?.trim() || 'Reservation released' } });
      await this.audit.log({ actorId: user.id, action: 'project.unit.release', entityType: 'ProjectUnit', entityId: unitId, organizationId: unit.project.organizationId, metadata: reason ? { reason } : undefined }, tx);
      change = await this.afterInventoryChange(unit.projectId, user.id, tx);
      return tx.projectUnit.findUniqueOrThrow({ where: { id: unitId } });
    });
    if (change) await this.projects.notifyStatusChange(unit.projectId, (change as { to: never }).to);
    return updated;
  }

  async history(user: AuthUser, unitId: string) {
    const unit = await this.unit(user, unitId);
    const [history, reservations] = await Promise.all([
      this.prisma.unitStatusHistory.findMany({ where: { unitId }, orderBy: { createdAt: 'desc' }, include: { changedBy: { select: { fullName: true } } } }),
      this.prisma.unitReservation.findMany({ where: { unitId }, orderBy: { createdAt: 'desc' }, include: { lead: { select: { id: true, leadNo: true, name: true } }, reservedBy: { select: { fullName: true } } } }),
    ]);
    return { unit, history, reservations };
  }

  async summary(user: AuthUser, projectId: string) {
    await this.project(user, projectId, false);
    const rows = await this.prisma.projectUnit.groupBy({ by: ['status'], where: { projectId }, _count: { _all: true }, _sum: { totalPrice: true } });
    return rows.map((r) => ({ status: r.status, count: r._count._all, value: r._sum.totalPrice }));
  }

  // ───────────────────────── Scheduled expiry ─────────────────────────

  /** Releases lapsed holds and reservations. Returns affected project ids. */
  async expireHolds(tx: Tx, now = new Date()): Promise<string[]> {
    const affected = new Set<string>();
    const holds = await tx.projectUnit.findMany({ where: { status: 'ON_HOLD', holdExpiresAt: { lt: now } }, select: { id: true, projectId: true } });
    for (const u of holds) {
      const res = await tx.projectUnit.updateMany({ where: { id: u.id, status: 'ON_HOLD' }, data: { status: 'AVAILABLE', holdExpiresAt: null, version: { increment: 1 } } });
      if (res.count) {
        await tx.unitStatusHistory.create({ data: { unitId: u.id, fromStatus: 'ON_HOLD', toStatus: 'AVAILABLE', changedById: null, reason: 'Hold expired' } });
        affected.add(u.projectId);
      }
    }
    const reservations = await tx.unitReservation.findMany({ where: { status: 'ACTIVE', expiresAt: { lt: now } }, select: { id: true, unitId: true, unit: { select: { projectId: true } } } });
    for (const r of reservations) {
      await tx.unitReservation.update({ where: { id: r.id }, data: { status: 'EXPIRED' } });
      const res = await tx.projectUnit.updateMany({ where: { id: r.unitId, status: 'RESERVED' }, data: { status: 'AVAILABLE', version: { increment: 1 } } });
      if (res.count) {
        await tx.unitStatusHistory.create({ data: { unitId: r.unitId, fromStatus: 'RESERVED', toStatus: 'AVAILABLE', changedById: null, reason: 'Reservation expired' } });
        affected.add(r.unit.projectId);
      }
    }
    return [...affected];
  }
}
