import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router, type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { logger } from './common/logging/logger.js';
import { errorHandler, notFoundHandler } from './common/middleware/error-handler.js';
import { requestId } from './common/middleware/request-id.js';
import { generateOpenApi } from './openapi/registry.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { branchRouter } from './modules/branches/branch.routes.js';
import { customerRouter } from './modules/customers/customer.routes.js';
import { etaRouter } from './modules/eta/eta.routes.js';
import { posDeviceRouter } from './modules/pos/pos-device.routes.js';
import { productRouter } from './modules/products/product.routes.js';
import { receiptRouter } from './modules/receipts/receipt.routes.js';
import { reportRouter } from './modules/reports/report.routes.js';
import { returnRouter } from './modules/returns/return.routes.js';
import { salesRouter } from './modules/sales/sales.routes.js';
import { taxRouter } from './modules/tax/tax.routes.js';
import { tenantRouter } from './modules/tenants/tenant.routes.js';
import { userRouter } from './modules/users/user.routes.js';

export function createApp(): Express {
  const cfg = env();
  const app = express();
  app.disable('x-powered-by');
  // Behind one reverse proxy (TLS terminated there) in production.
  app.set('trust proxy', cfg.NODE_ENV === 'production' ? 1 : false);

  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => (req as express.Request).requestId, autoLogging: cfg.NODE_ENV !== 'test' }));
  // Inline scripts/styles are only allowed outside production, for Swagger UI (which is disabled in production).
  const inline = cfg.NODE_ENV === 'production' ? [] : ["'unsafe-inline'"];
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", ...inline], styleSrc: ["'self'", ...inline], imgSrc: ["'self'", 'data:'], frameAncestors: ["'none'"] } } }));
  app.use(cors({ origin: cfg.CORS_ORIGINS, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id', 'X-Requested-With'], exposedHeaders: ['X-Request-Id'] }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const limiterEnabled = cfg.NODE_ENV !== 'test';
  app.use('/api/', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false, skip: () => !limiterEnabled }));
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, skip: () => !limiterEnabled });
  app.use(['/api/v1/auth/login', '/api/v1/auth/password'], authLimiter);

  app.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/health/ready', (_req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable', mongo: ready });
  });

  const v1 = Router();
  for (const r of [authRouter, tenantRouter, branchRouter, userRouter, posDeviceRouter, taxRouter, productRouter, customerRouter, salesRouter, receiptRouter, returnRouter, reportRouter, etaRouter, auditRouter]) {
    v1.use(r());
  }
  app.use('/api/v1', v1);

  const spec = generateOpenApi();
  app.get('/api/v1/openapi.json', (_req, res) => {
    res.json(spec);
  });
  if (cfg.NODE_ENV !== 'production') app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
