import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findEnforcedPermissions,
  findGates,
  GATE_EXEMPT_KEYS,
  lintGates,
  loadPermissionCatalog,
} from './gates.ts';

function makeTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rfc-lint-gates-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

const CATALOG_MD = [
  '# RFC-30',
  '',
  '## Catalog',
  '',
  '| Key | Description |',
  '|---|---|',
  '| `users.read` | List and view users |',
  '| `admin.access` | Open the admin area |',
  '| `dataset.read` | Browse |',
  '| `dataset.read_inactive` | See inactive rows |',
  '| `users.invite` | Invite users |',
  '| `users.suspend` | Suspend users |',
  '',
].join('\n');

describe('RFC-32 R8 findGates', () => {
  it('reads every shape the SPA uses to test a permission', () => {
    const src = [
      "if (!hasPermission(me, 'users.read')) return null;",
      "if (!hasPermission(useMe(), 'admin.access')) return <NoPermission />;",
      'const canRead = hasPermission(',
      '  me,',
      "  'dataset.read',",
      ');',
      "  { to: '/app/traits', label: 'Traits', permission: 'dataset.read', section: 'data' },",
      "canReadCoverage={me.permissions.includes('coverage.read')}",
      'const visible = NAV_ENTRIES.filter((e) => !e.permission || hasPermission(me, e.permission));',
      "hasPermission(me, 'users.invite')",
    ].join('\n');
    expect(findGates(src)).toEqual([
      { line: 1, key: 'users.read' },
      { line: 2, key: 'admin.access' },
      { line: 3, key: 'dataset.read' },
      { line: 7, key: 'dataset.read' },
      { line: 8, key: 'coverage.read' },
      { line: 10, key: 'users.invite' },
    ]);
  });

  it('ignores a gate quoted in a comment and keeps the line numbers', () => {
    const src = [
      "// hasPermission(me, 'users.delete') used to sit here",
      '/*',
      " * permission: 'users.delete'",
      ' */',
      "const url = 'https://example.org'; hasPermission(me, 'users.read'); // permissions.includes('users.delete')",
    ].join('\n');
    expect(findGates(src)).toEqual([{ line: 5, key: 'users.read' }]);
  });

  it('keeps two gates on one line apart', () => {
    const src = "hasPermission(me, 'a.b') && hasPermission(me, 'c.d')";
    expect(findGates(src).map((g) => g.key)).toEqual(['a.b', 'c.d']);
  });
});

describe('RFC-32 R8 findEnforcedPermissions', () => {
  it('reads the key of every requirePermission guard and every check on the resolved set', () => {
    const src = [
      "  .get('/', requirePermission(ctx, 'dataset.read'), async (c) => {",
      '  .post(',
      "    '/',",
      "    requirePermission(ctx, 'plots.manage'),",
      '    requirePermission(',
      '      ctx,',
      "      'users.read',",
      '    ),',
      "  canWithdrawAny: currentPermissions(c).has('records.withdraw'),",
      "  inactive: permissions.has('dataset.read_inactive'),",
    ].join('\n');
    expect([...findEnforcedPermissions(src)]).toEqual([
      'dataset.read',
      'plots.manage',
      'users.read',
      'records.withdraw',
      'dataset.read_inactive',
    ]);
  });

  it('counts no receiver but the resolved set, and nothing quoted in a comment or a string', () => {
    const src = [
      "  if (rolePermissions.has('users.read')) return;",
      "  if (viewer.permissions.has('users.invite')) return;",
      "  if (seen.has('taxa.manage')) return;",
      "  // permissions.has('users.delete') was checked here once",
      "  /* requirePermission(ctx, 'users.suspend') */",
      '  log.info("permissions.has(\'sessions.read\')");',
      "  const why = `requirePermission(ctx, 'sessions.revoke')`;",
      "  const re = /'/; permissions.has('audit.read');",
    ].join('\n');
    expect([...findEnforcedPermissions(src)]).toEqual(['audit.read']);
  });
});

describe('RFC-32 R8 loadPermissionCatalog', () => {
  it('parses the catalog table of RFC-30', () => {
    const dir = makeTree({ 'docs/rfc/30-access/30-permission-catalog.md': CATALOG_MD });
    expect([...loadPermissionCatalog(join(dir, 'docs/rfc'))]).toEqual([
      'users.read',
      'admin.access',
      'dataset.read',
      'dataset.read_inactive',
      'users.invite',
      'users.suspend',
    ]);
  });

  it('refuses an RFC-30 without a catalog', () => {
    const dir = makeTree({ 'docs/rfc/30-access/30-permission-catalog.md': '# RFC-30\n' });
    expect(() => loadPermissionCatalog(join(dir, 'docs/rfc'))).toThrow(/catalog/);
  });
});

