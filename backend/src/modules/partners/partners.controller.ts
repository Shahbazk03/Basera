import { Body, Controller, Delete, Get, Injectable, Logger, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  memberInviteSchema,
  memberUpdateSchema,
  orgDocumentDecisionSchema,
  orgDocumentSchema,
  organizationUpdateSchema,
  orgVerificationDecisionSchema,
  PARTNER_LIST_TYPES,
  publishModeSchema,
  subscriptionAssignSchema,
  subscriptionCancelSchema,
  subscriptionPlanSchema,
} from '@estate/shared';
import { env } from '../../config/env';
import { AuthUser } from '../../common/auth/auth-user';
import { ApiZodBody, CurrentUser, RequirePermissions } from '../../common/decorators';
import { paginationSchema } from '../../common/http';
import { UuidParam, ZodPipe } from '../../common/zod.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { PartnersService } from './partners.service';
import { OrganizationService } from './organization.service';

const listQuery = paginationSchema.extend({
  type: z.enum(PARTNER_LIST_TYPES).optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED']).optional(),
  verification: z.enum(['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED']).optional(),
  q: z.string().trim().max(100).optional(),
});

const brokerProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(100).optional(),
  reraAgentNumber: z.string().trim().max(80).optional().nullable(),
  experienceYears: z.coerce.number().int().min(0).max(70).optional().nullable(),
  languages: z.array(z.string().trim().min(2).max(30)).max(10).optional(),
  specializations: z.array(z.string().trim().min(2).max(60)).max(10).optional(),
  about: z.string().trim().max(2000).optional().nullable(),
});
const developerProfileSchema = z.object({
  establishedYear: z.coerce.number().int().min(1900).max(2100).optional().nullable(),
  projectsDelivered: z.coerce.number().int().min(0).max(10000).optional().nullable(),
  about: z.string().trim().max(4000).optional().nullable(),
});

@ApiTags('Partners — administration')
@Controller({ path: 'partners', version: '1' })
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Get()
  @RequirePermissions()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listQuery)) q: z.output<typeof listQuery>) {
    return this.partners.list(user, q);
  }

  @Get('plans')
  @RequirePermissions('subscription.manage')
  plans() {
    return this.partners.listPlans();
  }

  @Post('plans')
  @RequirePermissions('subscription.manage')
  @ApiZodBody(subscriptionPlanSchema)
  createPlan(@CurrentUser() user: AuthUser, @Body(new ZodPipe(subscriptionPlanSchema)) body: z.output<typeof subscriptionPlanSchema>) {
    return this.partners.createPlan(user, body);
  }

  @Patch('plans/:id')
  @RequirePermissions('subscription.manage')
  updatePlan(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body() raw: unknown) {
    // Zod 4 .partial() still applies field defaults, so keep only the keys the client actually sent.
    const parsed = new ZodPipe(subscriptionPlanSchema.partial()).transform(raw ?? {}) as Partial<z.output<typeof subscriptionPlanSchema>>;
    const keys = raw && typeof raw === 'object' ? Object.keys(raw) : [];
    return this.partners.updatePlan(user, id, Object.fromEntries(Object.entries(parsed).filter(([k]) => keys.includes(k))));
  }

  @Post('subscriptions/:subId/activate')
  @RequirePermissions('subscription.manage')
  activate(@CurrentUser() user: AuthUser, @Param('subId', UuidParam) subId: string, @Body(new ZodPipe(z.object({ paymentReference: z.string().trim().max(100).optional() }))) body: { paymentReference?: string }) {
    return this.partners.activateSubscription(user, subId, body.paymentReference);
  }

  @Post('subscriptions/:subId/cancel')
  @RequirePermissions('subscription.manage')
  cancel(@CurrentUser() user: AuthUser, @Param('subId', UuidParam) subId: string, @Body(new ZodPipe(subscriptionCancelSchema)) body: z.output<typeof subscriptionCancelSchema>) {
    return this.partners.cancelSubscription(user, subId, body.reason);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.partners.detail(user, id);
  }

  @Post(':id/decision')
  @ApiZodBody(orgVerificationDecisionSchema)
  decide(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(orgVerificationDecisionSchema)) body: z.output<typeof orgVerificationDecisionSchema>) {
    return this.partners.decide(user, id, body);
  }

  @Put(':id/publish-mode')
  @RequirePermissions('developer.verify')
  publishMode(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(publishModeSchema)) body: z.output<typeof publishModeSchema>) {
    return this.partners.setPublishMode(user, id, body.projectPublishMode);
  }

  @Post(':id/documents/:docId/review')
  reviewDocument(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Param('docId', UuidParam) docId: string, @Body(new ZodPipe(orgDocumentDecisionSchema)) body: z.output<typeof orgDocumentDecisionSchema>) {
    return this.partners.reviewDocument(user, id, docId, body.status, body.note);
  }

  @Post(':id/subscriptions')
  @RequirePermissions('subscription.manage')
  @ApiZodBody(subscriptionAssignSchema)
  assign(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(subscriptionAssignSchema)) body: z.output<typeof subscriptionAssignSchema>) {
    return this.partners.assignSubscription(user, id, body);
  }
}

