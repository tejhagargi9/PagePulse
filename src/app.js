import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createAuditor } from './audit.js';
import { TtlLruCache } from './cache.js';
import { AppError, errorBody } from './errors.js';
import { ConcurrencyLimiter, RateLimiter } from './limiter.js';
import { createLogger } from './logger.js';
import { normalizeUrl } from './security.js';

function send(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), ...headers });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw new AppError(413, 'REQUEST_TOO_LARGE', 'Request body must not exceed 16 KB');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError(400, 'INVALID_JSON', 'Request body must be valid JSON'); }
}

export function createApp(config, dependencies = {}) {
  const logger = dependencies.logger || createLogger(config.logLevel);
  const auditor = dependencies.auditor || createAuditor(config);
  const cache = dependencies.cache || new TtlLruCache({ ttlMs: config.cacheTtlMs, maxEntries: config.cacheMaxEntries });
  const concurrency = dependencies.concurrency || new ConcurrencyLimiter(config.maxConcurrency, config.maxQueueSize);
  const rates = dependencies.rateLimiter || new RateLimiter({ max: config.rateLimitMax, windowMs: config.rateLimitWindowMs });
  const inFlight = new Map();

  return http.createServer(async (req, res) => {
    const started = Date.now();
    const suppliedId = req.headers['x-request-id'];
    const requestId = typeof suppliedId === 'string' && /^[a-zA-Z0-9._-]{1,128}$/.test(suppliedId) ? suppliedId : randomUUID();
    res.setHeader('x-request-id', requestId);
    let status = 500;
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/health') {
        status = 200;
        return send(res, status, { status: 'ok' });
      }
      if (req.method !== 'POST' || path !== '/v1/audits') throw new AppError(404, 'NOT_FOUND', 'Route not found');
      const forwarded = config.trustProxy ? req.headers['x-forwarded-for']?.split(',')[0]?.trim() : null;
      const client = forwarded || req.socket.remoteAddress || 'unknown';
      const rate = rates.consume(client);
      const rateHeaders = {
        'ratelimit-limit': String(config.rateLimitMax),
        'ratelimit-remaining': String(rate.remaining),
        'ratelimit-reset': String(Math.ceil(rate.resetAt / 1000))
      };
      for (const [name, value] of Object.entries(rateHeaders)) res.setHeader(name, value);
      if (!rate.allowed) {
        res.setHeader('retry-after', String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))));
        throw new AppError(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests; retry after the rate limit window resets');
      }
      const body = await readJson(req);
      if (!body || Array.isArray(body) || Object.keys(body).some(key => key !== 'url')) throw new AppError(400, 'INVALID_REQUEST', 'Request body must contain only the url field');
      const normalized = normalizeUrl(body.url).toString();
      const cached = cache.get(normalized);
      if (cached) {
        status = 200;
        return send(res, status, { data: cached, meta: { cached: true, requestId } }, { 'x-cache': 'HIT' });
      }
      let promise = inFlight.get(normalized);
      if (!promise) {
        promise = concurrency.run(() => auditor(normalized));
        inFlight.set(normalized, promise);
        promise.then(value => cache.set(normalized, value)).finally(() => inFlight.delete(normalized)).catch(() => {});
      }
      const result = await promise;
      status = 200;
      send(res, status, { data: result, meta: { cached: false, requestId } }, { 'x-cache': 'MISS' });
    } catch (error) {
      status = error instanceof AppError ? error.status : 500;
      if (status >= 500) logger.error('request_error', { requestId, code: error.code || 'INTERNAL_ERROR', message: error.message });
      send(res, status, errorBody(error, requestId));
    } finally {
      logger.info('request_complete', { requestId, method: req.method, path: req.url, status, durationMs: Date.now() - started });
    }
  });
}
