import fs from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

/** Load the monorepo root `.env` (walk up from the current directory). Existing env vars win. */
function findEnvFile(start: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 5; i += 1) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  return undefined;
}

const envFile = findEnvFile(process.cwd());
if (envFile) loadEnv({ path: envFile, quiet: true });

// MongoDB has no Prisma Migrate: `prisma db push` keeps collections' indexes in sync with the schema.
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
});
