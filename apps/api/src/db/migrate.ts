import { z } from 'zod';
import { buildDbUrl, readSecret } from '../config.ts';
import { runMigrations } from './migrator.ts';

const env = z
  .object({
    DB_HOST: z.string().min(1),
    DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
    DB_NAME: z.string().min(1),
    DB_MIGRATOR_USER: z.string().min(1),
    SECRETS_DIR: z.string().min(1).default('/run/secrets'),
  })
  .parse(process.env);

await runMigrations(
  buildDbUrl({
    host: env.DB_HOST,
    port: env.DB_PORT,
    name: env.DB_NAME,
    user: env.DB_MIGRATOR_USER,
    password: readSecret(env.SECRETS_DIR, 'db_migrator_password'),
  }),
);
process.stdout.write('migrations applied\n');
