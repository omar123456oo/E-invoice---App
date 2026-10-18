import { pino } from 'pino';

/**
 * Structured logger with redaction. Secrets, tokens and credentials must never
 * be written to logs; the redaction list is the last line of defence, not the
 * first, so code must also avoid logging such values explicitly.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.access_token',
  '*.client_secret',
  '*.clientSecret',
  '*.presharedKey',
  '*.presharedkey',
  '*.mfaSecret',
  '*.nationalId',
  'headers.presharedkey',
  'headers.authorization',
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  base: { service: 'ereceipt-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
