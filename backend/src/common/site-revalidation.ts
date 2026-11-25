import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { env } from '../config/env';
import { randomToken } from './crypto';

/** Changes made here never show on public pages (sign-in, the public API itself, a customer's own data, uploads alone). */
const NOT_PUBLIC_CONTENT = /^\/api\/v1\/(?:auth|public|me|files|notifications)(?:\/|$)/;
const BATCH_MS = 1_500;
const CODE_TTL_MS = 60_000;

/**
 * Tells the public website to drop its cached pages after something was changed in the console, so the
 * change shows right away (the website otherwise refreshes cached pages only every minute or so).
 * A burst of changes causes one refresh. The website confirms each request with a one-time code it
 * checks against this API (GET /public/site-revalidation/:code), so nobody else can trigger it.
 */
@Injectable()
export class SiteRevalidationService {
  private readonly logger = new Logger('SiteRevalidation');
  private readonly codes = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  schedule(): void {
    if (this.timer || env().APP_ENV === 'test') return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.send();
    }, BATCH_MS);
    this.timer.unref();
  }

  /** One-time code check for the website's request. */
  confirm(code: string): boolean {
    const expires = this.codes.get(code);
    this.codes.delete(code);
    return expires !== undefined && expires > Date.now();
  }

  private async send(): Promise<void> {
    const now = Date.now();
    for (const [code, expires] of this.codes) if (expires <= now) this.codes.delete(code);
    const code = randomToken(32);
    this.codes.set(code, now + CODE_TTL_MS);
    const url = `${env().WEB_PUBLIC_URL.replace(/\/$/, '')}/api/revalidate`;
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(15_000) });
      if (!res.ok) this.logger.warn(`The website did not refresh its pages (HTTP ${res.status} from ${url})`);
    } catch (e) {
      this.logger.warn(`The website could not be asked to refresh its pages (${url}): ${(e as Error).message}`);
    }
  }
}

/** After a successful change (POST/PUT/PATCH/DELETE) that may show on public pages, schedules a website refresh. */
@Injectable()
export class SiteRevalidationInterceptor implements NestInterceptor {
  constructor(private readonly revalidation: SiteRevalidationService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const changes = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE';
    if (!changes || NOT_PUBLIC_CONTENT.test(req.path)) return next.handle();
    return next.handle().pipe(tap({ next: () => this.revalidation.schedule() }));
  }
}
