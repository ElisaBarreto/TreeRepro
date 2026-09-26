import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { useTestApp } from '../../test/helpers/app.ts';
import { buildOpenApi, openApiHash } from './openapi.ts';
import { defaultGuidePath } from './routes/docs.ts';

describe('RFC-82 R19 the guide pins the generated reference', () => {
  const t = useTestApp();
  it('the openapi-sha256 line matches the generated reference', async () => {
    const guide = await readFile(defaultGuidePath(), 'utf8');
    const pinned = /^openapi-sha256: ([0-9a-f]{64})\r?\n/.exec(guide)?.[1];
    const actual = openApiHash(buildOpenApi(t.app.routes));
    expect(
      pinned,
      `API surface changed: add a changelog entry to docs/api/guide.md and set its first line to "openapi-sha256: ${actual}" (CLAUDE.md rule 10)`,
    ).toBe(actual);
  });

  it('the newest changelog entry names the pinned hash (CLAUDE.md rule 10)', async () => {
    const guide = await readFile(defaultGuidePath(), 'utf8');
    const actual = openApiHash(buildOpenApi(t.app.routes));
    const changelog = guide.split(/^## Changelog\r?\n/m)[1] ?? '';
    const newestBullet = /^- .*$/m.exec(changelog)?.[0];
    expect(
      newestBullet,
      'docs/api/guide.md: add a changelog entry under ## Changelog for this change',
    ).toMatch(new RegExp(`\\(openapi ${actual.slice(0, 12)}\\)$`));
  });
});
