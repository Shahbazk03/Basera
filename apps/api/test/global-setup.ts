import { execSync } from 'node:child_process';
import path from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { loadEnvFile } from '../src/config/env';
import { PrismaClient } from '../src/generated/prisma/client';
import { seedReference } from '../prisma/seed/reference';

/**
 * Prepares the isolated integration-test database: wipes the schema, applies every migration
 * (`prisma migrate deploy`, exactly as production does) and loads reference data.
 * Refuses to run against any database whose name does not end in "_test".
 */
export default async function globalSetup(): Promise<void> {
  loadEnvFile();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL must be set for integration tests');
  const dbName = new URL(url.replace(/^postgresql:/, 'http:')).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to reset "${dbName}": the test database name must end with _test`);

  const client = new Client({ connectionString: url.replace(/[?&]schema=[^&]*/, '') });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.end();

  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await seedReference(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
