import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { z, type ZodType } from 'zod';
import { ErrorResponse, registry } from '../../openapi/registry.js';
import { AppError } from '../errors/app-error.js';
import type { RequestContext } from '../security/context.js';
import type { Permission } from '../security/permissions.js';
import { authenticate } from '../middleware/authenticate.js';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface HandlerInput<B, Q, P> {
  body: B;
  query: Q;
  params: P;
  ctx: RequestContext;
  req: Request;
  res: Response;
}

export interface RouteDef<B = unknown, Q = unknown, P = unknown> {
  method: Method;
  path: string;
  summary: string;
  tag: string;
  /** Defaults to true. Public routes must opt out explicitly. */
  auth?: boolean;
  permission?: Permission;
  body?: ZodType<B>;
  query?: ZodType<Q>;
  params?: ZodType<P>;
  response?: ZodType;
  status?: number;
  description?: string;
  /** Extra middleware run after authentication and the permission check (e.g. multipart parsing). */
  middlewares?: RequestHandler[];
  /** Documents a multipart/form-data body in OpenAPI. */
  multipart?: Record<string, { type: 'string' | 'binary'; description?: string }>;
  handler: (input: HandlerInput<B, Q, P>) => Promise<unknown>;
}

/** Identity helper preserving type inference for route definitions. */
export function route<B, Q, P>(def: RouteDef<B, Q, P>): RouteDef<B, Q, P> {
  return def;
}

function parse<T>(schema: ZodType<T> | undefined, value: unknown, location: string): T {
  if (!schema) return {} as T;
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw AppError.validation(
      result.error.issues.map((i) => ({ path: [location, ...i.path.map(String)].join('.'), message: i.message, code: i.code })),
    );
  }
  return result.data;
}

/**
 * Mounts route definitions on an Express router and registers them in the
 * OpenAPI document, so the published contract and the implementation cannot drift.
 * Zod object schemas strip unknown keys, which prevents mass assignment.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each definition has its own params/query/body types
export function mount(router: Router, basePath: string, defs: RouteDef<any, any, any>[]): void {
  for (const def of defs) {
    const fullPath = `${basePath}${def.path}`;
    const requiresAuth = def.auth !== false;
    const checkPermission = (req: Request, _res: Response, next: NextFunction) => {
      if (requiresAuth && def.permission && !req.ctx?.permissions.has(def.permission)) throw AppError.forbidden();
      next();
    };
    const middlewares: RequestHandler[] = [...(requiresAuth ? [authenticate as RequestHandler] : []), checkPermission, ...(def.middlewares ?? [])];

    router[def.method](fullPath, ...middlewares, async (req: Request, res: Response) => {
      const body = parse(def.body, req.body, 'body');
      const query = parse(def.query, req.query, 'query');
      const params = parse(def.params, req.params, 'params');
      const result = await def.handler({ body, query, params, ctx: req.ctx as RequestContext, req, res });
      if (res.headersSent) return;
      if (result === undefined) res.status(def.status ?? 204).end();
      else res.status(def.status ?? 200).json(result);
    });

    const openApiPath = `/api/v1${fullPath}`.replace(/^\/api\/v1/, '').replace(/:(\w+)/g, '{$1}');
    const status = String(def.status ?? 200);
    registry.registerPath({
      method: def.method,
      path: openApiPath,
      summary: def.summary,
      description: [def.description, def.permission ? `Requires permission \`${def.permission}\`.` : undefined]
        .filter(Boolean)
        .join('\n\n') || undefined,
      tags: [def.tag],
      security: requiresAuth ? [{ bearerAuth: [] }] : [],
      request: {
        ...(def.params ? { params: def.params as never } : {}),
        ...(def.query ? { query: def.query as never } : {}),
        ...(def.body ? { body: { content: { 'application/json': { schema: def.body } } } } : {}),
        ...(def.multipart
          ? { body: { content: { 'multipart/form-data': { schema: z.object(Object.fromEntries(Object.entries(def.multipart).map(([k, v]) => [k, z.string().openapi({ format: v.type === 'binary' ? 'binary' : undefined, description: v.description })]))) } } } }
          : {}),
      },
      responses: {
        [status]: def.response
          ? { description: 'Success', content: { 'application/json': { schema: def.response } } }
          : { description: 'Success' },
        '4XX': { description: 'Client error', content: { 'application/json': { schema: ErrorResponse } } },
      },
    });
  }
}

export const ObjectIdParam = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/, 'Invalid id') });
export const objectIdString = z.string().regex(/^[a-f0-9]{24}$/, 'Invalid id');
