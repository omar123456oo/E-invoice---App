/**
 * Persistent local MongoDB replica set for development (no Docker needed).
 * Uses the mongod binary that mongodb-memory-server downloads, keeps data in
 * <repo>/.data/mongo and initialises replica set "rs0" on first start.
 *
 *   npm run db:start  -w apps/api   local only (127.0.0.1)
 *   npm run db:secure -w apps/api   create users + key file, enable authentication, update apps/api/.env
 *   npm run db:public -w apps/api   listen on 0.0.0.0 (all interfaces) — refused unless authentication is enabled
 *   npm run db:stop   -w apps/api
 *
 * Credentials are written to <repo>/.data/mongo-credentials.json (mode 600, git-ignored).
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { MongoBinary } from 'mongodb-memory-server-core';
import { MongoClient } from 'mongodb';

const PORT = Number(process.env.LOCAL_MONGO_PORT ?? 27017);
const DB = 'ereceipt';
const repo = resolve(import.meta.dirname, '../../../..');
const dataRoot = join(repo, '.data');
const dataDir = join(dataRoot, 'mongo');
const logFile = join(dataRoot, 'mongod.log');
const keyFile = join(dataRoot, 'mongo-keyfile');
const credFile = join(dataRoot, 'mongo-credentials.json');
const envFile = join(repo, 'apps', 'api', '.env');

interface Credentials {
  admin: { user: string; password: string };
  app: { user: string; password: string };
}

const creds = (): Credentials | null => (existsSync(credFile) ? (JSON.parse(readFileSync(credFile, 'utf8')) as Credentials) : null);
const authEnabled = () => existsSync(keyFile) && creds() !== null;

function adminUri(): string {
  const c = creds();
  const auth = authEnabled() && c ? `${encodeURIComponent(c.admin.user)}:${encodeURIComponent(c.admin.password)}@` : '';
  return `mongodb://${auth}127.0.0.1:${PORT}/?directConnection=true${auth ? '&authSource=admin' : ''}`;
}

async function withClient<T>(uri: string, fn: (c: MongoClient) => Promise<T>): Promise<T> {
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
  try {
    await c.connect();
    return await fn(c);
  } finally {
    await c.close().catch(() => undefined);
  }
}

async function reachable(): Promise<boolean> {
  try {
    // ping is allowed without authentication.
    await withClient(`mongodb://127.0.0.1:${PORT}/?directConnection=true`, (c) => c.db('admin').command({ ping: 1 }));
    return true;
  } catch {
    return false;
  }
}

async function stop(): Promise<void> {
  if (!(await reachable())) return;
  await withClient(adminUri(), (c) => c.db('admin').command({ shutdown: 1 })).catch(() => undefined);
  for (let i = 0; i < 40 && (await reachable()); i++) await new Promise((r) => setTimeout(r, 250));
}

async function start(bindIp: string): Promise<void> {
  if (await reachable()) return;
  mkdirSync(dataDir, { recursive: true });
  const bin = await MongoBinary.getPath();
  const args = ['--replSet', 'rs0', '--port', String(PORT), '--bind_ip', bindIp, '--dbpath', dataDir, '--fork', '--logpath', logFile, '--logappend'];
  if (authEnabled()) args.push('--auth', '--keyFile', keyFile);
  execFileSync(bin, args, { stdio: 'ignore' });
  for (let i = 0; i < 40 && !(await reachable()); i++) await new Promise((r) => setTimeout(r, 250));
  if (!(await reachable())) throw new Error(`mongod did not start; see ${logFile}`);
}

async function ensureReplicaSet(): Promise<void> {
  await withClient(adminUri(), async (c) => {
    const admin = c.db('admin');
    try {
      await admin.command({ replSetGetStatus: 1 });
    } catch {
      await admin.command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: `127.0.0.1:${PORT}` }] } });
    }
    for (let i = 0; i < 40; i++) {
      if ((await admin.command({ hello: 1 })).isWritablePrimary) return;
      await new Promise((r) => setTimeout(r, 500));
    }
  });
}

const password = () => randomBytes(24).toString('base64url');

function appUri(host: string, extra: string): string {
  const c = creds()!;
  return `mongodb://${c.app.user}:${encodeURIComponent(c.app.password)}@${host}:${PORT}/${DB}?authSource=${DB}&${extra}`;
}

function updateEnv(uri: string): void {
  if (!existsSync(envFile)) return;
  const env = readFileSync(envFile, 'utf8');
  writeFileSync(envFile, env.replace(/^MONGODB_URI=.*$/m, `MONGODB_URI=${uri}`), { mode: 0o600 });
}

/** Creates an admin and an application user, a replica-set key file, and restarts with authentication. */
async function secure(): Promise<void> {
  if (authEnabled()) {
    console.log('Authentication is already enabled.');
    return;
  }
  await start('127.0.0.1');
  await ensureReplicaSet();
  const c: Credentials = { admin: { user: 'admin', password: password() }, app: { user: 'ereceipt_app', password: password() } };
  // Users are created while mongod still runs without --auth, bound to 127.0.0.1 only.
  await withClient(adminUri(), async (client) => {
    const admin = client.db('admin');
    const existing = await admin.command({ usersInfo: 'admin' });
    if (existing.users.length) throw new Error('An admin user already exists but no credentials file was found; refusing to overwrite');
    await admin.command({ createUser: c.admin.user, pwd: c.admin.password, roles: [{ role: 'root', db: 'admin' }] });
    await client.db(DB).command({ createUser: c.app.user, pwd: c.app.password, roles: [{ role: 'readWrite', db: DB }] });
  });
  mkdirSync(dataRoot, { recursive: true });
  writeFileSync(credFile, JSON.stringify(c, null, 2), { mode: 0o600 });
  writeFileSync(keyFile, randomBytes(512).toString('base64'), { mode: 0o400 });
  chmodSync(keyFile, 0o400);
  await stop();
  await start('127.0.0.1');
  updateEnv(appUri('127.0.0.1', 'replicaSet=rs0'));
  console.log('Authentication enabled. apps/api/.env now uses the ereceipt_app user.');
}

