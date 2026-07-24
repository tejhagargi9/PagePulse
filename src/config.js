function integer(name, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function loadConfig() {
  return Object.freeze({
    port: integer('PORT', 3000, 1, 65535),
    host: process.env.HOST || '0.0.0.0',
    auditTimeoutMs: integer('AUDIT_TIMEOUT_MS', 10_000, 100, 120_000),
    maxResponseBytes: integer('MAX_RESPONSE_BYTES', 2_097_152, 1_024, 20_971_520),
    maxConcurrency: integer('MAX_CONCURRENCY', 8, 1, 1000),
    maxQueueSize: integer('MAX_QUEUE_SIZE', 64, 0, 100_000),
    cacheTtlMs: integer('CACHE_TTL_MS', 300_000, 1, 86_400_000),
    cacheMaxEntries: integer('CACHE_MAX_ENTRIES', 500, 1, 100_000),
    rateLimitMax: integer('RATE_LIMIT_MAX', 30, 1, 100_000),
    rateLimitWindowMs: integer('RATE_LIMIT_WINDOW_MS', 60_000, 1_000, 86_400_000),
    trustProxy: process.env.TRUST_PROXY === 'true',
    logLevel: process.env.LOG_LEVEL || 'info'
  });
}
