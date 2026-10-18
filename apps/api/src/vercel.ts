/**
 * Serverless entry point for Vercel (configured as the api service entrypoint in
 * vercel.json). Exports the Express app; MongoDB is connected lazily on the first
 * request and reused by later invocations on the same instance. There is no
 * worker process: background jobs run after the response (waitUntil) and a cron
 * sweep catches up anything left in the database.
 */
import { attachDatabasePool } from '@vercel/functions';
import express, { type NextFunction, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { configureEta, configureMailer } from './bootstrap.js';
import { env } from './config/env.js';
import { connectMongo } from './common/db/mongo.js';
import { logger } from './common/logging/logger.js';
import { setJobQueue } from './jobs/queue.js';
import { ServerlessQueue } from './jobs/serverless-queue.js';

let ready: Promise<void> | undefined;

function init(): Promise<void> {
  ready ??= (async () => {
    await connectMongo(env().MONGODB_URI);
    attachDatabasePool(mongoose.connection.getClient() as never);
    configureEta();
    configureMailer();
    setJobQueue(new ServerlessQueue());
  })().catch((err: unknown) => {
    ready = undefined;
    logger.error({ err }, 'Initialisation failed');
    throw err;
  });
  return ready;
}

const api = createApp();
const app = express();
app.disable('x-powered-by');
app.use((req: Request, res: Response, next: NextFunction) => {
  init().then(() => next(), () => {
    res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is starting or the database is unreachable. Try again shortly.', requestId: '', details: [] } });
  });
});
app.use(api);

export default app;
