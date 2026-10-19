/**
 * Starts a persistent local MongoDB replica set for development (no Docker needed).
 * Uses the mongod binary that mongodb-memory-server downloads, keeps data in
 * <repo>/.data/mongo and initialises replica set "rs0" on first start.
 *   npm run db:start -w apps/api     → mongodb://127.0.0.1:27017/ereceipt?replicaSet=rs0
 *   npm run db:stop  -w apps/api
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MongoBinary } from 'mongodb-memory-server-core';
import { MongoClient } from 'mongodb';

const PORT = Number(process.env.LOCAL_MONGO_PORT ?? 27017);
const root = resolve(import.meta.dirname, '../../../..');
const dataDir = join(root, '.data', 'mongo');
const logFile = join(root, '.data', 'mongod.log');
const pidFile = join(dataDir, 'mongod.lock');
const uri = `mongodb://127.0.0.1:${PORT}/?directConnection=true`;

async function reachable(): Promise<boolean> {
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 1500 });
  try {
    await c.connect();
    await c.db('admin').command({ ping: 1 });
    return true;
  } catch {
    return false;
  } finally {
    await c.close().catch(() => undefined);
  }
}

if (process.argv[2] === 'stop') {
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 1500 });
  try {
    await c.connect();
    await c.db('admin').command({ shutdown: 1 }).catch(() => undefined);
    console.log('Local MongoDB stopped');
  } catch {
    console.log('Local MongoDB is not running');
  }
  process.exit(0);
}

if (!(await reachable())) {
  mkdirSync(dataDir, { recursive: true });
  const bin = await MongoBinary.getPath();
  execFileSync(bin, ['--replSet', 'rs0', '--port', String(PORT), '--bind_ip', '127.0.0.1', '--dbpath', dataDir, '--fork', '--logpath', logFile, '--logappend'], { stdio: 'ignore' });
  for (let i = 0; i < 30 && !(await reachable()); i++) await new Promise((r) => setTimeout(r, 500));
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
await client.connect();
const admin = client.db('admin');
try {
  await admin.command({ replSetGetStatus: 1 });
} catch {
  await admin.command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: `127.0.0.1:${PORT}` }] } });
}
for (let i = 0; i < 40; i++) {
  const s = await admin.command({ hello: 1 });
  if (s.isWritablePrimary) break;
  await new Promise((r) => setTimeout(r, 500));
}
await client.close();
const pid = existsSync(pidFile) ? readFileSync(pidFile, 'utf8').trim() : '?';
console.log(`Local MongoDB running (pid ${pid}), data in ${dataDir}`);
console.log(`MONGODB_URI=mongodb://127.0.0.1:${PORT}/ereceipt?replicaSet=rs0`);
