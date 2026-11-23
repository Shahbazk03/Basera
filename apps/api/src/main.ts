import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { env } from './config/env';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { JsonLogger } from './common/json-logger';

async function bootstrap(): Promise<void> {
  const e = env();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: process.env.LOG_FORMAT === 'json' ? new JsonLogger() : undefined,
  });
  const logger = new Logger('Bootstrap');
  configureApp(app);

  const swaggerEnabled = e.SWAGGER_ENABLED ?? e.APP_ENV !== 'production';
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('Estate Platform API')
      .setDescription('Versioned REST API for the marketplace, projects, CRM, HR, payroll, commissions and finance.')
      .setVersion('1.0')
      .addCookieAuth('estate_at')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config), { jsonDocumentUrl: 'api/docs/openapi.json' });
  }

  await app.listen(e.API_PORT);
  logger.log(`API listening on :${e.API_PORT} (${e.APP_ENV})${swaggerEnabled ? ` — docs at /api/docs` : ''}`);
}

void bootstrap();
