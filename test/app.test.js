import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { auditResult, baseConfig, listen } from './helpers.js';

test('health endpoint and unknown routes have API responses', async t => {
  const running = await listen(createApp(baseConfig, { auditor: async url => auditResult(url) }));
  t.after(running.close);
  const health = await fetch(`${running.url}/health`);
  assert.deepEqual(await health.json(), { status: 'ok' });
  const missing = await fetch(`${running.url}/missing`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, 'NOT_FOUND');
});

test('validates JSON body and URL input', async t => {
  const running = await listen(createApp(baseConfig, { auditor: async url => auditResult(url) }));
  t.after(running.close);
  const badJson = await fetch(`${running.url}/v1/audits`, { method: 'POST', body: '{', headers: { 'content-type': 'application/json' } });
  assert.equal((await badJson.json()).error.code, 'INVALID_JSON');
  const invalid = await fetch(`${running.url}/v1/audits`, { method: 'POST', body: JSON.stringify({ url: 'ftp://example.com' }) });
  const body = await invalid.json();
  assert.equal(invalid.status, 400);
  assert.equal(body.error.code, 'UNSUPPORTED_PROTOCOL');
  assert.ok(body.error.requestId);
});

test('rejects unexpected fields and oversized request bodies', async t => {
  const running = await listen(createApp(baseConfig, { auditor: async url => auditResult(url) }));
  t.after(running.close);
  const unexpected = await fetch(`${running.url}/v1/audits`, {
    method: 'POST', body: JSON.stringify({ url: 'https://example.com', extra: true })
  });
  assert.equal(unexpected.status, 400);
  assert.equal((await unexpected.json()).error.code, 'INVALID_REQUEST');

  const oversized = await fetch(`${running.url}/v1/audits`, {
    method: 'POST', body: JSON.stringify({ url: `https://example.com/${'a'.repeat(17_000)}` })
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, 'REQUEST_TOO_LARGE');
});

test('caches repeat audits and coalesces simultaneous misses', async t => {
  let calls = 0;
  let resolveAudit;
  const auditor = url => { calls++; return new Promise(resolve => { resolveAudit = () => resolve(auditResult(url)); }); };
  const running = await listen(createApp(baseConfig, { auditor }));
  t.after(running.close);
  const request = () => fetch(`${running.url}/v1/audits`, { method: 'POST', body: JSON.stringify({ url: 'https://example.com' }) });
  const first = request();
  const second = request();
  for (let attempts = 0; calls === 0 && attempts < 50; attempts++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(calls, 1);
  resolveAudit();
  assert.equal((await first).headers.get('x-cache'), 'MISS');
  await second;
  const cached = await request();
  assert.equal(cached.headers.get('x-cache'), 'HIT');
  assert.equal((await cached.json()).meta.cached, true);
});

test('rate limits clients and returns headers', async t => {
  const config = { ...baseConfig, rateLimitMax: 1 };
  const running = await listen(createApp(config, { auditor: async url => auditResult(url) }));
  t.after(running.close);
  const request = () => fetch(`${running.url}/v1/audits`, { method: 'POST', body: JSON.stringify({ url: 'https://example.com' }) });
  const first = await request();
  assert.equal(first.headers.get('ratelimit-remaining'), '0');
  const second = await request();
  assert.equal(second.status, 429);
  assert.equal((await second.json()).error.code, 'RATE_LIMIT_EXCEEDED');
  assert.ok(second.headers.get('retry-after'));
});

test('preserves safe caller request IDs', async t => {
  const running = await listen(createApp(baseConfig, { auditor: async url => auditResult(url) }));
  t.after(running.close);
  const response = await fetch(`${running.url}/v1/audits`, { method: 'POST', headers: { 'x-request-id': 'trace-123' }, body: JSON.stringify({ url: 'https://example.com' }) });
  assert.equal(response.headers.get('x-request-id'), 'trace-123');
  assert.equal((await response.json()).meta.requestId, 'trace-123');
});

test('replaces unsafe request IDs and does not expose internal errors', async t => {
  const logs = [];
  const logger = { info() {}, error: (event, fields) => logs.push({ event, fields }) };
  const running = await listen(createApp(baseConfig, {
    logger,
    auditor: async () => { throw new Error('database password'); }
  }));
  t.after(running.close);
  const response = await fetch(`${running.url}/v1/audits`, {
    method: 'POST', headers: { 'x-request-id': 'bad id!' }, body: JSON.stringify({ url: 'https://example.com' })
  });
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.error.code, 'INTERNAL_ERROR');
  assert.equal(body.error.message, 'An unexpected error occurred');
  assert.notEqual(body.error.requestId, 'bad id!');
  assert.equal(logs[0].event, 'request_error');
});

test('uses the first forwarded address only when proxy trust is enabled', async t => {
  const running = await listen(createApp({ ...baseConfig, trustProxy: true, rateLimitMax: 1 }, {
    auditor: async url => auditResult(url)
  }));
  t.after(running.close);
  const request = address => fetch(`${running.url}/v1/audits`, {
    method: 'POST', headers: { 'x-forwarded-for': `${address}, 10.0.0.1` }, body: JSON.stringify({ url: 'https://example.com' })
  });
  assert.equal((await request('203.0.113.1')).status, 200);
  assert.equal((await request('203.0.113.2')).status, 200);
  assert.equal((await request('203.0.113.1')).status, 429);
});
