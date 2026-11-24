import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  activityCreateSchema,
  assignmentRuleSchema,
  campaignSchema,
  campaignUpdateSchema,
  customerPreferenceSchema,
  customerUpdateSchema,
  DEAL_STATUSES,
  dealCreateSchema,
  dealPaymentSchema,
  dealStatusSchema,
  followUpCompleteSchema,
  followUpCreateSchema,
  followUpRescheduleSchema,
  LEAD_PRIORITIES,
  LEAD_STATUSES,
  leadAssignSchema,
  leadBulkAssignSchema,
  leadCreateSchema,
  leadImportSchema,
  leadSourceSchema,
  leadStatusChangeSchema,
  leadUpdateSchema,
  localDateString,
  routingTestSchema,
  rulesReorderSchema,
  salesTeamMemberSchema,
  salesTeamSchema,
  SITE_VISIT_STATUSES,
  siteVisitCreateSchema,
  siteVisitUpdateSchema,
} from '@estate/shared';
import { AuthUser } from '../../common/auth/auth-user';
import { ApiZodBody, ApiZodQuery, CurrentUser, RequirePermissions } from '../../common/decorators';
import { paginationSchema } from '../../common/http';
import { PatchPipe, UuidParam, ZodPipe } from '../../common/zod.pipe';
import { CrmConfigService } from './crm-config.service';
import { DealsService } from './deals.service';
import { FollowUpsScheduler } from './followups.scheduler';
import { LeadsService } from './leads.service';
import { SiteVisitsService } from './site-visits.service';

const date = z.iso.date();
const leadFilters = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  priority: z.enum(LEAD_PRIORITIES).optional(),
  source: z.string().max(40).optional(),
  assignee: z.union([z.uuid(), z.literal('me'), z.literal('unassigned')]).optional(),
  projectId: z.uuid().optional(),
  propertyId: z.uuid().optional(),
  campaignId: z.uuid().optional(),
  organizationId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  from: date.optional(),
  to: date.optional(),
  followUp: z.enum(['today', 'overdue']).optional(),
  intake: z.enum(['accepted', 'all', 'duplicates']).optional(),
  sort: z.enum(['newest', 'oldest', 'followup', 'priority', 'updated']).optional(),
});
const leadListQuery = paginationSchema.extend(leadFilters.shape);

@ApiTags('CRM — leads')
@Controller({ path: 'crm/leads', version: '1' })
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @ApiZodQuery(leadListQuery)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(leadListQuery)) q: z.output<typeof leadListQuery>) {
    if (!user.can('lead.view_all') && !user.can('lead.view_assigned')) throw new ForbiddenException('You do not have access to leads');
    return this.leads.list(user, q);
  }

  @Get('export')
  @RequirePermissions('lead.export')
  async export(@CurrentUser() user: AuthUser, @Query(new ZodPipe(leadFilters)) q: z.output<typeof leadFilters>, @Res() res: Response) {
    const { csv } = await this.leads.exportCsv(user, q);
    const stamp = localDateString(new Date());
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${stamp}.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(`﻿${csv}`);
  }

  @Post()
  @RequirePermissions('lead.create')
  @ApiZodBody(leadCreateSchema)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(leadCreateSchema)) body: z.output<typeof leadCreateSchema>) {
    return this.leads.create(user, body);
  }

  @Post('import')
  @RequirePermissions('lead.import')
  @ApiZodBody(leadImportSchema)
  import(@CurrentUser() user: AuthUser, @Body(new ZodPipe(leadImportSchema)) body: z.output<typeof leadImportSchema>) {
    return this.leads.importLeads(user, body);
  }

  @Post('bulk-assign')
  @RequirePermissions('lead.assign')
  @ApiZodBody(leadBulkAssignSchema)
  bulkAssign(@CurrentUser() user: AuthUser, @Body(new ZodPipe(leadBulkAssignSchema)) body: z.output<typeof leadBulkAssignSchema>) {
    return this.leads.bulkAssign(user, body.leadIds, { userId: body.userId, auto: body.auto });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.leads.detail(user, id);
  }

  @Patch(':id')
  @RequirePermissions('lead.edit')
  @ApiZodBody(leadUpdateSchema)
  update(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(leadUpdateSchema)) body: z.output<typeof leadUpdateSchema>) {
    return this.leads.update(user, id, body);
  }

  @Post(':id/status')
  @RequirePermissions('lead.edit')
  @ApiZodBody(leadStatusChangeSchema)
  status(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(leadStatusChangeSchema)) body: z.output<typeof leadStatusChangeSchema>) {
    return this.leads.changeStatus(user, id, body.status, body.note, body.lostReason);
  }

  @Post(':id/assign')
  @RequirePermissions('lead.assign')
  @ApiZodBody(leadAssignSchema)
  assign(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(leadAssignSchema)) body: z.output<typeof leadAssignSchema>) {
    return this.leads.assign(user, id, body.userId, body.reason);
  }

  @Post(':id/activities')
  @RequirePermissions('lead.edit')
  @ApiZodBody(activityCreateSchema)
  activity(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(activityCreateSchema)) body: z.output<typeof activityCreateSchema>) {
    return this.leads.logActivity(user, id, body);
  }

  @Post(':id/follow-ups')
  @RequirePermissions('lead.edit')
  @ApiZodBody(followUpCreateSchema)
  followUp(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(followUpCreateSchema)) body: z.output<typeof followUpCreateSchema>) {
    return this.leads.addFollowUp(user, id, body);
  }
}

