/**
 * Runs the API against an in-memory MongoDB replica set with DEMO data and the
 * SIMULATED ETA. For local evaluation without Docker. Data is lost on exit.
 *   npm run dev:memory -w apps/api
 */
import { randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

if (process.env.NODE_ENV === 'production') throw new Error('dev-memory is for local development only');
const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
Object.assign(process.env, {
  NODE_ENV: 'development',
  MONGODB_URI: rs.getUri('ereceipt'),
  REDIS_URL: '',
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? randomBytes(48).toString('base64url'),
  DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY ?? randomBytes(32).toString('base64'),
  ETA_TRANSPORT: 'simulated',
  ETA_SIGNING_MODE: 'none',
});
await import('./seed-dev.js').catch((err) => {
  console.error(err);
  process.exit(1);
});
await import('../server.js');
const stop = async () => {
  await rs.stop();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
