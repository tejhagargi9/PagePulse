# Technology decision record

## Status and decision drivers

Status: proposed for the scale target. Decisions optimize for burst absorption, durable acceptance, SSRF-safe outbound work, low operational load, and a credible response-time SLA. The existing Node.js audit logic is retained where it already satisfies those constraints.

## ADR-001: asynchronous job API

**Decision:** Return `202 Accepted` for cache misses and expose job status through `GET /v1/audits/{jobId}`.

**Why:** Target sites regularly take seconds or time out. Decoupling submission from execution keeps p95 acceptance below 300 ms, absorbs 500-request bursts, and allows independent worker scaling and retries.

**Rejected alternative — synchronous HTTP until completion:** Simpler for callers, but consumes 500 concurrent connections and API slots, couples the SLA to arbitrary sites, and makes retries ambiguous after client or proxy timeouts.

**Consequences:** Clients must poll or later use a webhook. The service publishes separate acceptance and completion objectives.

## ADR-002: Amazon SQS standard queue with a DLQ

**Decision:** Buffer audit jobs in SQS standard and make consumers idempotent.

**Why:** SQS is durable, managed, elastic for sudden bursts, supports visibility timeouts and DLQs, and requires no broker fleet for a modest 10,000 jobs/day.

**Rejected alternative — self-managed RabbitMQ:** RabbitMQ offers rich routing and low latency, but neither is required here. Clustering, upgrades, partition behavior, and capacity management add disproportionate operational work.

**Consequences:** Delivery is at least once and order is not guaranteed. Workers use a database claim and terminal-state check so duplicate or reordered messages are harmless.

## ADR-003: ECS Fargate workers using the existing Node.js code

**Decision:** Package API and workers as containers and run workers on ECS Fargate, scaling on queue depth and age.

**Why:** Long-lived queue consumers get explicit CPU/memory, predictable outbound networking, graceful draining, and independent scaling. Node.js is efficient for bounded network I/O and reuses the tested parser and security controls.

**Rejected alternative — Lambda workers:** Lambda is attractive for sporadic work, but burst concurrency, execution/network controls, cold starts, and database connection management complicate predictable completion latency. It can be reconsidered if workload isolation and measured latency prove acceptable.

**Consequences:** Minimum tasks have an idle cost and autoscaling must be tuned. Images and task definitions become deployment artifacts.

## ADR-004: PostgreSQL as the source of truth

**Decision:** Store jobs, tenant ownership, state transitions, compact results, and the transactional outbox in managed PostgreSQL.

**Why:** Unique constraints, transactions, row-level claims, mature backups, and flexible result queries provide a clear correctness boundary.

**Rejected alternative — DynamoDB only:** DynamoDB scales very well, but multi-item workflow invariants, ad hoc operational queries, and an outbox-style publish workflow are less straightforward for this team and volume.

**Consequences:** Use a connection pool, bounded indexes, retention/partitioning, Multi-AZ, and point-in-time recovery. Large artifacts do not belong in database rows.

## ADR-005: Redis for ephemeral shared state

**Decision:** Use managed Redis for rate limits, cache entries, and fast idempotency lookups; keep PostgreSQL authoritative.

**Why:** Atomic increments with TTLs and low-latency shared caching work across all API replicas and workers.

**Rejected alternative — per-process memory:** The current LRU and limiter are effective on one instance but become inconsistent under horizontal scaling and disappear on restart.

**Consequences:** Redis loss can reduce performance but must not lose jobs. Define degraded behavior, TTL every ephemeral key, set memory limits, and use Multi-AZ failover.

## ADR-006: object storage for large artifacts

**Decision:** Put optional compressed artifacts in S3-compatible object storage and keep only metadata and object keys in PostgreSQL.

**Why:** Object storage is inexpensive, durable, encrypted, and supports lifecycle expiry without bloating database backups.

**Rejected alternative — storing full HTML in PostgreSQL:** It simplifies reads but increases table/index bloat, backup duration, privacy exposure, and restore time. PagePulse does not need raw HTML for its core response.

**Consequences:** Access uses short-lived signed URLs or service credentials, tenant authorization is checked before reads, and lifecycle rules enforce retention.

## ADR-007: OpenTelemetry with managed metrics, logs, and traces

**Decision:** Instrument API, outbox relay, queue, workers, database, Redis, and egress with OpenTelemetry and export to a managed observability backend.

**Why:** Vendor-neutral instrumentation correlates a request ID, job ID, queue message, and outbound fetch while a managed backend reduces operational load.

**Rejected alternative — logs only:** Logs are necessary for diagnosis but are expensive and weak for percentile SLIs, queue-age alerting, distributed causality, and automated burn-rate alerts.

**Consequences:** Sampling and redaction are required. Metrics remain unsampled; errors and slow traces receive higher sampling priority.

## ADR-008: transactional outbox between PostgreSQL and SQS

**Decision:** Commit the job and an outbox row in one database transaction, then publish asynchronously.

**Why:** It closes the failure window where the API acknowledges a database job but crashes before queue publication, without needing a distributed transaction.

**Rejected alternative — write PostgreSQL then publish directly:** It is simpler but can strand acknowledged jobs. Publishing first has the inverse problem: workers can receive a job that does not exist.

**Consequences:** Operate an outbox relay, monitor unpublished-row age, and make publication idempotent.
