import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { PermissionKey } from '@estate/shared';
import { env } from '../../config/env';
import { ALLOW_PENDING_PASSWORD_KEY, IS_PUBLIC_KEY, PERMISSIONS_KEY, RequestWithUser } from '../decorators';
import { AuthContextService } from './auth-context.service';
import { authCookieNames } from './cookies';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
}

export const JWT_ISSUER = 'estate-api';
export const JWT_AUDIENCE = 'estate-clients';

function extractToken(req: RequestWithUser): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || null;
  const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
  return cookies?.[authCookieNames(req as never).access] ?? null;
}

/** Global guard: attaches the principal when a valid access token is present; blocks non-public routes otherwise. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly authContext: AuthContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);

    const token = extractToken(req);
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
          secret: env().JWT_ACCESS_SECRET,
          algorithms: ['HS256'],
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        });
        const user = await this.authContext.load(payload.sub, payload.sid);
        if (user) req.user = user;
      } catch {
        // Invalid or expired token: treated as anonymous.
      }
    }

    if (isPublic) return true;
    if (!req.user) throw new UnauthorizedException({ message: 'Authentication required', code: 'UNAUTHENTICATED' });
    // An administrator-set (temporary) password must be replaced before anything else can be done.
    if (req.user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_KEY, [context.getHandler(), context.getClass()])) {
      throw new ForbiddenException({ message: 'Choose a new password to continue', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    return true;
  }
}

/** Global guard: enforces @RequirePermissions (scope-agnostic; services enforce organisation scope). */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    if (!req.user) throw new UnauthorizedException({ message: 'Authentication required', code: 'UNAUTHENTICATED' });
    const missing = required.filter((p) => !req.user!.can(p));
    if (missing.length) throw new ForbiddenException({ message: 'You do not have permission to perform this action', code: 'FORBIDDEN', details: missing.map((p) => ({ path: 'permission', message: p })) });
    return true;
  }
}
