import { Body, Controller, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { LEAD_INTAKE_STATUSES, leadProviderAdminUpdateSchema, leadProviderSubmitSchema, providerImportSchema, providerLeadReviewSchema } from '@estate/shared';
import { AuthUser } from '../../common/auth/auth-user';
import { ApiZodBody, CurrentUser, RequirePermissions } from '../../common/decorators';
import { paginationSchema } from '../../common/http';
import { UuidParam, ZodPipe } from '../../common/zod.pipe';
import { CrmModule } from '../crm/crm.module';
import { LeadProvidersService } from './lead-providers.service';

@ApiTags('Lead providers — admin')
@Controller({ path: 'crm/lead-providers', version: '1' })
export class LeadProvidersAdminController {
  constructor(private readonly providers: LeadProvidersService) {}

  @Get()
  @RequirePermissions('lead_provider.manage')
  list(@Query(new ZodPipe(z.object({ q: z.string().trim().max(80).optional(), status: z.enum(['ACTIVE', 'SUSPENDED']).optional() }))) q: { q?: string; status?: 'ACTIVE' | 'SUSPENDED' }) {
    return this.providers.list(q);
  }

  @Get('review')
  @RequirePermissions('lead_provider.manage')
  reviewQueue(@Query(new ZodPipe(paginationSchema)) q: { page: number; pageSize: number }) {
    return this.providers.reviewQueue(q);
  }

  @Post('review/:leadId')
  @RequirePermissions('lead_provider.manage')
  review(@CurrentUser() user: AuthUser, @Param('leadId', UuidParam) leadId: string, @Body(new ZodPipe(providerLeadReviewSchema)) body: z.output<typeof providerLeadReviewSchema>) {
    return this.providers.review(user, leadId, body.decision, body.reason);
  }

  @Get(':id')
  @RequirePermissions('lead_provider.manage')
  detail(@Param('id', UuidParam) id: string) {
    return this.providers.detail(id);
  }

  @Patch(':id')
  @RequirePermissions('lead_provider.manage')
  update(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(leadProviderAdminUpdateSchema)) body: z.output<typeof leadProviderAdminUpdateSchema>) {
    return this.providers.update(user, id, body);
  }
}

@ApiTags('Lead providers — partner portal')
@Controller({ path: 'provider', version: '1' })
export class ProviderPortalController {
  constructor(private readonly providers: LeadProvidersService) {}

  @Get('profile')
  @RequirePermissions('lead_provider.portal')
  profile(@CurrentUser() user: AuthUser) {
    return this.providers.portalProfile(user);
  }

  @Get('stats')
  @RequirePermissions('lead_provider.portal')
  stats(@CurrentUser() user: AuthUser) {
    return this.providers.myStats(user);
  }

  @Get('leads')
  @RequirePermissions('lead_provider.portal')
  leads(@CurrentUser() user: AuthUser, @Query(new ZodPipe(paginationSchema.extend({ intake: z.enum(LEAD_INTAKE_STATUSES).optional(), q: z.string().trim().max(80).optional() }))) q: { page: number; pageSize: number; intake?: (typeof LEAD_INTAKE_STATUSES)[number]; q?: string }) {
    return this.providers.myLeads(user, q);
  }

  @Post('leads')
  @RequirePermissions('lead_provider.portal')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiZodBody(leadProviderSubmitSchema)
  submit(@CurrentUser() user: AuthUser, @Body(new ZodPipe(leadProviderSubmitSchema)) body: z.output<typeof leadProviderSubmitSchema>) {
    return this.providers.submit(user, body);
  }

  @Post('leads/import')
  @RequirePermissions('lead_provider.portal')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  import(@CurrentUser() user: AuthUser, @Body(new ZodPipe(providerImportSchema)) body: z.output<typeof providerImportSchema>) {
    return this.providers.importCsv(user, body.csv, body.commit);
  }
}

@Module({
  imports: [CrmModule],
  controllers: [LeadProvidersAdminController, ProviderPortalController],
  providers: [LeadProvidersService],
})
export class LeadProvidersModule {}
