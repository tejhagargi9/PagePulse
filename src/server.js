import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const server = createApp(config, { logger });

server.listen(config.port, config.host, () => logger.info('server_started', { host: config.host, port: config.port }));

function shutdown(signal) {
  logger.info('server_stopping', { signal });
  server.close(error => process.exit(error ? 1 : 0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
