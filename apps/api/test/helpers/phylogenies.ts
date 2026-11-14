import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A phylogenies directory holding `files` (paths relative to it), each written with `mtime` ms. */
export function figuresDir(files: string[], mtime = 1_700_000_000_000): string {
  const dir = mkdtempSync(join(tmpdir(), 'phylo-'));
  for (const file of files) {
    const path = join(dir, file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, file);
    utimesSync(path, mtime / 1000, mtime / 1000);
  }
  return dir;
}

/** The PNG and display copy of `key` on `platform`. */
export const figure = (key: string, platform = 'treerepro') => [
  `${platform}/trait_${key}.png`,
  `${platform}/display/trait_${key}.jpg`,
];