const followUpQuery = paginationSchema.extend({ view: z.enum(['overdue', 'today', 'upcoming', 'done']).optional(), assignee: z.union([z.uuid(), z.literal('me')]).optional() });

@ApiTags('CRM — follow-ups')
@Controller({ path: 'crm/follow-ups', version: '1' })
export class FollowUpsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly scheduler: FollowUpsScheduler,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(followUpQuery)) q: z.output<typeof followUpQuery>) {
    if (!user.can('lead.view_all') && !user.can('lead.view_assigned')) throw new ForbiddenException('You do not have access to leads');
    return this.leads.followUps(user, q);
  }

  @Post(':id/complete')
  @RequirePermissions('lead.edit')
  complete(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(followUpCompleteSchema)) body: z.output<typeof followUpCompleteSchema>) {
    return this.leads.completeFollowUp(user, id, body);
  }

  @Post(':id/reschedule')
  @RequirePermissions('lead.edit')
  reschedule(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(followUpRescheduleSchema)) body: z.output<typeof followUpRescheduleSchema>) {
    return this.leads.rescheduleFollowUp(user, id, body.dueAt, body.notes);
  }

  /** Runs the reminder / missed-marking job now (operations tool; the job also runs every 5 minutes). */
  @Post('run-reminders')
  @RequirePermissions('assignment.manage')
  async runNow() {
    return (await this.scheduler.run()) ?? { skipped: 'Another instance is running the job' };
  }
}

const visitQuery = paginationSchema.extend({
  from: date.optional(),
  to: date.optional(),
  status: z.enum(SITE_VISIT_STATUSES).optional(),
  assignee: z.union([z.uuid(), z.literal('me')]).optional(),
  leadId: z.uuid().optional(),
});

@ApiTags('CRM — site visits')
@Controller({ path: 'crm/site-visits', version: '1' })
export class SiteVisitsController {
  constructor(private readonly visits: SiteVisitsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(visitQuery)) q: z.output<typeof visitQuery>) {
    if (!user.can('lead.view_all') && !user.can('lead.view_assigned')) throw new ForbiddenException('You do not have access to site visits');
    return this.visits.list(user, q);
  }

  @Post()
  @RequirePermissions('site_visit.manage')
  @ApiZodBody(siteVisitCreateSchema)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(siteVisitCreateSchema)) body: z.output<typeof siteVisitCreateSchema>) {
    return this.visits.create(user, body);
  }

  @Patch(':id')
  @RequirePermissions('site_visit.manage')
  @ApiZodBody(siteVisitUpdateSchema)
  update(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(siteVisitUpdateSchema)) body: z.output<typeof siteVisitUpdateSchema>) {
    return this.visits.update(user, id, body);
  }
}

