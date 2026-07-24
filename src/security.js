import dns from 'node:dns/promises';
import net from 'node:net';
import { AppError } from './errors.js';

export function normalizeUrl(input) {
  if (typeof input !== 'string' || input.length === 0 || input.length > 2048) {
    throw new AppError(400, 'INVALID_URL', 'url must be a non-empty string no longer than 2048 characters');
  }
  let url;
  try { url = new URL(input); } catch { throw new AppError(400, 'INVALID_URL', 'url must be a valid absolute URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new AppError(400, 'UNSUPPORTED_PROTOCOL', 'Only http and https URLs are supported');
  if (url.username || url.password) throw new AppError(400, 'URL_CREDENTIALS_NOT_ALLOWED', 'URLs containing credentials are not allowed');
  url.hash = '';
  return url;
}

export function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (net.isIPv6(address)) {
    const value = address.toLowerCase().split('%')[0];
    return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') || value.startsWith('ff') || value.startsWith('::ffff:');
  }
  return true;
}

export async function assertPublicUrl(url, lookup = dns.lookup) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) throw new AppError(400, 'PRIVATE_URL_NOT_ALLOWED', 'Private or local network URLs are not allowed');
  let addresses;
  try { addresses = await lookup(hostname, { all: true, verbatim: true }); }
  catch { throw new AppError(422, 'DNS_RESOLUTION_FAILED', 'The URL hostname could not be resolved'); }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new AppError(400, 'PRIVATE_URL_NOT_ALLOWED', 'Private or local network URLs are not allowed');
  }
}
