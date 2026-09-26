import { zValidator } from '@hono/zod-validator';
import type { MiddlewareHandler, ValidationTargets } from 'hono';
import type { z } from 'zod';
import { errorBody } from './errors.ts';

const JSON_CONTENT_TYPE = /^application\/json\b/i;

const schemas = new WeakMap<object, { target: keyof ValidationTargets; schema: z.ZodType }>();

/**
 * @rfc RFC-02 R2
 * @rfc RFC-11 R3, R7
 * @rfc RFC-82 R16
 */
export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  const inner = zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      }));
      return c.json(errorBody('VALIDATION_FAILED', 'Request validation failed', details), 400);
    }
  });
  schemas.set(inner, { target, schema });
  if (target !== 'json') return inner;

  // RFC-11 R7: refuse non-JSON bodies ourselves so the answer does not depend on framework internals.
  const guarded: MiddlewareHandler = async (c, next) => {
    if (!JSON_CONTENT_TYPE.test(c.req.header('content-type') ?? '')) {
      return c.json(
        errorBody('VALIDATION_FAILED', 'Request body must be application/json', [
          { path: '', message: 'Expected application/json' },
        ]),
        400,
      );
    }
    return inner(c, next);
  };
  schemas.set(guarded, { target, schema });
  // The cast keeps zValidator's inferred types so handlers can call c.req.valid('json').
  return guarded as unknown as typeof inner;
}

/** The target and schema a `validate` middleware checks; undefined for any other handler. @rfc RFC-82 R16 */
export function validatorSchema(
  fn: unknown,
): { target: keyof ValidationTargets; schema: z.ZodType } | undefined {
  return typeof fn === 'function' ? schemas.get(fn) : undefined;
}
