import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import sharp from 'sharp';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/common/crypto';
import type { AccountType, OrganizationType } from '../src/generated/prisma/client';

export const ORIGIN = 'http://localhost:3300';
export const PASSWORD = 'Integration-Test-1';

export interface TestContext {
  app: NestExpressApplication;
  prisma: PrismaService;
}

export async function createApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: ['error'] });
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

let seq = 0;
export function uniq(prefix: string): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq}`;
}

let passwordHash: Promise<string> | null = null;
function hashed(): Promise<string> {
  passwordHash ??= hashPassword(PASSWORD);
  return passwordHash;
}

export async function createOrg(prisma: PrismaService, opts: { type: OrganizationType; status?: 'ACTIVE' | 'PENDING' | 'SUSPENDED'; name?: string }) {
  const name = opts.name ?? uniq(`${opts.type.toLowerCase()}-`);
  return prisma.organization.create({
    data: {
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      type: opts.type,
      status: opts.status ?? 'ACTIVE',
      verificationStatus: (opts.status ?? 'ACTIVE') === 'ACTIVE' ? 'VERIFIED' : 'PENDING',
    },
  });
}

/** Creates a user with an optional role grant (organizationId null = platform-wide). */
export async function createUser(prisma: PrismaService, opts: { roleKey?: string; organizationId?: string | null; memberOf?: string; accountType?: AccountType; email?: string } = {}) {
  const email = (opts.email ?? `${uniq('user')}@example.test`).toLowerCase();
  const user = await prisma.user.create({ data: { email, fullName: `Test ${email.split('@')[0]}`, passwordHash: await hashed(), accountType: opts.accountType ?? 'STAFF', emailVerifiedAt: new Date() } });
  if (opts.memberOf) await prisma.organizationMember.create({ data: { organizationId: opts.memberOf, userId: user.id, isOwner: true } });
  if (opts.roleKey) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: opts.roleKey } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: opts.organizationId ?? null } });
  }
  return user;
}

/** Logged-in supertest agent (cookie jar) — every state-changing call must send the allowed Origin. */
export async function loginAgent(ctx: TestContext, email: string) {
  const agent = request.agent(ctx.app.getHttpServer());
  const res = await agent.post('/api/v1/auth/login').set('Origin', ORIGIN).send({ identifier: email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

export async function tinyPng(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 20, g: 120, b: 110 } } }).png().toBuffer();
}

export async function lucknowRefs(prisma: PrismaService) {
  const city = await prisma.city.findUniqueOrThrow({ where: { slug: 'lucknow' } });
  const locality = await prisma.locality.findFirstOrThrow({ where: { cityId: city.id, slug: 'gomti-nagar' } });
  const apartment = await prisma.propertyType.findUniqueOrThrow({ where: { slug: 'apartment' } });
  const plot = await prisma.propertyType.findUniqueOrThrow({ where: { slug: 'residential-plot' } });
  return { city, locality, apartment, plot };
}

export function cookieValue(setCookie: string[] | string | undefined, name: string): string | undefined {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const hit = list.find((c) => c.startsWith(`${name}=`));
  return hit ? hit.split(';')[0].slice(name.length + 1) : undefined;
}
