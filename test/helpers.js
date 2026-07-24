import { once } from 'node:events';

export const baseConfig = {
  port: 3000, host: '127.0.0.1', auditTimeoutMs: 100, maxResponseBytes: 1024,
  maxConcurrency: 2, maxQueueSize: 2, cacheTtlMs: 1000, cacheMaxEntries: 10,
  rateLimitMax: 10, rateLimitWindowMs: 60_000, trustProxy: false, logLevel: 'silent'
};

export async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

export function auditResult(url = 'https://example.com/') {
  return { url, fetchedAt: '2026-01-01T00:00:00.000Z', response: { status: 200 }, page: {}, checks: {}, score: 100 };
}