describe('RFC-32 R8 lintGates', () => {
  const base = {
    'docs/rfc/30-access/30-permission-catalog.md': CATALOG_MD,
    'apps/api/src/http/routes/admin/users.ts': "requirePermission(ctx, 'users.read')\n",
    'apps/api/src/http/routes/dataset/species.ts': "requirePermission(ctx, 'dataset.read')\n",
    'apps/api/src/access/visibility.ts': "inactive: permissions.has('dataset.read_inactive'),\n",
  };
  const options = (dir: string) => ({
    webSrc: join(dir, 'apps/web/src'),
    apiSrc: join(dir, 'apps/api/src'),
    rfcDir: join(dir, 'docs/rfc'),
    displayRoot: dir,
  });

  it('passes when every SPA gate is a catalog key the API enforces', () => {
    const dir = makeTree({
      ...base,
      'apps/web/src/pages/A.tsx': [
        "hasPermission(me, 'users.read')",
        "hasPermission(useMe(), 'admin.access')",
        "hasPermission(me, 'dataset.read_inactive')",
        "permission: 'dataset.read'",
      ].join('\n'),
    });
    expect(lintGates(options(dir))).toEqual([]);
  });

  it('flags a key outside the catalog', () => {
    const dir = makeTree({
      ...base,
      'apps/web/src/pages/A.tsx':
        "hasPermission(me, 'admin.access')\nhasPermission(me, 'users.reed')\n",
    });
    expect(lintGates(options(dir))).toEqual([
      {
        file: 'apps/web/src/pages/A.tsx',
        line: 2,
        message: 'SPA gate "users.reed" is not a permission of the RFC-30 catalog',
      },
    ]);
  });

  it('flags a key the API never checks', () => {
    const dir = makeTree({
      ...base,
      'apps/web/src/pages/A.tsx':
        "hasPermission(me, 'admin.access')\nhasPermission(me, 'users.read')\n",
      'apps/api/src/http/routes/admin/users.ts': "requirePermission(ctx, 'users.invite')\n",
    });
    expect(lintGates(options(dir))).toEqual([
      {
        file: 'apps/web/src/pages/A.tsx',
        line: 2,
        message:
          'SPA gate "users.read" names a permission the API never checks (no requirePermission or permissions.has of it under apps/api/src)',
      },
    ]);
  });

  it('does not take a .has on another receiver, or one quoted in a string, as enforcement', () => {
    const dir = makeTree({
      ...base,
      'apps/web/src/pages/A.tsx':
        "hasPermission(me, 'admin.access')\nhasPermission(me, 'users.invite')\nhasPermission(me, 'users.suspend')\n",
      'apps/api/src/access/roles.ts':
        "if (rolePermissions.has('users.invite')) grant();\nlog.info(\"permissions.has('users.suspend')\");\n",
    });
    expect(lintGates(options(dir)).map((v) => `${v.file}:${v.line}: ${v.message}`)).toEqual([
      'apps/web/src/pages/A.tsx:2: SPA gate "users.invite" names a permission the API never checks (no requirePermission or permissions.has of it under apps/api/src)',
      'apps/web/src/pages/A.tsx:3: SPA gate "users.suspend" names a permission the API never checks (no requirePermission or permissions.has of it under apps/api/src)',
    ]);
  });

  it('accepts a key the API tests inside a handler rather than as a guard', () => {
    const dir = makeTree({
      ...base,
      'apps/web/src/pages/A.tsx':
        "hasPermission(me, 'admin.access')\nhasPermission(me, 'dataset.read_inactive')\n",
    });
    expect(lintGates(options(dir))).toEqual([]);
  });

  it('flags an exception the SPA no longer tests', () => {
    const dir = makeTree({
      ...base,
      'apps/web/src/pages/A.tsx': "hasPermission(me, 'users.read')\n",
    });
    expect(lintGates(options(dir))).toEqual([
      {
        file: 'apps/web/src',
        line: 0,
        message:
          'RFC-32 R8 exempts "admin.access" from the cross-check, but the SPA no longer tests it (drop it from GATE_EXEMPT_KEYS and from the rule)',
      },
    ]);
  });

  it('skips test files and reads .ts and .tsx alike', () => {
    const dir = makeTree({
      ...base,
      'apps/web/src/lib/session.test.ts': "hasPermission(me, 'not.real')\n",
      'apps/web/src/lib/nav.ts': "permission: 'dataset.read'\nhasPermission(me, 'admin.access')\n",
    });
    expect(lintGates(options(dir))).toEqual([]);
  });

  it('names the one exception of RFC-32 R8 and nothing else', () => {
    expect([...GATE_EXEMPT_KEYS]).toEqual(['admin.access']);
  });
});
