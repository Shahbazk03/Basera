import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  changePasswordSchema,
  customerRegisterSchema,
  forgotPasswordSchema,
  leadProviderRegisterSchema,
  loginSchema,
  partnerRegisterSchema,
  profileUpdateSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@estate/shared';
import { z } from 'zod';
import { env } from '../../config/env';
import { AuthUser } from '../../common/auth/auth-user';
import {
  clearAllAuthCookies,
  clearAuthCookies,
  clearSlotCookies,
  isTabSlotId,
  MAIN_SLOT,
  MAX_TAB_SLOTS,
  newTabSlotId,
  readRefreshCookie,
  readRefreshCookieOf,
  requestedSlot,
  sessionSlot,
  setAccessCookie,
  setAuthCookies,
  tabSlots,
} from '../../common/auth/cookies';
import { AllowPendingPasswordChange, ApiZodBody, CurrentUser, OptionalUser, Public, ReqMeta, RequestMeta } from '../../common/decorators';
import { PatchPipe, UuidParam, ZodPipe } from '../../common/zod.pipe';
import { AuthService, IssuedTokens } from './auth.service';
import { AuthContextService } from '../../common/auth/auth-context.service';

const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

const refreshCookie = readRefreshCookie;

@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly authContext: AuthContextService,
  ) {}

  /**
   * Where a sign-in goes (see cookies.ts):
   *  - a tab that already holds an account (its slot, or `main`) replaces that account;
   *  - a tab that holds none (`none`, or a fresh tab while the browser's main session is in use) gets a
   *    new tab-only slot, so the account other tabs use is never replaced;
   *  - otherwise the sign-in becomes the browser's main session.
   * Replaced sessions, and the oldest tab slots beyond MAX_TAB_SLOTS, are revoked on the server.
   */
  private async signInSlot(req: Request, res: Response): Promise<string> {
    const requested = requestedSlot(req);
    if (requested === MAIN_SLOT || isTabSlotId(requested)) {
      await this.auth.revokeRefreshTokens([readRefreshCookieOf(req, requested)], 'REPLACED');
      return requested;
    }
    // A fresh tab (or one that chose "another account") takes over the main session only when nobody uses it.
    if (!(await this.auth.isLiveRefreshToken(readRefreshCookieOf(req, MAIN_SLOT)))) return MAIN_SLOT;
    const evicted = tabSlots(req).slice(MAX_TAB_SLOTS - 1);
    await this.auth.revokeRefreshTokens(evicted.map((s) => readRefreshCookieOf(req, s)), 'TAB_LIMIT');
    for (const s of evicted) clearSlotCookies(res, s);
    return newTabSlotId();
  }

  private async respond(req: Request, res: Response, tokens: IssuedTokens, mode: 'sign-in' | 'refresh' = 'sign-in') {
    if (tokens.refreshToken) {
      const slot = mode === 'sign-in' ? await this.signInSlot(req, res) : (sessionSlot(req) ?? MAIN_SLOT);
      setAuthCookies(res, tokens.accessToken, tokens.refreshToken, slot);
    } else setAccessCookie(res, tokens.accessToken);
    const user = await this.authContext.buildUser(tokens.userId, tokens.sessionId);
    return { user: user ? await this.auth.sessionUser(user) : null, accessTokenExpiresIn: env().ACCESS_TOKEN_TTL_SECONDS };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(200)
  @ApiZodBody(loginSchema)
  async login(@Body(new ZodPipe(loginSchema)) body: z.output<typeof loginSchema>, @ReqMeta() meta: RequestMeta, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.respond(req, res, await this.auth.login(body.identifier, body.password, meta));
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  @ApiZodBody(customerRegisterSchema)
  async register(@Body(new ZodPipe(customerRegisterSchema)) body: z.output<typeof customerRegisterSchema>, @ReqMeta() meta: RequestMeta, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.respond(req, res, await this.auth.registerCustomer(body, meta));
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register/partner')
  @ApiZodBody(partnerRegisterSchema)
  async registerPartner(@Body(new ZodPipe(partnerRegisterSchema)) body: z.output<typeof partnerRegisterSchema>, @ReqMeta() meta: RequestMeta, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.respond(req, res, await this.auth.registerPartner(body, meta));
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register/lead-provider')
  @ApiZodBody(leadProviderRegisterSchema)
  async registerLeadProvider(@Body(new ZodPipe(leadProviderRegisterSchema)) body: z.output<typeof leadProviderRegisterSchema>, @ReqMeta() meta: RequestMeta, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.respond(req, res, await this.auth.registerLeadProvider(body, meta));
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    try {
      return await this.respond(req, res, await this.auth.refresh(refreshCookie(req), meta), 'refresh');
    } catch (err) {
      clearAuthCookies(res);
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@OptionalUser() user: AuthUser | undefined, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user?.sessionId ?? null, refreshCookie(req));
    clearAuthCookies(res);
    return { ok: true };
  }

  /** Signs every account of this app out of this browser (main session and all tab-only accounts). */
  @Public()
  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.revokeRefreshTokens([MAIN_SLOT, ...tabSlots(req)].map((s) => readRefreshCookieOf(req, s)), 'LOGOUT');
    clearAllAuthCookies(res);
    return { ok: true };
  }

  @Get('me')
  @AllowPendingPasswordChange()
  async me(@CurrentUser() user: AuthUser) {
    return this.auth.sessionUser(user);
  }

  /** Update your own name and/or profile photo; returns the refreshed session user. */
  @Patch('me')
  @ApiZodBody(profileUpdateSchema)
  updateMe(@CurrentUser() user: AuthUser, @Body(new PatchPipe(profileUpdateSchema)) body: Partial<z.output<typeof profileUpdateSchema>>, @ReqMeta() meta: RequestMeta) {
    return this.auth.updateProfile(user, body, meta);
  }

  @Get('sessions')
  @AllowPendingPasswordChange()
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user);
  }

  @Delete('sessions/:id')
  async revokeSession(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    await this.auth.revokeSession(user, id);
    return { ok: true };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('verify-email')
  @HttpCode(200)
  verifyEmail(@Body(new ZodPipe(verifyEmailSchema)) body: z.output<typeof verifyEmailSchema>) {
    return this.auth.verifyEmail(body.token);
  }

  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  @Post('resend-verification')
  @HttpCode(200)
  async resendVerification(@CurrentUser() user: AuthUser) {
    const base = user.accountType === 'CUSTOMER' ? env().WEB_PUBLIC_URL : env().CONSOLE_PUBLIC_URL;
    await this.auth.sendEmailVerification(user.id, base);
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body(new ZodPipe(forgotPasswordSchema.extend({ app: z.enum(['web', 'console']).default('web') }))) body: { email: string; app: 'web' | 'console' }, @ReqMeta() meta: RequestMeta) {
    await this.auth.forgotPassword(body.email, body.app === 'console' ? env().CONSOLE_PUBLIC_URL : env().WEB_PUBLIC_URL, meta);
    return { ok: true, message: 'If an account exists for this email, a reset link has been sent.' };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body(new ZodPipe(resetPasswordSchema)) body: z.output<typeof resetPasswordSchema>, @ReqMeta() meta: RequestMeta) {
    await this.auth.resetPassword(body.token, body.password, meta);
    return { ok: true };
  }

  @Post('change-password')
  @Throttle(AUTH_THROTTLE)
  @AllowPendingPasswordChange()
  @HttpCode(200)
  async changePassword(@CurrentUser() user: AuthUser, @Body(new ZodPipe(changePasswordSchema)) body: z.output<typeof changePasswordSchema>, @ReqMeta() meta: RequestMeta) {
    await this.auth.changePassword(user, body, meta);
    return { ok: true };
  }
}
