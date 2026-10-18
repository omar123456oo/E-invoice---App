import { createApp } from './app.js';
import { configureEta } from './bootstrap.js';
import { env } from './config/env.js';
import { connectMongo, disconnectMongo } from './common/db/mongo.js';
import { logger } from './common/logging/logger.js';
import { startInProcessSweeper, stopInProcessSweeper } from './jobs/sweeper.js';
import { BullJobQueue } from './jobs/bull.js';
import { getJobQueue, setJobQueue } from './jobs/queue.js';

async function main(): Promise<void> {
  const cfg = env();
  await connectMongo(cfg.MONGODB_URI);
  configureEta();
  if (cfg.REDIS_URL) setJobQueue(new BullJobQueue(cfg.REDIS_URL));
  else {
    logger.warn('REDIS_URL not set: running the ETA sweeper in-process (development mode)');
    startInProcessSweeper();
  }
  const server = createApp().listen(cfg.PORT, () => logger.info({ port: cfg.PORT }, 'API listening'));

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    stopInProcessSweeper();
    server.close();
    await getJobQueue().close();
    await disconnectMongo();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Startup failed');
  process.exit(1);
});
