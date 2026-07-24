import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicUrl, isPrivateAddress, normalizeUrl } from '../src/security.js';

test('normalizes safe URLs and rejects unsafe schemes and credentials', () => {
  assert.equal(normalizeUrl('https://Example.com/a#part').toString(), 'https://example.com/a');
  assert.throws(() => normalizeUrl('file:///etc/passwd'), { code: 'UNSUPPORTED_PROTOCOL' });
  assert.throws(() => normalizeUrl('https://user:pass@example.com'), { code: 'URL_CREDENTIALS_NOT_ALLOWED' });
  assert.throws(() => normalizeUrl('not a url'), { code: 'INVALID_URL' });
});

test('recognizes private and public IP ranges', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.1.1', '192.168.1.1', '169.254.1.1', '::1', 'fd00::1']) assert.equal(isPrivateAddress(address), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
});

test('rejects localhost, private DNS results, and failed resolution', async () => {
  await assert.rejects(assertPublicUrl(new URL('http://localhost')), { code: 'PRIVATE_URL_NOT_ALLOWED' });
  await assert.rejects(assertPublicUrl(new URL('http://example.test'), async () => [{ address: '10.0.0.2' }]), { code: 'PRIVATE_URL_NOT_ALLOWED' });
  await assert.rejects(assertPublicUrl(new URL('http://missing.test'), async () => { throw new Error('no'); }), { code: 'DNS_RESOLUTION_FAILED' });
  await assert.doesNotReject(assertPublicUrl(new URL('https://example.test'), async () => [{ address: '93.184.216.34' }]));
});
