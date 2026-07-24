import test from 'node:test';
import assert from 'node:assert/strict';
import { TtlLruCache } from '../src/cache.js';

test('cache expires entries after TTL', () => {
  let now = 0;
  const cache = new TtlLruCache({ ttlMs: 10, maxEntries: 2, now: () => now });
  cache.set('a', 1);
  assert.equal(cache.get('a'), 1);
  now = 10;
  assert.equal(cache.get('a'), undefined);
});

test('cache evicts least recently used entry', () => {
  const cache = new TtlLruCache({ ttlMs: 100, maxEntries: 2, now: () => 0 });
  cache.set('a', 1); cache.set('b', 2); cache.get('a'); cache.set('c', 3);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 1);
  cache.clear();
  assert.equal(cache.get('a'), undefined);
});
