import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationController, PartnersController, PartnersScheduler } from './partners.controller';
import { PartnersService } from './partners.service';
import { OrganizationService } from './organization.service';

@Module({
  imports: [AuthModule],
  controllers: [PartnersController, OrganizationController],
  providers: [PartnersService, OrganizationService, PartnersScheduler],
  exports: [PartnersService],
})
export class PartnersModule {}
