import { readFile } from 'node:fs/promises';
import { phylogenyFileParamSchema, phylogenyFileQuerySchema } from '@treerepro/contracts';
import { Hono } from 'hono';
import { visibilityOf } from '../../../access/visibility.ts';
import type { AuthContext } from '../../../auth/context.ts';
import { figurePath, listFigures } from '../../../phylogenies/figures.ts';
import type { AppEnv } from '../../env.ts';
import { AppError } from '../../errors.ts';
import { requirePermission } from '../../middleware/require-permission.ts';
import { validate } from '../../validate.ts';

/**
 * The phylogeny figures: the list a viewer may see and one figure's file. A key
 * is looked up in that list and never used as a path otherwise.
 * @rfc RFC-79 R2, R3
 */
export function phylogenyRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .get('/', requirePermission(ctx, 'dataset.read'), async (c) => {
      const visibility = await visibilityOf(ctx, c);
      return c.json({ data: await listFigures(ctx.db, visibility, ctx.phylogeniesDir) });
    })
    .get(
      '/files/:key',
      requirePermission(ctx, 'dataset.read'),
      validate('param', phylogenyFileParamSchema),
      validate('query', phylogenyFileQuerySchema),
      async (c) => {
        const visibility = await visibilityOf(ctx, c);
        const { key } = c.req.valid('param');
        const { size } = c.req.valid('query');
        const figures = await listFigures(ctx.db, visibility, ctx.phylogeniesDir);
        const figure = figures.find((f) => f.key === key);
        if (!figure) throw new AppError('PHYLOGENY_NOT_FOUND', 'Phylogeny not found');
        const path = figurePath(ctx.phylogeniesDir, visibility.platform, figure.key, size);
        c.header('Content-Type', size === 'full' ? 'image/png' : 'image/jpeg');
        c.header('Cache-Control', 'private, max-age=31536000, immutable');
        return c.body(await readFile(path));
      },
    );
}
