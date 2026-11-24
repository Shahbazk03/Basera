import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthContextService } from './auth/auth-context.service';
import { AuditService } from './audit.service';
import { SettingsService } from './settings.service';

@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [AuthContextService, AuditService, SettingsService],
  exports: [AuthContextService, AuditService, SettingsService, JwtModule],
})
export class CommonModule {}
