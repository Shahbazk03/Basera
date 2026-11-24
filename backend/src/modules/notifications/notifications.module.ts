import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { EmailProvider, SmsProvider, WhatsAppProvider } from './providers';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, EmailProvider, SmsProvider, WhatsAppProvider],
  exports: [NotificationsService],
})
export class NotificationsModule {}
