import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mapFileParamSchema } from '@treerepro/contracts';
import { Hono } from 'hono';
import { etag } from 'hono/etag';
import { visibilityOf } from '../../../access/visibility.ts';
import type { AuthContext } from '../../../auth/context.ts';
import { visibleMaps } from '../../../maps/visible.ts';
import type { AppEnv } from '../../env.ts';
import { AppError } from '../../errors.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { validate } from '../../validate.ts';

// The manifest admits only these two extensions (RFC-76 R1).
const CONTENT_TYPES: Record<string, string> = { svg: 'image/svg+xml', webp: 'image/webp' };

/**
 * The trait maps: the list a viewer may see and the files it names. A file name is
 * looked up in that list and never used as a path otherwise.
 * @rfc RFC-76 R4, R5
 */
export function mapRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .get('/', requirePermission(ctx, 'dataset.read'), async (c) => {
      const visibility = await visibilityOf(ctx, c);
      return c.json({ data: await visibleMaps(ctx.db, visibility, ctx.mapsDir) });
    })
    .get(
      '/files/:name',
      requirePermission(ctx, 'dataset.read'),
      validate('param', mapFileParamSchema),
      etag(),
      async (c) => {
        const visibility = await visibilityOf(ctx, c);
        const { name } = c.req.valid('param');
        const entry = (await visibleMaps(ctx.db, visibility, ctx.mapsDir)).find(
          (m) => m.file === name,
        );
        if (!entry) throw new AppError('MAP_NOT_FOUND', 'Map not found');
        const ext = entry.file.slice(entry.file.lastIndexOf('.') + 1);
        c.header('Content-Type', CONTENT_TYPES[ext]);
        c.header('Cache-Control', 'private, no-cache');
        return c.body(await readFile(join(ctx.mapsDir, entry.file)));
      },
    );
}
