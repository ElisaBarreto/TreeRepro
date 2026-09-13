// `pnpm seed:traits` — loads apps/api/seed/trait-dictionary.csv into the
// dictionary tables, inserting only what is missing (RFC-62 R2). Safe to run
// any number of times. Exit codes: 0 done, 1 error.
import { loadConfig } from '../config.ts';
import { dictionaryPath, seedDictionary } from '../dataset/seed.ts';
import { createDb } from '../db/client.ts';

const config = loadConfig();
const { db, close } = createDb(config.db.url.expose(), { max: 1 });
let exitCode = 0;
try {
  const path = dictionaryPath();
  const report = await seedDictionary(db, path);
  process.stdout.write(
    `Dictionary ${path}\nInserted ${report.categories} categories, ${report.traits} traits, ${report.levels} levels.\n`,
  );
} catch (err) {
  process.stderr.write(`${(err as Error).message}\n`);
  exitCode = 1;
} finally {
  await close();
}
process.exit(exitCode);
