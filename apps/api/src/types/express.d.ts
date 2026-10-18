import type { RequestContext } from '../common/security/context.js';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      ctx?: RequestContext;
    }
  }
}

export {};
