import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { normalizePhone, SessionUser, slugify } from '@estate/shared';
import type { z } from 'zod';
import type {
  changePasswordSchema,
  customerRegisterSchema,
  leadProviderRegisterSchema,
  partnerRegisterSchema,
  profileUpdateSchema,
} from '@estate/shared';
import { env } from '../../config/env';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AuthContextService } from '../../common/auth/auth-context.service';
import { AuthUser } from '../../common/auth/auth-user';
import { JWT_AUDIENCE, JWT_ISSUER } from '../../common/auth/guards';
import { dummyPasswordHash, hashPassword, randomToken, sha256, verifyPassword } from '../../common/crypto';
import { AuditService } from '../../common/audit.service';
import { uniqueSlug } from '../../common/references';
import { NotificationsService } from '../notifications/notifications.service';
import { FilesService } from '../files/files.service';
import type { RequestMeta } from '../../common/decorators';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string | null;
  sessionId: string;
  userId: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly authContext: AuthContextService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly files: FilesService,
  ) {}

  // ───────────────────────── Sessions & tokens ─────────────────────────

  private signAccessToken(userId: string, sessionId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, sid: sessionId },
      { secret: env().JWT_ACCESS_SECRET, expiresIn: env().ACCESS_TOKEN_TTL_SECONDS, issuer: JWT_ISSUER, audience: JWT_AUDIENCE, algorithm: 'HS256' },
    );
  }

  private async createSession(userId: string, meta: RequestMeta, db: Tx | PrismaService = this.prisma): Promise<IssuedTokens> {
    const refreshToken = randomToken(48);
    const session = await db.session.create({
      data: {
        userId,
        familyId: randomUUID(),
        refreshTokenHash: sha256(refreshToken),
        userAgent: meta.userAgent,
        ipAddress: meta.ip,
        expiresAt: new Date(Date.now() + env().REFRESH_TOKEN_TTL_DAYS * 86_400_000),
        lastUsedAt: new Date(),
      },
    });
    return { accessToken: await this.signAccessToken(userId, session.id), refreshToken, sessionId: session.id, userId };
  }

  /**
   * Rotates the refresh token. Presenting the *previous* token inside the grace window (parallel tab
   * refresh) yields a new access token without rotating again; presenting it later is treated as
   * token theft and revokes the session.
   */
  async refresh(refreshToken: string | undefined, meta: RequestMeta): Promise<IssuedTokens> {
    if (!refreshToken) throw new UnauthorizedException({ message: 'Session expired', code: 'NO_REFRESH_TOKEN' });
    const hash = sha256(refreshToken);
    const now = new Date();

    const current = await this.prisma.session.findUnique({ where: { refreshTokenHash: hash }, include: { user: { select: { status: true, deletedAt: true } } } });
    if (current) {
      if (current.revokedAt || current.expiresAt < now || current.user.status !== 'ACTIVE' || current.user.deletedAt) {
        throw new UnauthorizedException({ message: 'Session expired', code: 'SESSION_INVALID' });
      }
      const next = randomToken(48);
      const updated = await this.prisma.session.updateMany({
        where: { id: current.id, refreshTokenHash: hash, revokedAt: null },
        data: {
          refreshTokenHash: sha256(next),
          previousTokenHash: hash,
          rotatedAt: now,
          lastUsedAt: now,
          ipAddress: meta.ip,
          expiresAt: new Date(now.getTime() + env().REFRESH_TOKEN_TTL_DAYS * 86_400_000),
        },
      });
      if (updated.count === 0) return this.refresh(refreshToken, meta); // lost a race: re-evaluate as previous token
      return { accessToken: await this.signAccessToken(current.userId, current.id), refreshToken: next, sessionId: current.id, userId: current.userId };
    }

    const previous = await this.prisma.session.findFirst({ where: { previousTokenHash: hash } });
    if (previous && !previous.revokedAt && previous.expiresAt > now) {
      const graceMs = env().REFRESH_REUSE_GRACE_SECONDS * 1000;
      if (previous.rotatedAt && now.getTime() - previous.rotatedAt.getTime() <= graceMs) {
        return { accessToken: await this.signAccessToken(previous.userId, previous.id), refreshToken: null, sessionId: previous.id, userId: previous.userId };
      }
      await this.prisma.session.update({ where: { id: previous.id }, data: { revokedAt: now, revokedReason: 'REFRESH_TOKEN_REUSE' } });
      this.authContext.invalidateSession(previous.id);
      await this.audit.log({ actorId: previous.userId, actorIp: meta.ip, action: 'auth.refresh_reuse_detected', entityType: 'Session', entityId: previous.id });
      this.logger.warn(`Refresh token reuse detected for session ${previous.id}; session revoked`);
    }
    throw new UnauthorizedException({ message: 'Session expired', code: 'SESSION_INVALID' });
  }

  /** Whether a refresh token belongs to a live session (decides where a sign-in goes). */
  async isLiveRefreshToken(refreshToken: string | undefined): Promise<boolean> {
    if (!refreshToken) return false;
    const s = await this.prisma.session.findUnique({ where: { refreshTokenHash: sha256(refreshToken) }, select: { revokedAt: true, expiresAt: true } });
    return Boolean(s && !s.revokedAt && s.expiresAt > new Date());
  }

  /** Revokes the sessions behind these refresh tokens (replaced or evicted tab accounts, sign out of all). */
  async revokeRefreshTokens(tokens: (string | undefined)[], reason: string): Promise<void> {
    const hashes = tokens.filter((t): t is string => Boolean(t)).map(sha256);
    if (!hashes.length) return;
    const sessions = await this.prisma.session.findMany({ where: { refreshTokenHash: { in: hashes }, revokedAt: null }, select: { id: true } });
    if (!sessions.length) return;
    await this.prisma.session.updateMany({ where: { id: { in: sessions.map((x) => x.id) }, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
    for (const x of sessions) this.authContext.invalidateSession(x.id);
  }

  async logout(sessionId: string | null, refreshToken: string | undefined): Promise<void> {
    const where = sessionId ? { id: sessionId } : refreshToken ? { refreshTokenHash: sha256(refreshToken) } : null;
    if (!where) return;
    const session = await this.prisma.session.findFirst({ where: { ...where, revokedAt: null } });
    if (!session) return;
    await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokedReason: 'LOGOUT' } });
    this.authContext.invalidateSession(session.id);
  }

  // ───────────────────────── Login ─────────────────────────

  async login(identifier: string, password: string, meta: RequestMeta): Promise<IssuedTokens> {
    const id = identifier.trim().toLowerCase();
    const phone = normalizePhone(id);
    const user = await this.prisma.user.findFirst({
      where: { deletedAt: null, OR: [{ email: id }, ...(phone ? [{ phone }] : [])] },
    });
    const invalid = () => new UnauthorizedException({ message: 'Incorrect email/mobile or password', code: 'INVALID_CREDENTIALS' });

    if (!user || !user.passwordHash) {
      await verifyPassword(await dummyPasswordHash(), password); // equalise timing
      throw invalid();
    }
    await this.reservePasswordGuess(user.id, meta.ip);
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      // The guess stays counted; whichever failed guess reaches the limit starts the lock.
      const locked = await this.lockIfLimitReached(user.id, meta.ip);
      await this.audit.log({ actorId: user.id, actorIp: meta.ip, action: 'auth.login_failed', entityType: 'User', entityId: user.id, metadata: { locked } });
      throw invalid();
    }
    // The right password proves who this is: clear the failure count (including this attempt).
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, ...(user.status === 'ACTIVE' ? { lastLoginAt: new Date() } : {}) },
    });
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException({ message: 'This account is not active. Contact support.', code: 'ACCOUNT_INACTIVE' });
    }
    const tokens = await this.createSession(user.id, meta);
    await this.audit.log({ actorId: user.id, actorIp: meta.ip, action: 'auth.login', entityType: 'User', entityId: user.id });
    return tokens;
  }

  // ───────────────────────── Registration ─────────────────────────

  /**
   * Reserves one password guess for this account BEFORE the password is checked, in one atomic
   * conditional update: however many requests arrive in parallel, an account gets at most
   * MAX_FAILED_LOGINS guesses per lock window. Throws ACCOUNT_LOCKED when no guess is left.
   */
  private async reservePasswordGuess(userId: string, actorIp: string | null): Promise<void> {
    const now = new Date();
    const reserved = await this.prisma.user.updateMany({
      where: { id: userId, failedLoginCount: { lt: MAX_FAILED_LOGINS }, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
      data: { failedLoginCount: { increment: 1 }, lockedUntil: null },
    });
    if (!reserved.count) throw await this.accountLocked(userId, actorIp);
  }

  /** Starts the lock when failed guesses reached the limit (idempotent across parallel requests); audited. */
  private async lockIfLimitReached(userId: string, actorIp: string | null): Promise<boolean> {
    const res = await this.prisma.user.updateMany({
      where: { id: userId, failedLoginCount: { gte: MAX_FAILED_LOGINS } },
      data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) },
    });
    if (res.count) await this.audit.log({ actorId: userId, actorIp, action: 'auth.account_locked', entityType: 'User', entityId: userId, metadata: { minutes: LOCK_MINUTES } });
    return res.count > 0;
  }

  /** The error for a guess that could not be reserved: the account is locked (or about to be). */
  private async accountLocked(userId: string, actorIp: string | null): Promise<ForbiddenException> {
    await this.lockIfLimitReached(userId, actorIp); // limit reached by guesses still in flight
    const current = await this.prisma.user.findUnique({ where: { id: userId }, select: { lockedUntil: true } });
    const now = Date.now();
    const until = current?.lockedUntil && current.lockedUntil.getTime() > now ? current.lockedUntil.getTime() : now + LOCK_MINUTES * 60_000;
    const minutes = Math.min(LOCK_MINUTES, Math.max(1, Math.ceil((until - now) / 60_000)));
    return new ForbiddenException({
      message: `Too many failed attempts. For your security, sign-in is paused for ${minutes} minute${minutes === 1 ? '' : 's'}. You can also reset your password with “Forgot password?”.`,
      code: 'ACCOUNT_LOCKED',
    });
  }

  private async assertIdentityAvailable(email: string, phone: string | null, db: Tx | PrismaService = this.prisma): Promise<void> {
    const existing = await db.user.findFirst({ where: { OR: [{ email }, ...(phone ? [{ phone }] : [])] }, select: { email: true, phone: true } });
    if (existing) {
      throw new ConflictException({
        message: existing.email === email ? 'An account with this email already exists' : 'An account with this mobile number already exists',
        code: 'IDENTITY_TAKEN',
      });
    }
  }

  async registerCustomer(input: z.output<typeof customerRegisterSchema>, meta: RequestMeta): Promise<IssuedTokens> {
    const email = input.email.toLowerCase();
    const phone = normalizePhone(input.phone);
    await this.assertIdentityAvailable(email, phone);
    const user = await this.prisma.user.create({
      data: { email, phone, fullName: input.fullName, passwordHash: await hashPassword(input.password), accountType: 'CUSTOMER' },
    });
    await this.audit.log({ actorId: user.id, actorIp: meta.ip, action: 'auth.register', entityType: 'User', entityId: user.id, metadata: { accountType: 'CUSTOMER' } });
    await this.sendEmailVerification(user.id, env().WEB_PUBLIC_URL);
    return this.createSession(user.id, meta);
  }

  /** Broker / developer / individual owner self-registration — creates a PENDING organisation for admin verification. */
  async registerPartner(input: z.output<typeof partnerRegisterSchema>, meta: RequestMeta): Promise<IssuedTokens> {
    const email = input.email.toLowerCase();
    const phone = normalizePhone(input.phone);
    await this.assertIdentityAvailable(email, phone);
    const passwordHash = await hashPassword(input.password);
    const city = await this.prisma.city.findUnique({ where: { id: input.cityId }, select: { id: true, isActive: true } });
    if (!city) throw new BadRequestException({ message: 'Select a valid city', details: [{ path: 'cityId', message: 'Unknown city' }] });

    const roleKey = input.partnerType === 'BROKERAGE' ? 'BROKER' : input.partnerType === 'DEVELOPER' ? 'DEVELOPER' : 'OWNER';
    const accountType = input.partnerType === 'BROKERAGE' ? 'BROKER' : input.partnerType === 'DEVELOPER' ? 'DEVELOPER' : 'OWNER';
    const orgName = input.partnerType === 'INDIVIDUAL_OWNER' ? input.fullName : input.organizationName!;

    const result = await this.prisma.$transaction(async (tx) => {
      const role = await tx.role.findUnique({ where: { key: roleKey } });
      if (!role) throw new Error(`System role ${roleKey} missing — run the seed`);
      const slug = await uniqueSlug(orgName, async (s) => (await tx.organization.count({ where: { slug: s } })) > 0);
      const user = await tx.user.create({ data: { email, phone, fullName: input.fullName, passwordHash, accountType } });
      const org = await tx.organization.create({
        data: {
          name: orgName,
          slug,
          type: input.partnerType,
          status: 'PENDING',
          verificationStatus: 'PENDING',
          email,
          phone,
          website: input.website || null,
          addressLine: input.businessAddress,
          cityId: input.cityId,
          pincode: input.pincode || null,
          gstin: input.gstin || null,
          reraRegistrationNo: input.reraNumber || null,
          description: input.about || null,
        },
      });
      await tx.organizationMember.create({ data: { organizationId: org.id, userId: user.id, isOwner: true, title: 'Owner' } });
      await tx.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: org.id } });
      if (input.partnerType === 'BROKERAGE') {
        await tx.brokerProfile.create({
          data: {
            userId: user.id,
            organizationId: org.id,
            displayName: input.fullName,
            reraAgentNumber: input.reraNumber || null,
            experienceYears: input.experienceYears ?? null,
            about: input.about || null,
            verificationStatus: 'PENDING',
          },
        });
      } else if (input.partnerType === 'DEVELOPER') {
        await tx.developerProfile.create({ data: { organizationId: org.id, about: input.about || null } });
      }
      await this.audit.log({ actorId: user.id, actorIp: meta.ip, action: 'partner.register', entityType: 'Organization', entityId: org.id, organizationId: org.id, after: { type: org.type, name: org.name } }, tx);

      const permission = input.partnerType === 'DEVELOPER' ? 'developer.verify' : 'broker.verify';
      const reviewers = await this.notifications.recipientsWithPermission(permission, null);
      const outbox = await this.notifications.notify(
        {
          eventKey: 'partner.registered',
          recipients: reviewers,
          channels: ['IN_APP', 'EMAIL'],
          data: { organizationName: org.name, partnerType: input.partnerType.replace('_', ' ').toLowerCase() },
          link: `${env().CONSOLE_PUBLIC_URL}/admin/partners/${org.id}`,
          relatedType: 'Organization',
          relatedId: org.id,
        },
        tx,
      );
      const tokens = await this.createSession(user.id, meta, tx);
      return { tokens, outbox, userId: user.id };
    });
    this.notifications.kick(result.outbox);
    await this.sendEmailVerification(result.userId, env().CONSOLE_PUBLIC_URL);
    return result.tokens;
  }

  async registerLeadProvider(input: z.output<typeof leadProviderRegisterSchema>, meta: RequestMeta): Promise<IssuedTokens> {
    const email = input.email.toLowerCase();
    const phone = normalizePhone(input.phone);
    await this.assertIdentityAvailable(email, phone);
    const passwordHash = await hashPassword(input.password);
    const tokens = await this.prisma.$transaction(async (tx) => {
      const role = await tx.role.findUniqueOrThrow({ where: { key: 'LEAD_PROVIDER' } });
      const slug = await uniqueSlug(input.organizationName, async (s) => (await tx.organization.count({ where: { slug: s } })) > 0);
      const user = await tx.user.create({ data: { email, phone, fullName: input.fullName, passwordHash, accountType: 'LEAD_PROVIDER' } });
      const org = await tx.organization.create({
        data: { name: input.organizationName, slug, type: 'LEAD_PROVIDER', status: 'PENDING', verificationStatus: 'PENDING', email, phone },
      });
      await tx.organizationMember.create({ data: { organizationId: org.id, userId: user.id, isOwner: true, title: 'Owner' } });
      await tx.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: org.id } });
      await tx.leadProvider.create({ data: { organizationId: org.id, name: input.organizationName, contactName: input.fullName, email, phone } });
      await this.audit.log({ actorId: user.id, actorIp: meta.ip, action: 'lead_provider.register', entityType: 'Organization', entityId: org.id, organizationId: org.id }, tx);
      return this.createSession(user.id, meta, tx);
    });
    return tokens;
  }

  // ───────────────────────── Verification & passwords ─────────────────────────

  async sendEmailVerification(userId: string, baseUrl: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.email || user.emailVerifiedAt) return;
    const token = randomToken(32);
    await this.prisma.verificationToken.create({
      data: { userId, type: 'EMAIL_VERIFY', target: user.email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 24 * 3_600_000) },
    });
    await this.notifications.send({
      eventKey: 'auth.verify_email',
      recipients: [{ userId, email: user.email, name: user.fullName }],
      channels: ['EMAIL'],
      data: {},
      link: `${baseUrl}/verify-email?token=${token}`,
      relatedType: 'User',
      relatedId: userId,
    });
  }

  async verifyEmail(token: string): Promise<{ verified: boolean }> {
    const row = await this.prisma.verificationToken.findFirst({ where: { tokenHash: sha256(token), type: 'EMAIL_VERIFY', consumedAt: null } });
    if (!row || row.expiresAt < new Date() || !row.userId) throw new BadRequestException({ message: 'This verification link is invalid or has expired', code: 'TOKEN_INVALID' });
    await this.prisma.$transaction([
      this.prisma.verificationToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } }),
      this.prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } }),
    ]);
    this.authContext.invalidateUser(row.userId);
    return { verified: true };
  }

  /** Always succeeds from the caller's perspective (no account enumeration). */
  async forgotPassword(email: string, baseUrl: string, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { email: email.toLowerCase(), deletedAt: null, status: 'ACTIVE' }, select: { id: true } });
    if (!user) return;
    await this.issuePasswordReset(user.id, { baseUrl, meta });
  }

  /**
   * Emails a single-use, 60-minute password-reset link to the account's own address. The token is never
   * returned to the caller, so an administrator requesting it for someone else never sees the link.
   * At most 3 links per account per 15 minutes.
   */
  async issuePasswordReset(userId: string, opts: { baseUrl?: string; meta: RequestMeta; requestedById?: string }): Promise<'SENT' | 'NO_EMAIL' | 'NOT_ACTIVE' | 'RATE_LIMITED'> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, fullName: true, status: true, deletedAt: true, accountType: true } });
    if (!user || user.deletedAt || user.status !== 'ACTIVE') return 'NOT_ACTIVE';
    if (!user.email) return 'NO_EMAIL';
    const recent = await this.prisma.verificationToken.count({
      where: { userId: user.id, type: 'PASSWORD_RESET', createdAt: { gte: new Date(Date.now() - 15 * 60_000) } },
    });
    if (recent >= 3) return 'RATE_LIMITED';
    const baseUrl = (opts.baseUrl ?? (user.accountType === 'CUSTOMER' ? env().WEB_PUBLIC_URL : env().CONSOLE_PUBLIC_URL)).replace(/[/]$/, '');
    const token = randomToken(32);
    await this.prisma.verificationToken.create({
      data: { userId: user.id, type: 'PASSWORD_RESET', target: user.email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60_000) },
    });
    await this.audit.log({
      actorId: opts.requestedById ?? user.id,
      actorIp: opts.meta.ip,
      action: 'auth.password_reset_requested',
      entityType: 'User',
      entityId: user.id,
      metadata: opts.requestedById && opts.requestedById !== user.id ? { requestedByAdministrator: true } : undefined,
    });
    await this.notifications.send({
      eventKey: 'auth.password_reset',
      recipients: [{ userId: user.id, email: user.email, name: user.fullName }],
      channels: ['EMAIL'],
      data: {},
      link: `${baseUrl}/reset-password?token=${token}`,
      relatedType: 'User',
      relatedId: user.id,
    });
    return 'SENT';
  }

  async resetPassword(token: string, password: string, meta: RequestMeta): Promise<void> {
    const row = await this.prisma.verificationToken.findFirst({ where: { tokenHash: sha256(token), type: 'PASSWORD_RESET', consumedAt: null } });
    if (!row || row.expiresAt < new Date() || !row.userId) throw new BadRequestException({ message: 'This reset link is invalid or has expired', code: 'TOKEN_INVALID' });
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.verificationToken.update({ where: { id: row.id }, data: { consumedAt: now } }),
      this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(password), passwordChangedAt: now, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null } }),
      this.prisma.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now, revokedReason: 'PASSWORD_RESET' } }),
    ]);
    this.authContext.invalidateUser(row.userId);
    await this.audit.log({ actorId: row.userId, actorIp: meta.ip, action: 'auth.password_reset', entityType: 'User', entityId: row.userId });
  }

  async changePassword(user: AuthUser, input: z.output<typeof changePasswordSchema>, meta: RequestMeta): Promise<void> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    // Compared before the password check, so this answer reveals nothing about the current password.
    if (input.currentPassword === input.newPassword) {
      throw new BadRequestException({ message: 'Choose a password different from the current one', details: [{ path: 'newPassword', message: 'Same as the current password' }] });
    }
    if (!row.passwordHash) {
      throw new BadRequestException({ message: 'Current password is incorrect', details: [{ path: 'currentPassword', message: 'Incorrect password' }] });
    }
    // A guess budget per SESSION (not the account-wide sign-in lock, which outsiders can trigger): a stolen
    // session gets MAX_FAILED_LOGINS guesses at the current password, then it is signed out.
    const reserved = await this.prisma.session.updateMany({
      where: { id: user.sessionId, revokedAt: null, OR: [{ passwordChecks: { lt: MAX_FAILED_LOGINS } }, { passwordChecks: { isSet: false } }] },
      data: { passwordChecks: { increment: 1 } },
    });
    if (!reserved.count) {
      await this.logout(user.sessionId, undefined);
      throw new UnauthorizedException({ message: 'Too many incorrect current-password attempts. Sign in again.', code: 'SESSION_INVALID' });
    }
    if (!(await verifyPassword(row.passwordHash, input.currentPassword))) {
      await this.audit.log({ actorId: user.id, actorIp: meta.ip, action: 'auth.password_change_failed', entityType: 'User', entityId: user.id });
      throw new BadRequestException({ message: 'Current password is incorrect', details: [{ path: 'currentPassword', message: 'Incorrect password' }] });
    }
    await this.prisma.session.update({ where: { id: user.sessionId }, data: { passwordChecks: 0 } });
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.newPassword), passwordChangedAt: now, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null } }),
      this.prisma.session.updateMany({ where: { userId: user.id, revokedAt: null, id: { not: user.sessionId } }, data: { revokedAt: now, revokedReason: 'PASSWORD_CHANGED' } }),
    ]);
    this.authContext.invalidateUser(user.id);
    await this.audit.log({ actorId: user.id, actorIp: meta.ip, action: 'auth.password_changed', entityType: 'User', entityId: user.id });
  }

  /**
   * Emails a password an administrator has just set. Delivery is attempted immediately so the administrator
   * learns the outcome; the stored copy of the message is wiped once delivery finishes (see notifications).
   */
  async emailTemporaryPassword(target: { id: string; email: string; fullName: string; accountType: string }, password: string, administrator: AuthUser): Promise<'SENT' | 'QUEUED' | 'FAILED' | 'NOT_CONFIGURED'> {
    const base = (target.accountType === 'CUSTOMER' ? env().WEB_PUBLIC_URL : env().CONSOLE_PUBLIC_URL).replace(/[/]$/, '');
    const ids = await this.notifications.notify({
      eventKey: 'auth.password_set_by_admin',
      recipients: [{ userId: target.id, email: target.email, name: target.fullName }],
      channels: ['EMAIL'],
      data: { password, administrator: administrator.fullName },
      link: `${base}/login`,
      relatedType: 'User',
      relatedId: target.id,
    });
    if (!ids.length) return 'NOT_CONFIGURED';
    const status = await this.notifications.deliver(ids[0]);
    return status === 'SENT' || status === 'FAILED' || status === 'NOT_CONFIGURED' ? status : 'QUEUED';
  }

  /** Self-service profile: display name and profile photo (PATCH semantics — only the fields sent change). */
  async updateProfile(user: AuthUser, input: Partial<z.output<typeof profileUpdateSchema>>, meta: RequestMeta): Promise<SessionUser> {
    const data: { fullName?: string; avatarUrl?: string | null } = {};
    if (input.fullName !== undefined) data.fullName = input.fullName;
    if (input.avatarFileId === null) data.avatarUrl = null;
    else if (input.avatarFileId !== undefined) {
      const file = await this.prisma.storedFile.findUnique({ where: { id: input.avatarFileId }, select: { purpose: true, uploadedById: true, deletedAt: true } });
      if (!file || file.deletedAt || file.purpose !== 'avatar' || file.uploadedById !== user.id) {
        throw new BadRequestException({ message: 'Upload the photo first', details: [{ path: 'avatarFileId', message: 'Invalid photo' }] });
      }
      data.avatarUrl = (await this.files.publicUrlFor(input.avatarFileId, user)).url;
    }
    if (Object.keys(data).length) {
      const before = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { fullName: true, avatarUrl: true } });
      await this.prisma.user.update({ where: { id: user.id }, data });
      this.authContext.invalidateUser(user.id);
      await this.audit.log({ actorId: user.id, actorIp: meta.ip, action: 'user.profile.update', entityType: 'User', entityId: user.id, before, after: data });
    }
    return this.sessionUser(user);
  }

  // ───────────────────────── Session user ─────────────────────────

  async sessionUser(user: AuthUser): Promise<SessionUser> {
    // Profile fields are read fresh, so a just-saved name or photo is returned immediately.
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { fullName: true, email: true, phone: true, avatarUrl: true, emailVerifiedAt: true, phoneVerifiedAt: true, mustChangePassword: true } });
    return {
      id: user.id,
      fullName: row.fullName,
      email: row.email,
      phone: row.phone,
      avatarUrl: row.avatarUrl,
      accountType: user.accountType,
      emailVerified: Boolean(row.emailVerifiedAt),
      phoneVerified: Boolean(row.phoneVerifiedAt),
      memberships: user.memberships,
      roles: user.roles.map((r) => ({ key: r.key, name: r.name, organizationId: r.organizationId })),
      permissions: user.permissionGrants,
      employeeId: user.employeeId,
      platformOrganizationId: user.platformOrganizationId,
      workspaces: user.workspaces,
      mustChangePassword: row.mustChangePassword,
    };
  }

  async listSessions(user: AuthUser) {
    const rows = await this.prisma.session.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, userAgent: true, ipAddress: true, createdAt: true, lastUsedAt: true },
    });
    return rows.map((r) => ({ ...r, current: r.id === user.sessionId }));
  }

  async revokeSession(user: AuthUser, sessionId: string): Promise<void> {
    const res = await this.prisma.session.updateMany({ where: { id: sessionId, userId: user.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'USER_REVOKED' } });
    if (res.count) this.authContext.invalidateSession(sessionId);
  }

  slugForOrg(name: string): string {
    return slugify(name);
  }
}
