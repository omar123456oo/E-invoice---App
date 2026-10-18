// Deterministic test configuration. Keys below are test-only values.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.MONGODB_URI ??= 'mongodb://placeholder-overridden-in-tests';
process.env.JWT_ACCESS_SECRET = 'test-only-jwt-secret-0123456789abcdef0123456789';
process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.ETA_TRANSPORT = 'simulated';
process.env.ETA_SIGNING_MODE = 'none';
process.env.CORS_ORIGINS = 'http://localhost:4200';
