import { Module } from '@nestjs/common';
import { AssignmentService } from './assignment.service';
import { CrmConfigService } from './crm-config.service';
import { CustomersController, DealsController, FollowUpsController, LeadsController, RoutingController, SiteVisitsController } from './crm.controller';
import { DealsService } from './deals.service';
import { FollowUpsScheduler } from './followups.scheduler';
import { LeadsService } from './leads.service';
import { SiteVisitsService } from './site-visits.service';

@Module({
  controllers: [LeadsController, FollowUpsController, SiteVisitsController, CustomersController, RoutingController, DealsController],
  providers: [LeadsService, AssignmentService, SiteVisitsService, CrmConfigService, DealsService, FollowUpsScheduler],
  exports: [LeadsService, AssignmentService],
})
export class CrmModule {}
