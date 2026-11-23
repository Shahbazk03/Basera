import {
  ArgumentsHost,
  CallHandler,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
  NestMiddleware,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { map, Observable } from 'rxjs';
import { ZodError } from 'zod';
import { Prisma } from '../generated/prisma/client';
import { corsOrigins } from '../config/env';
import type { RequestWithUser } from './decorators';
import { zodIssues } from './zod.pipe';
import { hasAuthCookie } from './auth/cookies';

// ───────────────────────── Request id ─────────────────────────

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithUser, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    req.requestId = id;
    res.setHeader('x-request-id', id);
    next();
  }
}

// ───────────────────────── CSRF (origin verification) ─────────────────────────

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Cookie-authenticated state-changing requests must originate from an allowed origin.
 * Bearer-token requests (API clients) are not CSRF-exposed and are exempt. Combined with
 * SameSite=Lax cookies this blocks cross-site request forgery.
 */
@Injectable()
export class OriginCheckMiddleware implements NestMiddleware {
  private readonly allowed = new Set(corsOrigins());

  use(req: Request, _res: Response, next: NextFunction): void {
    if (SAFE_METHODS.has(req.method)) return next();
    const usesCookieAuth = hasAuthCookie((req as Request & { cookies?: Record<string, string> }).cookies);
    if (!usesCookieAuth || req.headers.authorization) return next();
    const origin = (req.headers.origin as string | undefined) ?? refererOrigin(req.headers.referer);
    if (origin && this.allowed.has(origin.replace(/\/$/, ''))) return next();
    // Server-to-server calls from our own Next.js servers carry no Origin but identify themselves.
    if (!origin && req.headers['x-estate-internal'] === '1') return next();
    next(new ForbiddenException({ message: 'Cross-site request blocked', code: 'CSRF_ORIGIN_MISMATCH' }));
  }
}

function refererOrigin(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

// ───────────────────────── Serialisation ─────────────────────────

/** Converts Prisma Decimal → number and BigInt → number throughout responses. */
export function toPlain(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value;
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toNumber();
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === 'object') {
    if (Buffer.isBuffer(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toPlain(v);
    return out;
  }
  return value;
}

@Injectable()
export class SerializeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((body) => toPlain(body)));
  }
}

// ───────────────────────── Errors ─────────────────────────

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<RequestWithUser>();
    const requestId = req.requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'An unexpected error occurred';
    let code: string | undefined;
    let details: unknown;

    if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      message = 'Too many requests. Please wait a moment and try again.';
      code = 'RATE_LIMITED';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') message = body;
      else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        message = Array.isArray(b.message) ? b.message.join('; ') : String(b.message ?? exception.message);
        code = typeof b.code === 'string' ? b.code : undefined;
        details = b.details;
      }
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Validation failed';
      code = 'VALIDATION_FAILED';
      details = zodIssues(exception);
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      ({ status, message, code } = mapPrismaError(exception));
    }

    if (status >= 500) {
      this.logger.error(`[${requestId}] ${req.method} ${req.originalUrl}`, exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(status).json({
      statusCode: status,
      error: HttpStatus[status] ?? 'Error',
      message,
      ...(code ? { code } : {}),
      ...(details ? { details } : {}),
      requestId,
    });
  }
}

function mapPrismaError(e: Prisma.PrismaClientKnownRequestError): { status: number; message: string; code: string } {
  switch (e.code) {
    case 'P2002': {
      const target = (e.meta?.target as string[] | string | undefined) ?? (e.meta?.driverAdapterError as { cause?: { constraint?: { fields?: string[] } } } | undefined)?.cause?.constraint?.fields;
      const fields = Array.isArray(target) ? target.join(', ') : target;
      return { status: 409, message: fields ? `A record with this ${fields} already exists` : 'A record with these details already exists', code: 'DUPLICATE' };
    }
    case 'P2025':
      return { status: 404, message: 'Record not found', code: 'NOT_FOUND' };
    case 'P2003':
      return { status: 409, message: 'This record is referenced by other records or references a missing record', code: 'REFERENCE_CONFLICT' };
    case 'P2034':
      return { status: 409, message: 'The record was changed by someone else. Please retry.', code: 'WRITE_CONFLICT' };
    default:
      return { status: 500, message: 'Database error', code: `DB_${e.code}` };
  }
}
