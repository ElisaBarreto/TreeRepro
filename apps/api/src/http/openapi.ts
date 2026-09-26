import { createHash } from 'node:crypto';
import { errorEnvelopeSchema, type PermissionKey } from '@treerepro/contracts';
import { z } from 'zod';
import { type GuardKind, guardKind, guardPermission } from './guards.ts';
import { KEY_REFUSED_PERMISSIONS } from './middleware/require-permission.ts';
import { SESSION_COOKIE } from './middleware/session.ts';
import { ROUTE_CATALOG } from './route-catalog.ts';
import { validatorSchema } from './validate.ts';

/** One route Hono has mounted, as `App['routes']` reports it. @rfc RFC-82 R17 */
export interface RouteEntry {
  method: string;
  path: string;
  handler: unknown;
}

interface JsonSchemaObject {
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

/**
 * Labels of every schema `toJsonSchema` fell back to `{}` for, deduplicated.
 * A conversion is pure — the same schema always succeeds or always fails —
 * so this never needs clearing: it is the complete set for the process's
 * lifetime. The RFC-82 R17 meta-test asserts it stays empty; a non-empty
 * result means part of the generated reference silently lost its shape and
 * the label here says which part.
 * @rfc RFC-82 R17
 */
const degraded = new Set<string>();

/** @rfc RFC-82 R17 */
export function degradedSchemas(): readonly string[] {
  return [...degraded];
}

/**
 * `z.toJSONSchema` on the input side, `unrepresentable` types turned into `{}`
 * rather than thrown; the `$schema` key is dropped, it belongs on a whole
 * document, not on an embedded schema. `label` identifies the schema for
 * `degradedSchemas()` — a route key plus which part of it (body, query,
 * response, …) — should the fallback below ever fire: `z.toJSONSchema` can
 * still throw on its own bug, or a construct neither `io: 'input'` nor
 * `unrepresentable: 'any'` covers, and documenting that one schema as an
 * open object is better than failing the whole reference.
 * @rfc RFC-82 R17
 */
function toJsonSchema(schema: z.ZodType, label: string): JsonSchemaObject {
  try {
    const json = z.toJSONSchema(schema, {
      io: 'input',
      unrepresentable: 'any',
    }) as JsonSchemaObject;
    delete json.$schema;
    return json;
  } catch {
    degraded.add(label);
    return {};
  }
}

const ERROR_SCHEMA = toJsonSchema(errorEnvelopeSchema, 'errorEnvelopeSchema (default response)');

/**
 * A permission a key is refused outright (RFC-82 R6, `KEY_REFUSED_PERMISSIONS`)
 * carries `sessionCookie` only: a key never reaches that route, whatever its
 * owner's permissions, so documenting `bearerKey` as an option would mislead.
 * @rfc RFC-82 R17
 */
function securityFor(
  kind: GuardKind | 'public',
  permission?: PermissionKey,
): Array<Record<string, never[]>> {
  switch (kind) {
    case 'public':
      return [];
    case 'session':
      return [{ sessionCookie: [] }];
    case 'permission':
      return permission && KEY_REFUSED_PERMISSIONS.has(permission)
        ? [{ sessionCookie: [] }]
        : [{ sessionCookie: [] }, { bearerKey: [] }];
    case 'apiKey':
      return [{ bearerKey: [] }];
  }
}

/** One `{ name, in, required, schema }` entry per property of a `param` or `query` schema. */
function parametersFor(target: 'param' | 'query', schema: z.ZodType, label: string): unknown[] {
  const json = toJsonSchema(schema, label);
  const properties = json.properties ?? {};
  const required = json.required ?? [];
  return Object.entries(properties).map(([name, propSchema]) => ({
    name,
    in: target === 'param' ? 'path' : 'query',
    required: target === 'param' || required.includes(name),
    schema: propSchema,
  }));
}

function groupByRoute(routes: readonly RouteEntry[]): Map<string, RouteEntry[]> {
  const grouped = new Map<string, RouteEntry[]>();
  for (const route of routes) {
    if (route.method === 'ALL') continue;
    const key = `${route.method} ${route.path}`;
    const entries = grouped.get(key);
    if (entries) entries.push(route);
    else grouped.set(key, [route]);
  }
  return grouped;
}

/**
 * Builds the OpenAPI 3.1 reference from the routes Hono mounted and the
 * route catalog: one operation per catalogued route, its guard class and
 * permission read from the route's guard middleware, its path, query and
 * JSON body schemas from its `validate` middleware, and its `2XX`/`default`
 * responses from the catalog's response schema and the RFC-11 R3 error body.
 * A catalogued route with no mounted route to match throws — the RFC-82 R16
 * meta-test keeps this from happening against the real app.
 * @rfc RFC-82 R17
 */
export function buildOpenApi(routes: readonly RouteEntry[]): Record<string, unknown> {
  const grouped = groupByRoute(routes);
  const operationsByPath = new Map<string, Record<string, unknown>>();

  for (const [key, catalog] of Object.entries(ROUTE_CATALOG).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const entries = grouped.get(key);
    if (!entries) throw new Error(`buildOpenApi: catalogued route not mounted: ${key}`);
    const [method, path] = key.split(' ') as [string, string];

    const kind: GuardKind | 'public' =
      entries.map((e) => guardKind(e.handler)).find((k): k is GuardKind => k !== undefined) ??
      'public';
    const permission = entries.map((e) => guardPermission(e.handler)).find((p) => p !== undefined);

    const parameters: unknown[] = [];
    let requestBody: unknown;
    for (const entry of entries) {
      const validated = validatorSchema(entry.handler);
      if (!validated) continue;
      if (validated.target === 'json') {
        requestBody = {
          required: true,
          content: {
            'application/json': { schema: toJsonSchema(validated.schema, `${key} requestBody`) },
          },
        };
      } else if (validated.target === 'param' || validated.target === 'query') {
        parameters.push(
          ...parametersFor(validated.target, validated.schema, `${key} ${validated.target}`),
        );
      }
    }

    const operation: Record<string, unknown> = {
      summary: catalog.summary,
      'x-guard': kind,
      ...(permission ? { 'x-permission': permission } : {}),
      security: securityFor(kind, permission),
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(requestBody ? { requestBody } : {}),
      responses: {
        '2XX': {
          description: 'Success',
          ...(catalog.response
            ? {
                content: {
                  'application/json': { schema: toJsonSchema(catalog.response, `${key} response`) },
                },
              }
            : {}),
        },
        default: {
          description: 'Error (RFC-11 R3, RFC-12)',
          content: { 'application/json': { schema: ERROR_SCHEMA } },
        },
      },
    };

    const openApiPath = path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const item = operationsByPath.get(openApiPath) ?? {};
    item[method.toLowerCase()] = operation;
    operationsByPath.set(openApiPath, item);
  }

  const paths: Record<string, unknown> = {};
  for (const p of [...operationsByPath.keys()].sort()) {
    const item = operationsByPath.get(p);
    if (item) paths[p] = item;
  }

  return {
    openapi: '3.1.0',
    info: { title: 'TreeRepro API', version: '1', description: 'Guide: GET /api/docs' },
    components: {
      securitySchemes: {
        bearerKey: {
          type: 'http',
          scheme: 'bearer',
          description: 'tr_live_… API key (RFC-82)',
        },
        sessionCookie: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE },
      },
    },
    paths,
  };
}

/** SHA-256 hex of `JSON.stringify(doc)`. @rfc RFC-82 R19 */
export function openApiHash(doc: unknown): string {
  return createHash('sha256').update(JSON.stringify(doc)).digest('hex');
}