@ApiTags('CRM — customers')
@Controller({ path: 'crm/customers', version: '1' })
export class CustomersController {
  constructor(private readonly config: CrmConfigService) {}

  @Get()
  @RequirePermissions('customer.view')
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(paginationSchema.extend({ q: z.string().trim().max(100).optional(), organizationId: z.uuid().optional() }))) q: { page: number; pageSize: number; q?: string; organizationId?: string }) {
    return this.config.customers(user, q);
  }

  @Get(':id')
  @RequirePermissions('customer.view')
  get(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.config.customer(user, id);
  }

  @Patch(':id')
  @RequirePermissions('customer.manage')
  update(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(customerUpdateSchema)) body: z.output<typeof customerUpdateSchema>) {
    return this.config.updateCustomer(user, id, body);
  }

  @Post(':id/preferences')
  @RequirePermissions('customer.manage')
  addPreference(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(customerPreferenceSchema)) body: z.output<typeof customerPreferenceSchema>) {
    return this.config.addPreference(user, id, body);
  }

  @Delete(':id/preferences/:prefId')
  @RequirePermissions('customer.manage')
  removePreference(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Param('prefId', UuidParam) prefId: string) {
    return this.config.removePreference(user, id, prefId);
  }
}

@ApiTags('CRM — routing')
@Controller({ path: 'crm', version: '1' })
export class RoutingController {
  constructor(private readonly config: CrmConfigService) {}

  @Get('assignees')
  assignees(@CurrentUser() user: AuthUser, @Query(new ZodPipe(z.object({ organizationId: z.uuid().optional() }))) q: { organizationId?: string }) {
    return this.config.assignees(user, q.organizationId);
  }

  @Get('teams')
  @RequirePermissions('assignment.manage')
  teams(@CurrentUser() user: AuthUser, @Query(new ZodPipe(z.object({ organizationId: z.uuid().optional() }))) q: { organizationId?: string }) {
    return this.config.teams(user, q.organizationId);
  }

  @Post('teams')
  @RequirePermissions('assignment.manage')
  createTeam(@CurrentUser() user: AuthUser, @Body(new ZodPipe(salesTeamSchema)) body: z.output<typeof salesTeamSchema>) {
    return this.config.createTeam(user, body);
  }

