import mongoose, { type ClientSession } from 'mongoose';
import { logger } from '../logging/logger.js';

mongoose.set('strictQuery', true);
// Never auto-create indexes in production at runtime without review; syncIndexes is run by the migration script.
mongoose.set('autoIndex', process.env.NODE_ENV !== 'production');
// NoSQL injection defence: every request body/query/param is parsed by a Zod schema into primitive
// types before it reaches a query, so user input can never carry {$gt: ...}-style operators.
// (Mongoose's global sanitizeFilter is not used because it also neutralises the server's own operators.)

export async function connectMongo(uri: string): Promise<typeof mongoose> {
  const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  logger.info({ db: conn.connection.name }, 'MongoDB connected');
  return conn;
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

/**
 * Runs `fn` inside a MongoDB multi-document transaction. Requires a replica
 * set or sharded cluster. Transient errors are retried by the driver.
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return result;
  } finally {
    await session.endSession();
  }
}
