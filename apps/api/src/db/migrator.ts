import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/** @rfc RFC-10 R7 */
export function migrationsFolder(): string {
  return fileURLToPath(new URL('../../drizzle', import.meta.url));
}

/** @rfc RFC-10 R7 */
export async function runMigrations(url: string, folder = migrationsFolder()): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(client), { migrationsFolder: folder });
  } finally {
    await client.end();
  }
}