  @Patch('teams/:id')
  @RequirePermissions('assignment.manage')
  updateTeam(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new PatchPipe(salesTeamSchema)) body: Partial<z.output<typeof salesTeamSchema>>) {
    return this.config.updateTeam(user, id, body);
  }

  @Post('teams/:id/members')
  @RequirePermissions('assignment.manage')
  setMember(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(salesTeamMemberSchema)) body: z.output<typeof salesTeamMemberSchema>) {
    return this.config.setMember(user, id, body.userId, body.isActive);
  }

  @Delete('teams/:id/members/:userId')
  @RequirePermissions('assignment.manage')
  removeMember(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Param('userId', UuidParam) userId: string) {
    return this.config.removeMember(user, id, userId);
  }

  @Get('rules')
  @RequirePermissions('assignment.manage')
  rules(@CurrentUser() user: AuthUser, @Query(new ZodPipe(z.object({ organizationId: z.uuid().optional() }))) q: { organizationId?: string }) {
    return this.config.rules(user, q.organizationId);
  }

  @Post('rules')
  @RequirePermissions('assignment.manage')
  createRule(@CurrentUser() user: AuthUser, @Body(new ZodPipe(assignmentRuleSchema)) body: z.output<typeof assignmentRuleSchema>) {
    return this.config.createRule(user, body);
  }

  @Post('rules/reorder')
  @RequirePermissions('assignment.manage')
  reorder(@CurrentUser() user: AuthUser, @Body(new ZodPipe(rulesReorderSchema)) body: z.output<typeof rulesReorderSchema>) {
    return this.config.reorderRules(user, body.ruleIds);
  }

  @Patch('rules/:id')
  @RequirePermissions('assignment.manage')
  updateRule(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new PatchPipe(assignmentRuleSchema)) body: Partial<z.output<typeof assignmentRuleSchema>>) {
    return this.config.updateRule(user, id, body);
  }

  @Delete('rules/:id')
  @RequirePermissions('assignment.manage')
  deleteRule(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.config.deleteRule(user, id);
  }

  @Post('routing/test')
  @RequirePermissions('assignment.manage')
  test(@CurrentUser() user: AuthUser, @Body(new ZodPipe(routingTestSchema)) body: z.output<typeof routingTestSchema>) {
    return this.config.testRouting(user, body);
  }

  @Get('campaigns')
  @RequirePermissions('marketing.manage')
  campaigns(@CurrentUser() user: AuthUser) {
    return this.config.campaigns(user);
  }

  /** Campaign options for lead forms (any CRM user). */
  @Get('campaigns/options')
  campaignOptions(@CurrentUser() user: AuthUser) {
    return this.config.campaignOptions(user);
  }

  @Post('campaigns')
  @RequirePermissions('marketing.manage')
  createCampaign(@CurrentUser() user: AuthUser, @Body(new ZodPipe(campaignSchema)) body: z.output<typeof campaignSchema>) {
    return this.config.createCampaign(user, body);
  }

  @Patch('campaigns/:id')
  @RequirePermissions('marketing.manage')
  updateCampaign(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new PatchPipe(campaignUpdateSchema, { alreadyPartial: true })) body: Partial<z.output<typeof campaignUpdateSchema>>) {
    return this.config.updateCampaign(user, id, body);
  }

  @Get('lead-sources')
  sources() {
    return this.config.sources();
  }

  @Post('lead-sources')
  @RequirePermissions('marketing.manage')
  createSource(@CurrentUser() user: AuthUser, @Body(new ZodPipe(leadSourceSchema)) body: z.output<typeof leadSourceSchema>) {
    return this.config.createSource(user, body);
  }

  @Patch('lead-sources/:id')
  @RequirePermissions('marketing.manage')
  updateSource(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(z.object({ name: z.string().trim().min(2).max(60).optional(), isActive: z.boolean().optional() }))) body: { name?: string; isActive?: boolean }) {
    return this.config.updateSource(user, id, body);
  }
}

const dealQuery = paginationSchema.extend({
  status: z.enum(DEAL_STATUSES).optional(),
  q: z.string().trim().max(60).optional(),
  projectId: z.uuid().optional(),
  salesUserId: z.union([z.uuid(), z.literal('me')]).optional(),
});

@ApiTags('CRM — deals')
@Controller({ path: 'crm/deals', version: '1' })
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Get()
  @RequirePermissions('deal.view')
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(dealQuery)) q: z.output<typeof dealQuery>) {
    return this.deals.list(user, q);
  }

  @Post()
  @RequirePermissions('deal.manage')
  @ApiZodBody(dealCreateSchema)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(dealCreateSchema)) body: z.output<typeof dealCreateSchema>) {
    return this.deals.create(user, body);
  }

  @Get(':id')
  @RequirePermissions('deal.view')
  get(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.deals.detail(user, id);
  }

  @Post(':id/status')
  @RequirePermissions('deal.manage')
  status(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(dealStatusSchema)) body: z.output<typeof dealStatusSchema>) {
    return this.deals.changeStatus(user, id, body);
  }

  @Post(':id/payments')
  @RequirePermissions('deal.manage')
  addPayment(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(dealPaymentSchema)) body: z.output<typeof dealPaymentSchema>) {
    return this.deals.addPayment(user, id, body);
  }

  @Delete(':id/payments/:paymentId')
  @RequirePermissions('deal.manage')
  removePayment(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Param('paymentId', UuidParam) paymentId: string) {
    return this.deals.removePayment(user, id, paymentId);
  }
}
