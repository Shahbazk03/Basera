/**
 * Seed entry point.
 *   npm run db:seed                 → reference data + development demo data (non-production only)
 *   npm run db:seed -- --reference  → reference data only (safe for production)
 */
import { loadEnvFile } from '../src/config/env';
import { DbClient } from '../src/prisma/client';
import { ensureDatabaseRules } from '../src/prisma/database-rules';
import { seedReference } from './seed/reference';
import { seedDevelopment } from './seed/development';

async function main(): Promise<void> {
  loadEnvFile();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const prisma = new DbClient(url);
  const referenceOnly = process.argv.includes('--reference') || process.env.APP_ENV === 'production';
  try {
    for (const warning of await ensureDatabaseRules(prisma)) console.warn(`  ! ${warning}`); // indexes and validators the schema cannot declare
    console.log('Seeding reference data…');
    const ref = await seedReference(prisma);
    if (!referenceOnly) {
      console.log('Seeding development data…');
      await seedDevelopment(prisma, ref);
    }
    console.log('Seed complete.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
