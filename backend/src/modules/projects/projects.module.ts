import { Module } from '@nestjs/common';
import { DomainsService } from './domains.service';
import { InventoryService } from './inventory.service';
import { PageService } from './page.service';
import { ProjectPublicService } from './project-public.service';
import { DomainsController, InventoryController, PageController, ProjectsController, PublicProjectsController } from './projects.controller';
import { ProjectsScheduler } from './projects.scheduler';
import { ProjectsService } from './projects.service';

@Module({
  controllers: [ProjectsController, InventoryController, DomainsController, PageController, PublicProjectsController],
  providers: [ProjectsService, InventoryService, DomainsService, PageService, ProjectPublicService, ProjectsScheduler],
  exports: [ProjectsService, InventoryService, ProjectPublicService, DomainsService],
})
export class ProjectsModule {}
