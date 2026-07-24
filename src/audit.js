import { AppError } from './errors.js';
import { assertPublicUrl, normalizeUrl } from './security.js';

function match(html, expression) { return expression.test(html); }
function content(html, expression) { return html.match(expression)?.[1]?.trim() || null; }

export function analyzeHtml(html, response, finalUrl, durationMs, bytes) {
  const title = content(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = content(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i)
    ?? content(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i);
  const images = [...html.matchAll(/<img\b[^>]*>/gi)];
  const imagesWithoutAlt = images.filter(value => !/\balt\s*=/i.test(value[0])).length;
  const checks = {
    hasTitle: Boolean(title),
    titleLengthOk: Boolean(title && title.length >= 10 && title.length <= 60),
    hasMetaDescription: Boolean(description),
    descriptionLengthOk: Boolean(description && description.length >= 50 && description.length <= 160),
    hasH1: match(html, /<h1\b[^>]*>/i),
    hasViewport: match(html, /<meta[^>]+name=["']viewport["']/i),
    hasCanonical: match(html, /<link[^>]+rel=["'][^"']*canonical/i),
    hasLang: match(html, /<html[^>]+lang=["'][^"']+/i),
    allImagesHaveAlt: imagesWithoutAlt === 0
  };
  const passed = Object.values(checks).filter(Boolean).length;
  return {
    url: finalUrl,
    fetchedAt: new Date().toISOString(),
    response: { status: response.status, contentType: response.headers.get('content-type'), durationMs, bytes },
    page: { title, metaDescription: description, h1Count: (html.match(/<h1\b[^>]*>/gi) || []).length, imageCount: images.length, imagesWithoutAlt },
    checks,
    score: Math.round((passed / Object.keys(checks).length) * 100)
  };
}

export function createAuditor({ timeoutMs, maxResponseBytes, fetchImpl = fetch, validatePublicUrl = assertPublicUrl, now = Date.now }) {
  return async function audit(inputUrl) {
    let url = normalizeUrl(inputUrl);
    const started = now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response;
      for (let redirects = 0; redirects <= 5; redirects++) {
        await validatePublicUrl(url);
        response = await fetchImpl(url, { signal: controller.signal, redirect: 'manual', headers: { 'user-agent': 'PagePulse/1.0', accept: 'text/html,application/xhtml+xml' } });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (redirects === 5) throw new AppError(422, 'TOO_MANY_REDIRECTS', 'The URL redirected too many times');
          const location = response.headers.get('location');
          if (!location) throw new AppError(502, 'INVALID_REDIRECT', 'The upstream returned a redirect without a location');
          url = normalizeUrl(new URL(location, url).toString());
          continue;
        }
        break;
      }
      if (!response.ok) throw new AppError(422, 'UPSTREAM_HTTP_ERROR', `The URL returned HTTP ${response.status}`, { status: response.status });
      const type = response.headers.get('content-type') || '';
      if (!type.toLowerCase().includes('text/html')) throw new AppError(422, 'UNSUPPORTED_CONTENT_TYPE', 'The URL did not return HTML', { contentType: type });
      const declared = Number(response.headers.get('content-length'));
      if (declared > maxResponseBytes) throw new AppError(413, 'RESPONSE_TOO_LARGE', 'The upstream response exceeds the configured size limit');
      const reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxResponseBytes) { await reader.cancel(); throw new AppError(413, 'RESPONSE_TOO_LARGE', 'The upstream response exceeds the configured size limit'); }
        chunks.push(value);
      }
      const html = new TextDecoder().decode(Buffer.concat(chunks.map(value => Buffer.from(value))));
      return analyzeHtml(html, response, url.toString(), now() - started, bytes);
    } catch (error) {
      if (error.name === 'AbortError') throw new AppError(504, 'AUDIT_TIMEOUT', 'The audit timed out');
      if (error instanceof AppError) throw error;
      throw new AppError(502, 'FETCH_FAILED', 'The URL could not be fetched');
    } finally { clearTimeout(timer); }
  };
}
