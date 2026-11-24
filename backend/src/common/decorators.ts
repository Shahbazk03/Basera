import { applyDecorators, createParamDecorator, ExecutionContext, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiQuery } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import type { PermissionKey } from '@estate/shared';
import type { AuthUser } from './auth/auth-user';

export const IS_PUBLIC_KEY = 'estate:isPublic';
/** Marks auth routes that stay usable while the user must still replace an administrator-set password. */
export const ALLOW_PENDING_PASSWORD_KEY = 'allowPendingPasswordChange';
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PENDING_PASSWORD_KEY, true);

export const PERMISSIONS_KEY = 'estate:permissions';

/** Route is reachable without authentication (a valid session is still attached when present). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Requires the user to hold every listed permission in at least one scope. Resource-level checks
 * (does the permission apply to *this* organisation's record?) are enforced in services via AuthUser.assert().
 */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  applyDecorators(SetMetadata(PERMISSIONS_KEY, permissions), ApiCookieAuth('estate_at'));

export type RequestWithUser = Request & { user?: AuthUser; requestId?: string };

/** Injects the authenticated user; throws 401 if absent. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<RequestWithUser>();
  if (!req.user) throw new UnauthorizedException('Authentication required');
  return req.user;
});

/** Injects the user when authenticated, otherwise undefined (for public routes). */
export const OptionalUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser | undefined => {
  return ctx.switchToHttp().getRequest<RequestWithUser>().user;
});

export interface RequestMeta {
  ip: string;
  userAgent: string | null;
  host: string | null;
  requestId: string | null;
}

export const ReqMeta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest<RequestWithUser>();
  return {
    ip: req.ip ?? req.socket.remoteAddress ?? 'unknown',
    userAgent: (req.headers['user-agent'] as string | undefined)?.slice(0, 400) ?? null,
    host: (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host ?? null,
    requestId: req.requestId ?? null,
  };
});

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  } catch {
    return { type: 'object' };
  }
}

/** Documents a Zod request body in Swagger. Pair with @Body(new ZodPipe(schema)). */
export const ApiZodBody = (schema: z.ZodType) => ApiBody({ schema: jsonSchema(schema) as never });

/** Documents each key of a Zod object schema as a query parameter. */
export const ApiZodQuery = (schema: z.ZodObject) =>
  applyDecorators(
    ...Object.entries(schema.shape).map(([name, s]) =>
      ApiQuery({ name, required: !(s as z.ZodType).safeParse(undefined).success, schema: jsonSchema(s as z.ZodType) as never }),
    ),
  );