function lanAddresses(): string[] {
  return Object.values(networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n!.address);
}

const cmd = process.argv[2] ?? 'start';
if (cmd === 'stop') {
  await stop();
  console.log('Local MongoDB stopped');
} else if (cmd === 'secure') {
  await secure();
} else {
  const publicMode = cmd === 'public';
  if (publicMode && !authEnabled()) {
    console.error('Refusing to listen on 0.0.0.0 without authentication. Run: npm run db:secure -w apps/api');
    process.exit(1);
  }
  const bindIp = publicMode ? '0.0.0.0' : '127.0.0.1';
  // Restart if it is running with a different bind address.
  if (await reachable()) {
    const current = await withClient(adminUri(), (c) => c.db('admin').command({ getCmdLineOpts: 1 })).then((r) => r.parsed?.net?.bindIp as string | undefined, () => undefined);
    if (current && current !== bindIp) await stop();
  }
  await start(bindIp);
  await ensureReplicaSet();
  console.log(`Local MongoDB running on ${bindIp}:${PORT}${authEnabled() ? ' with authentication' : ' WITHOUT authentication (local only)'}`);
  console.log(`  This machine: ${authEnabled() ? appUri('127.0.0.1', 'replicaSet=rs0').replace(/:[^:@/]+@/, ':****@') : `mongodb://127.0.0.1:${PORT}/${DB}?replicaSet=rs0`}`);
  if (publicMode) {
    for (const ip of lanAddresses()) console.log(`  Other devices: ${appUri(ip, 'directConnection=true').replace(/:[^:@/]+@/, ':****@')}`);
    console.log(`  Passwords: ${credFile}`);
  }
}
