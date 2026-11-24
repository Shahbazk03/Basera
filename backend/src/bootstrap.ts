import { Logger, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { corsOrigins, env } from './config/env';
import { DatabaseStorageDriver } from './modules/files/storage';

/** HTTP pipeline shared by the server entry point and the integration test-suite. */
export function configureApp(app: NestExpressApplication): void {
  const e = env();
  app.set('trust proxy', e.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '256kb', extended: false });
  app.use(
    helmet({
      // JSON API: CSP only matters for Swagger UI; allow it to load its inline assets.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());

  const allowed = new Set(corsOrigins());
  app.enableCors({
    origin: (origin, cb) => cb(null, !origin || allowed.has(origin.replace(/\/$/, ''))),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  });

  app.setGlobalPrefix('api', { exclude: ['uploads/(.*)'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Public uploads (local storage driver). Private files are never served statically.
  if (e.STORAGE_DRIVER === 'local') {
    app.useStaticAssets(path.resolve(e.STORAGE_LOCAL_DIR, 'public'), { prefix: '/uploads/', maxAge: '7d', immutable: true, index: false, dotfiles: 'deny' });
  }
  // Public uploads kept in the database (database storage driver), at the same /uploads/<key> addresses.
  if (e.STORAGE_DRIVER === 'database') {
    const storage = app.get(DatabaseStorageDriver);
    const logger = new Logger('Uploads');
    app.use('/uploads', (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      storage.servePublic(req.path, res).catch((err: unknown) => {
        logger.error(`Could not serve /uploads${req.path}: ${err instanceof Error ? err.message : String(err)}`);
        if (!res.headersSent) res.status(500).end();
      });
    });
  }
  app.enableShutdownHooks();
}