@ApiTags('Organisation — self service')
@Controller({ path: 'organizations/:orgId', version: '1' })
export class OrganizationController {
  constructor(private readonly orgs: OrganizationService) {}

  @Get()
  @RequirePermissions('organization.manage')
  profile(@CurrentUser() user: AuthUser, @Param('orgId', UuidParam) orgId: string) {
    return this.orgs.profile(user, orgId);
  }

  @Patch()
  @RequirePermissions('organization.manage')
  @ApiZodBody(organizationUpdateSchema)
  update(@CurrentUser() user: AuthUser, @Param('orgId', UuidParam) orgId: string, @Body(new ZodPipe(organizationUpdateSchema)) body: z.output<typeof organizationUpdateSchema>) {
    return this.orgs.updateProfile(user, orgId, body);
  }

  @Put('broker-profile')
  @RequirePermissions('organization.manage')
  brokerProfile(@CurrentUser() user: AuthUser, @Param('orgId', UuidParam) orgId: string, @Body(new ZodPipe(brokerProfileSchema)) body: z.output<typeof brokerProfileSchema>) {
    return this.orgs.updateBrokerProfile(user, orgId, body);
  }

  @Put('developer-profile')
  @RequirePermissions('organization.manage')
  developerProfile(@CurrentUser() user: AuthUser, @Param('orgId', UuidParam) orgId: string, @Body(new ZodPipe(developerProfileSchema)) body: z.output<typeof developerProfileSchema>) {
    return this.orgs.updateDeveloperProfile(user, orgId, body);
  }

  @Post('resubmit')
  @RequirePermissions('organization.manage')
  resubmit(@CurrentUser() user: AuthUser, @Param('orgId', UuidParam) orgId: string) {
    return this.orgs.resubmit(user, orgId);
  }

  @Get('documents')
  @RequirePermissions('organization.manage')
  documents(@CurrentUser() user: AuthUser, @Param('orgId', UuidParam) orgId: string) {
    return this.orgs.documents(user, orgId);
  }

  @Post('documents')
  @RequirePermissions('organization.manage')
  @ApiZodBody(orgDocumentSchema)
  addDocument(@CurrentUser() user: AuthUser, @Param('orgId', UuidParam) orgId: string, @Body(new ZodPipe(orgDocumentSchema)) body: z.output<typeof orgDocumentSchema>) {
    return this.orgs.addDocument(user, orgId, body);
  }

  @Delete('documents/:docId')
  @RequirePermissions('organization.manage')
  removeDocument(@CurrentUser() user: AuthUser, @Param('orgId', UuidParam) orgId: string, @Param('docId', UuidParam) docId: string) {
    return this.orgs.removeDocument(user, orgId, docId);
  }

  @Get('members')
  @RequirePermissions('organization.manage')
  members(@CurrentUser() user: AuthUser, @Param('orgId', UuidParam) orgId: string) {
    return this.orgs.members(user, orgId);
  }

  @Post('members')
  @RequirePermissions('organization.manage')
  @ApiZodBody(memberInviteSchema)
  invite(@CurrentUser() user: AuthUser, @Param('orgId', UuidParam) orgId: string, @Body(new ZodPipe(memberInviteSchema)) body: z.output<typeof memberInviteSchema>) {
    return this.orgs.invite(user, orgId, body);
  }

  @Patch('members/:userId')
  @RequirePermissions('organization.manage')
  updateMember(@CurrentUser() user: AuthUser, @Param('orgId', UuidParam) orgId: string, @Param('userId', UuidParam) userId: string, @Body(new ZodPipe(memberUpdateSchema)) body: z.output<typeof memberUpdateSchema>) {
    return this.orgs.updateMember(user, orgId, userId, body);
  }

  @Delete('members/:userId')
  @RequirePermissions('organization.manage')
  removeMember(@CurrentUser() user: AuthUser, @Param('orgId', UuidParam) orgId: string, @Param('userId', UuidParam) userId: string) {
    return this.orgs.removeMember(user, orgId, userId);
  }

  @Get('subscription')
  @RequirePermissions('organization.manage')
  subscription(@CurrentUser() user: AuthUser, @Param('orgId', UuidParam) orgId: string) {
    return this.orgs.subscription(user, orgId);
  }
}

/** Hourly: lapse expired subscriptions (single instance via a job lease). */
@Injectable()
export class PartnersScheduler {
  private readonly logger = new Logger('PartnersScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly partners: PartnersService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    if (env().APP_ENV === 'test') return;
    const expired = await this.prisma.withJobLock('jobs:subscription-expiry', (tx) => this.partners.expireSubscriptions(tx));
    if (expired) this.logger.log(`Expired ${expired} subscription(s)`);
  }
}
