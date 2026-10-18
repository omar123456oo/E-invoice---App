/**
 * Application error with a stable machine-readable code. Every error that
 * reaches the client is either an AppError or is converted to a generic 500.
 */
export interface ErrorDetail {
  path?: string;
  message: string;
  code?: string;
}

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: ErrorDetail[] = [],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AppError';
  }

  static badRequest(message: string, details: ErrorDetail[] = [], code = 'BAD_REQUEST'): AppError {
    return new AppError(400, code, message, details);
  }
  static validation(details: ErrorDetail[], message = 'Request validation failed'): AppError {
    return new AppError(422, 'VALIDATION_FAILED', message, details);
  }
  static unauthorized(message = 'Authentication required', code = 'UNAUTHENTICATED'): AppError {
    return new AppError(401, code, message);
  }
  static forbidden(message = 'You do not have permission to perform this action', code = 'FORBIDDEN'): AppError {
    return new AppError(403, code, message);
  }
  static notFound(entity: string): AppError {
    return new AppError(404, 'NOT_FOUND', `${entity} not found`);
  }
  static conflict(message: string, code = 'CONFLICT'): AppError {
    return new AppError(409, code, message);
  }
  static businessRule(message: string, code: string, details: ErrorDetail[] = []): AppError {
    return new AppError(422, code, message, details);
  }
  static tooMany(message = 'Too many requests'): AppError {
    return new AppError(429, 'RATE_LIMITED', message);
  }
}
