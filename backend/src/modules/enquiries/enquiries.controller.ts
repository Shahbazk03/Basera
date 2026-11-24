import { Body, Controller, Get, HttpCode, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ENQUIRY_STATUSES, ENQUIRY_TYPES, enquirySchema, enquiryStatusSchema } from '@estate/shared';
import { AuthUser } from '../../common/auth/auth-user';
import { ApiZodBody, CurrentUser, OptionalUser, Public, ReqMeta, RequestMeta, RequirePermissions } from '../../common/decorators';
import { paginationSchema } from '../../common/http';
import { UuidParam, ZodPipe } from '../../common/zod.pipe';
import { CrmModule } from '../crm/crm.module';
import { EnquiriesService } from './enquiries.service';

const listQuery = paginationSchema.extend({
  status: z.enum(ENQUIRY_STATUSES).optional(),
  type: z.enum(ENQUIRY_TYPES).optional(),
  q: z.string().trim().max(100).optional(),
  organizationId: z.uuid().optional(),
});

@ApiTags('Enquiries')
@Controller({ version: '1' })
export class EnquiriesController {
  constructor(private readonly enquiries: EnquiriesService) {}

  /** Public enquiry submission (property, project, unit, callback, site visit, WhatsApp, general). */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('public/enquiries')
  @HttpCode(201)
  @ApiZodBody(enquirySchema)
  submit(@Body(new ZodPipe(enquirySchema)) body: z.output<typeof enquirySchema>, @ReqMeta() meta: RequestMeta, @OptionalUser() user?: AuthUser) {
    return this.enquiries.submit(body, meta, user);
  }

  /** The logged-in customer's own enquiries. */
  @Get('me/enquiries')
  mine(@CurrentUser() user: AuthUser) {
    return this.enquiries.mine(user);
  }

  @Get('crm/enquiries')
  @RequirePermissions('enquiry.view')
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listQuery)) q: z.output<typeof listQuery>) {
    return this.enquiries.list(user, q);
  }

  @Patch('crm/enquiries/:id/status')
  @RequirePermissions('enquiry.manage')
  setStatus(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(enquiryStatusSchema)) body: z.output<typeof enquiryStatusSchema>) {
    return this.enquiries.setStatus(user, id, body.status, body.note);
  }
}

@Module({
  imports: [CrmModule],
  controllers: [EnquiriesController],
  providers: [EnquiriesService],
})
export class EnquiriesModule {}
