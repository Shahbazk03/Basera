/**
 * Creates (or promotes) the first Super Admin in any environment.
 *   ADMIN_EMAIL=owner@brand.in ADMIN_NAME="Owner Name" ADMIN_PASSWORD='…' npm run admin:create -w @estate/api
 * Requires reference data (permissions/roles/platform organisation) — run `npm run db:seed` first
 * (in production that seeds reference data only).
 * Safe to run on every start-up: an existing Super Admin is left untouched (their password is NOT reset)
 * unless ADMIN_RESET_PASSWORD=true.
 */
import { hash } from '@node-rs/argon2';
import { passwordSchema } from '@estate/shared';
import { loadEnvFile } from '../src/config/env';
import { DbClient } from '../src/prisma/client';

async function main(): Promise<void> {
  loadEnvFile();
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.ADMIN_NAME?.trim();
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (!email || !name) throw new Error('Set ADMIN_EMAIL and ADMIN_NAME');
  const strong = passwordSchema.safeParse(password);
  if (!strong.success) throw new Error(`ADMIN_PASSWORD is too weak: ${strong.error.issues[0].message}`);

  const prisma = new DbClient(process.env.DATABASE_URL!);
  try {
    const role = await prisma.role.findUnique({ where: { key: 'SUPER_ADMIN' } });
    const platform = await prisma.organization.findFirst({ where: { type: 'PLATFORM' } });
    if (!role || !platform) throw new Error('Reference data missing — run the seed first');
    const current = await prisma.user.findFirst({ where: { email }, select: { id: true, userRoles: { where: { roleId: role.id, organizationId: null }, select: { id: true } } } });
    if (current?.userRoles.length && process.env.ADMIN_RESET_PASSWORD !== 'true') {
      console.log(`Super Admin ${email} already exists — left unchanged (set ADMIN_RESET_PASSWORD=true to reset the password).`);
      return;
    }
    const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    // email is unique through a partial index (users without an email are allowed), so no Prisma upsert by email.
    const user = current
      ? await prisma.user.update({ where: { id: current.id }, data: { fullName: name, passwordHash, status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null } })
      : await prisma.user.create({ data: { email, fullName: name, passwordHash, accountType: 'STAFF', emailVerifiedAt: new Date() } });
    await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: platform.id, userId: user.id } },
      create: { organizationId: platform.id, userId: user.id, title: 'Owner' },
      update: { status: 'ACTIVE' },
    });
    const existing = await prisma.userRole.findFirst({ where: { userId: user.id, roleId: role.id, organizationId: null } });
    if (!existing) await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: null } });
    await prisma.auditLog.create({ data: { actorId: user.id, action: 'admin.bootstrap', entityType: 'User', entityId: user.id, metadata: { via: 'create-admin script' } } });
    console.log(`Super Admin ready: ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
