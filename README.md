# PagePulse

PagePulse is a production-oriented HTTP API that fetches a public webpage and returns a compact technical, SEO, and accessibility audit. It is deliberately dependency-light and includes bounded network work, SSRF protection, TTL/LRU caching, in-flight request coalescing, concurrency backpressure, per-client rate limiting, request correlation, and structured JSON logs.

## Scale design deliverables

The production scale design targets 10,000 audits per day, bursts of 500 concurrent submissions, and explicit customer-facing response-time objectives:

- [Architecture, data flow, queueing, state, and diagram](docs/architecture.md)
- [Technology decision record and rejected alternatives](docs/technology-decisions.md)
- [Top failure modes and mitigations](docs/failure-modes.md)
- [Observability, alerting, deployment, and rollback plan](docs/observability-rollback.md)

No frontend is required: PagePulse is an API service, and the scale deliverables describe the production evolution of that service.

## API

### `POST /v1/audits`

Request body (JSON, maximum 16 KB):

```json
{ "url": "https://example.com" }
```

Only absolute `http` and `https` URLs are accepted. Credentials, localhost, private/link-local/reserved IPs, unsafe DNS results, and redirects to private networks are rejected. Redirects are limited to five; downloads are bounded by time and size.

Success (`200`):

```json
{
  "data": {
    "url": "https://example.com/",
    "fetchedAt": "2026-07-24T10:00:00.000Z",
    "response": { "status": 200, "contentType": "text/html", "durationMs": 123, "bytes": 1256 },
    "page": { "title": "Example Domain", "metaDescription": null, "h1Count": 1, "imageCount": 0, "imagesWithoutAlt": 0 },
    "checks": {
      "hasTitle": true,
      "titleLengthOk": true,
      "hasMetaDescription": false,
      "descriptionLengthOk": false,
      "hasH1": true,
      "hasViewport": true,
      "hasCanonical": false,
      "hasLang": true,
      "allImagesHaveAlt": true
    },
    "score": 67
  },
  "meta": { "cached": false, "requestId": "78e42df2-..." }
}
```

Responses include `X-Request-Id`, `X-Cache` (`HIT` or `MISS`), `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`. A safe caller-provided `X-Request-Id` is preserved. Rate-limited responses also include `Retry-After`.

Errors use one stable shape:

```json
{
  "error": {
    "code": "INVALID_URL",
    "message": "url must be a valid absolute URL",
    "requestId": "78e42df2-..."
  }
}
```

Relevant status codes are `400` invalid/unsafe input, `404` route not found, `413` size limit, `422` upstream/content failure, `429` rate limit, `502` fetch failure, `503` capacity exhausted, `504` timeout, and `500` unexpected failure.

### `GET /health`

Returns `200 {"status":"ok"}`. Health checks do not consume rate-limit quota.

## Run locally

Requirements: Node.js 20+.

```bash
npm ci
npm start
curl -X POST http://localhost:3000/v1/audits \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com"}'
```

Run the suite with `npm test`, coverage with `npm run test:coverage`, or build/run the container with:

```bash
docker build -t pagepulse .
docker run --rm -p 3000:3000 pagepulse
```

## Configuration

| Variable | Default | Purpose |
|---|---:|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listen address |
| `AUDIT_TIMEOUT_MS` | `10000` | Total timeout across DNS, redirects, and body download |
| `MAX_RESPONSE_BYTES` | `2097152` | Maximum downloaded HTML bytes |
| `MAX_CONCURRENCY` | `8` | Simultaneous upstream audits per instance |
| `MAX_QUEUE_SIZE` | `64` | Waiting audits before returning `503` |
| `CACHE_TTL_MS` | `300000` | Cache window (five minutes) |
| `CACHE_MAX_ENTRIES` | `500` | Per-instance LRU entry cap |
| `RATE_LIMIT_MAX` | `30` | Requests allowed per client/window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window |
| `TRUST_PROXY` | `false` | Trust the first `X-Forwarded-For` address; enable only behind a trusted proxy |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, or `silent` |

Invalid numeric configuration fails fast on startup.

## Design and production notes

The cache and limiter are intentionally bounded in-memory implementations suitable for one process. Concurrent audits for the same normalized URL share one promise, preventing a cache stampede. For horizontal scaling, replace both behind the existing interfaces with Redis so quota and cached results are shared across instances. DNS is checked immediately before every fetch and every redirect target; strict egress firewalling or an outbound proxy is still recommended as defense in depth against DNS rebinding.

Logs are newline-delimited JSON on stdout, with `request_complete`, `request_error`, lifecycle events, request IDs, status, and duration. The server drains open connections on `SIGTERM`/`SIGINT` with a ten-second hard deadline.

## CI and deployment

GitHub Actions runs unit/integration tests, coverage, and a Docker build on every push and pull request. `render.yaml` provides a Render Blueprint for a long-lived container, while `api/index.js` and `vercel.json` provide a Vercel serverless deployment. Serverless cache and quota state is scoped to each warm instance; use the container deployment plus Redis when globally shared state across replicas is required. Set `TRUST_PROXY=true` only when the platform sanitizes forwarded headers.

## License

MIT
