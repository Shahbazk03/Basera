import { execSync } from 'node:child_process';
import path from 'node:path';
import { loadEnvFile } from '../src/config/env';
import { DbClient } from '../src/prisma/client';
import { ensureDatabaseRules } from '../src/prisma/database-rules';
import { seedReference } from '../prisma/seed/reference';

/**
 * Prepares the isolated integration-test database: drops it, recreates the collections and indexes
 * from the schema (`prisma db push`, exactly as production does), adds the indexes and validators the
 * schema cannot declare, and loads reference data.
 * Refuses to run against any database whose name does not end in "_test".
 */
export default async function globalSetup(): Promise<void> {
  loadEnvFile();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL must be set for integration tests');
  const dbName = new URL(url.replace(/^mongodb(\+srv)?:/, 'http:')).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to reset "${dbName}": the test database name must end with _test`);

  const prisma = new DbClient(url);
  try {
    await prisma.$runCommandRaw({ dropDatabase: 1 });
    execSync('npx prisma db push --skip-generate', {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });
    await ensureDatabaseRules(prisma);
    await seedReference(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
