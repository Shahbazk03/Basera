import { Controller, Get, Module, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { WorkspaceKey } from '@estate/shared';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { ReportsService } from './reports.service';

const dashboardQuery = z.object({
  workspace: z.enum(['admin', 'staff', 'broker', 'developer', 'owner', 'lead-provider']),
  organizationId: z.uuid().optional(),
});
const rangeQuery = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() });

@ApiTags('Reports & dashboards')
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard')
  @RequirePermissions('dashboard.view')
  dashboard(@CurrentUser() user: AuthUser, @Query(new ZodPipe(dashboardQuery)) q: z.output<typeof dashboardQuery>) {
    return this.reports.dashboard(user, q.workspace as WorkspaceKey, q.organizationId);
  }

  @Get('lead-sources')
  @RequirePermissions('report.view')
  leadSources(@CurrentUser() user: AuthUser, @Query(new ZodPipe(rangeQuery)) q: z.output<typeof rangeQuery>) {
    return this.reports.leadSources(user, q.from, q.to);
  }

  @Get('listings')
  @RequirePermissions('report.view')
  listings(@CurrentUser() user: AuthUser, @Query(new ZodPipe(rangeQuery)) q: z.output<typeof rangeQuery>) {
    return this.reports.listingPerformance(user, q.from, q.to);
  }

  @Get('projects')
  @RequirePermissions('report.view')
  projects(@CurrentUser() user: AuthUser) {
    return this.reports.salesByProject(user);
  }

  @Get('team')
  @RequirePermissions('report.view')
  team(@CurrentUser() user: AuthUser, @Query(new ZodPipe(rangeQuery)) q: z.output<typeof rangeQuery>) {
    return this.reports.teamPerformance(user, q.from, q.to);
  }
}

@Module({ controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
