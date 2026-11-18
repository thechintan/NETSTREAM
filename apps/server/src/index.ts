import { buildApp } from './app.js';
import { config } from './config/index.js';
import { closeDb } from './db/index.js';
import { closeRedis } from './lib/redis.js';
import { initMedia, shutdownMedia } from './media/index.js';

const app = buildApp();

let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  app.log.info({ signal }, 'Received termination signal, starting graceful shutdown...');

  try {
    await app.close();
    await shutdownMedia();
    await closeRedis();
    await closeDb();
    app.log.info('Graceful shutdown completed successfully.');
    process.exit(0);
  } catch (error) {
    app.log.error({ error }, 'Error during graceful shutdown');
    process.exit(1);
  }
}

process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));

async function start() {
  try {
    await initMedia();
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`Server listening on port ${config.PORT} (origin: ${config.WEB_ORIGIN})`);
  } catch (error) {
    app.log.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

void start();
