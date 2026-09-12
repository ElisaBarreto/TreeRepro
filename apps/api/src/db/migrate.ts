import { loadMigratorConfig } from '../config.ts';
import { runMigrations } from './migrator.ts';

await runMigrations(loadMigratorConfig(process.env).db.url.expose());
process.stdout.write('migrations applied\n');
