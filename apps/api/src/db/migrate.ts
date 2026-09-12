import { loadMigratorConfig } from '../config.ts';
import { runMigrations } from './migrator.ts';

await runMigrations(loadMigratorConfig(process.env).db.url);
process.stdout.write('migrations applied\n');
