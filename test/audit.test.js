import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHtml, createAuditor } from '../src/audit.js';

const publicUrl = async () => {};

test('analyzes SEO, accessibility, and response metadata', () => {
  const html = '<html lang="en"><head><title>A useful page title</title><meta name="description" content="A sufficiently detailed description that contains more than fifty characters for testing."><meta name="viewport"><link rel="canonical"></head><body><h1>Hello</h1><img alt="x"></body></html>';
  const response = new Response(html, { headers: { 'content-type': 'text/html' } });
  const result = analyzeHtml(html, response, 'https://example.com/', 12, html.length);
  assert.equal(result.score, 100);
  assert.equal(result.page.h1Count, 1);
  assert.equal(result.page.imagesWithoutAlt, 0);
});

test('auditor follows validated redirects and reads HTML', async () => {
  const calls = [];
  const auditor = createAuditor({ timeoutMs: 100, maxResponseBytes: 1000, validatePublicUrl: async url => calls.push(url.toString()), fetchImpl: async url => {
    if (url.hostname === 'one.test') return new Response(null, { status: 302, headers: { location: 'https://two.test/page' } });
    return new Response('<html><title>Page</title></html>', { headers: { 'content-type': 'text/html' } });
  }});
  const result = await auditor('https://one.test');
  assert.equal(result.url, 'https://two.test/page');
  assert.deepEqual(calls, ['https://one.test/', 'https://two.test/page']);
});

test('auditor rejects upstream failures and non-HTML content', async () => {
  const options = { timeoutMs: 100, maxResponseBytes: 1000, validatePublicUrl: publicUrl };
  await assert.rejects(createAuditor({ ...options, fetchImpl: async () => new Response('no', { status: 500 }) })('https://example.test'), { code: 'UPSTREAM_HTTP_ERROR' });
  await assert.rejects(createAuditor({ ...options, fetchImpl: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }) })('https://example.test'), { code: 'UNSUPPORTED_CONTENT_TYPE' });
});

test('auditor enforces declared and streamed response size', async () => {
  const options = { timeoutMs: 100, maxResponseBytes: 3, validatePublicUrl: publicUrl };
  await assert.rejects(createAuditor({ ...options, fetchImpl: async () => new Response('abcd', { headers: { 'content-type': 'text/html', 'content-length': '4' } }) })('https://example.test'), { code: 'RESPONSE_TOO_LARGE' });
  await assert.rejects(createAuditor({ ...options, fetchImpl: async () => new Response('abcd', { headers: { 'content-type': 'text/html' } }) })('https://example.test'), { code: 'RESPONSE_TOO_LARGE' });
});

test('auditor converts aborts and fetch failures to structured errors', async () => {
  const timeout = createAuditor({ timeoutMs: 5, maxResponseBytes: 100, validatePublicUrl: publicUrl, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })))) });
  await assert.rejects(timeout('https://example.test'), { code: 'AUDIT_TIMEOUT' });
  const failed = createAuditor({ timeoutMs: 100, maxResponseBytes: 100, validatePublicUrl: publicUrl, fetchImpl: async () => { throw new Error('secret'); } });
  await assert.rejects(failed('https://example.test'), { code: 'FETCH_FAILED' });
});
