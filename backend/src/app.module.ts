import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { env } from './config/env';
import { PrismaModule } from './prisma/prisma.service';
import { CommonModule } from './common/common.module';
import { AuthGuard, PermissionsGuard } from './common/auth/guards';
import { AllExceptionsFilter, OriginCheckMiddleware, RequestIdMiddleware, SerializeInterceptor } from './common/http-infra';
import { RedisThrottlerStorage } from './common/redis-throttler.storage';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuthModule } from './modules/auth/auth.module';
import { SystemController } from './modules/system/system.controller';
import { DOMAIN_MODULES } from './modules';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
        storage: env().REDIS_URL && env().APP_ENV !== 'test' ? new RedisThrottlerStorage(env().REDIS_URL!) : undefined,
        skipIf: () => env().APP_ENV === 'test',
      }),
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    CommonModule,
    NotificationsModule,
    AuthModule,
    ...DOMAIN_MODULES,
  ],
  controllers: [SystemController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: SerializeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, OriginCheckMiddleware).forRoutes('*');
  }
}
