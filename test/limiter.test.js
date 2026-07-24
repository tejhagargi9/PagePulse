import test from 'node:test';
import assert from 'node:assert/strict';
import { ConcurrencyLimiter, RateLimiter } from '../src/limiter.js';

test('rate limiter resets and reports remaining allowance', () => {
  let now = 0;
  const limiter = new RateLimiter({ max: 2, windowMs: 1000, now: () => now });
  assert.deepEqual(limiter.consume('client'), { allowed: true, remaining: 1, resetAt: 1000 });
  assert.equal(limiter.consume('client').allowed, true);
  assert.equal(limiter.consume('client').allowed, false);
  now = 1000;
  assert.equal(limiter.consume('client').allowed, true);
});

test('concurrency limiter bounds active work and rejects excess queue', async () => {
  const limiter = new ConcurrencyLimiter(1, 1);
  let release;
  const blocked = () => new Promise(resolve => { release = resolve; });
  const first = limiter.run(blocked);
  const second = limiter.run(async () => 'second');
  await assert.rejects(limiter.run(async () => 'third'), { code: 'AUDIT_CAPACITY_EXCEEDED' });
  release('first');
  assert.equal(await first, 'first');
  assert.equal(await second, 'second');
});
