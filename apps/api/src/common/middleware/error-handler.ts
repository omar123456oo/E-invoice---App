import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { AppError } from '../errors/app-error.js';
import { logger } from '../logging/logger.js';
import { TenantGuardError } from '../db/tenant-guard.js';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`));
}

/**
 * Centralised error handler. Known errors become structured responses;
 * everything else is logged with the request id and returned as a generic
 * 500 without internal details.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let appError: AppError;

  if (err instanceof AppError) {
    appError = err;
  } else if (err instanceof mongoose.Error.ValidationError) {
    appError = AppError.validation(Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })));
  } else if (err instanceof mongoose.Error.CastError) {
    appError = AppError.badRequest(`Invalid value for ${err.path}`, [], 'INVALID_VALUE');
  } else if (isDuplicateKey(err)) {
    appError = AppError.conflict('A record with the same unique value already exists', 'DUPLICATE');
  } else if (err instanceof SyntaxError && 'body' in err) {
    appError = AppError.badRequest('Malformed JSON body', [], 'MALFORMED_JSON');
  } else if (isPayloadTooLarge(err)) {
    appError = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  } else {
    if (err instanceof TenantGuardError) logger.fatal({ err, requestId: req.requestId }, 'Tenant guard violation');
    else logger.error({ err, requestId: req.requestId }, 'Unhandled error');
    appError = new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }

  if (appError.status >= 500 && err instanceof AppError) logger.error({ err, requestId: req.requestId }, appError.message);

  res.status(appError.status).json({
    error: { code: appError.code, message: appError.message, requestId: req.requestId, details: appError.details },
  });
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

function isPayloadTooLarge(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { type?: string }).type === 'entity.too.large';
}
