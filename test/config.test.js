import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const managedKeys = [
  'PORT', 'HOST', 'AUDIT_TIMEOUT_MS', 'MAX_RESPONSE_BYTES', 'MAX_CONCURRENCY',
  'MAX_QUEUE_SIZE', 'CACHE_TTL_MS', 'CACHE_MAX_ENTRIES', 'RATE_LIMIT_MAX',
  'RATE_LIMIT_WINDOW_MS', 'TRUST_PROXY', 'LOG_LEVEL'
];

function withEnvironment(values, callback) {
  const original = Object.fromEntries(managedKeys.map(key => [key, process.env[key]]));
  for (const key of managedKeys) delete process.env[key];
  Object.assign(process.env, values);
  try { return callback(); }
  finally {
    for (const key of managedKeys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

test('loads safe production defaults', () => withEnvironment({}, () => {
  const config = loadConfig();
  assert.equal(config.port, 3000);
  assert.equal(config.auditTimeoutMs, 10_000);
  assert.equal(config.maxResponseBytes, 2_097_152);
  assert.equal(config.trustProxy, false);
  assert.equal(Object.isFrozen(config), true);
}));

test('parses supported environment overrides', () => withEnvironment({
  PORT: '8080', AUDIT_TIMEOUT_MS: '2500', TRUST_PROXY: 'true', LOG_LEVEL: 'debug'
}, () => {
  const config = loadConfig();
  assert.equal(config.port, 8080);
  assert.equal(config.auditTimeoutMs, 2500);
  assert.equal(config.trustProxy, true);
  assert.equal(config.logLevel, 'debug');
}));

test('rejects non-integer and out-of-range settings', () => {
  withEnvironment({ PORT: '3.14' }, () => assert.throws(loadConfig, /PORT must be an integer/));
  withEnvironment({ MAX_CONCURRENCY: '0' }, () => assert.throws(loadConfig, /MAX_CONCURRENCY must be an integer/));
  withEnvironment({ AUDIT_TIMEOUT_MS: '120001' }, () => assert.throws(loadConfig, /AUDIT_TIMEOUT_MS must be an integer/));
});
