import { Module } from '@nestjs/common';
import { AccountController, PropertiesController, PropertiesScheduler, PropertyReportsController, PublicPropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { PropertySearchService } from './property-search.service';

@Module({
  controllers: [PublicPropertiesController, AccountController, PropertiesController, PropertyReportsController],
  providers: [PropertiesService, PropertySearchService, PropertiesScheduler],
  exports: [PropertiesService, PropertySearchService],
})
export class PropertiesModule {}
