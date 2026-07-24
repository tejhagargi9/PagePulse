# Failure mode analysis

These are the three most likely high-impact failures for a bursty URL-audit service. Security incidents are handled separately by the security controls in the [architecture](architecture.md).

## 1. Slow or hostile target sites exhaust worker capacity

**Trigger:** Many destinations respond slowly, stream indefinitely, redirect repeatedly, or concentrate on one origin. A 500-job burst turns network wait into a growing queue.

**Customer impact:** Completion latency breaches; without admission control, new jobs appear accepted but remain queued. File descriptors, memory, NAT ports, or the target origin may be exhausted.

**Detection:** Oldest-message age, queue depth, worker slot utilization, fetch timeout rate, per-host concurrency, open sockets, NAT port utilization, and completion-SLO burn rate.

**Mitigation:**

- Enforce a 10-second end-to-end fetch timeout, five redirects, two-megabyte body cap, and cancellation.
- Bound concurrency per worker, tenant, and destination host; use fair scheduling so one tenant cannot starve others.
- Autoscale to 250 slots on queue age, with warm minimum capacity and a tested account concurrency quota.
- Stop admitting uncached work with `503 Retry-After` before the completion SLO becomes unrecoverable.
- Retry only transient failures with jitter; never retry deterministic validation, size, content-type, or upstream 4xx errors.

**Recovery:** Scale workers within the tested ceiling, identify dominant hosts/tenants, temporarily reduce their quotas, and let healthy jobs drain. Cancel poison jobs and replay only safe DLQ entries. Do not remove SSRF or resource limits to drain faster.

## 2. Queue/database handoff or duplicate delivery corrupts job state

**Trigger:** An API instance crashes between database and queue writes, a visibility timeout expires while a worker is still running, or SQS redelivers a message.

**Customer impact:** An acknowledged job is stuck forever, the same target is fetched repeatedly, or a late worker overwrites a valid terminal result.

**Detection:** Unpublished-outbox age, queued database rows with no corresponding progress, receive count above one, duplicate-claim count, jobs exceeding the maximum state duration, and DLQ growth.

**Mitigation:**

- Commit job and outbox records atomically; acknowledge the client only after commit.
- Use a unique tenant/idempotency constraint and a compare-and-set claim from `queued` to `running`.
- Make terminal states immutable except through an explicit replay operation.
- Set visibility timeout above the worker deadline and extend it with heartbeats.
- Run a reconciler that republishes old outbox entries and flags stuck jobs.

**Recovery:** Restore the relay first, replay unpublished rows idempotently, return timed-out `running` jobs to `queued` only when their lease expires, and replay the DLQ in a rate-limited batch after fixing the cause.

## 3. Redis or PostgreSQL becomes slow/unavailable

**Trigger:** Managed failover, exhausted database connections, a bad query/index change, Redis memory pressure, or regional network impairment.

**Customer impact:** Submission/status latency rises, quota checks fail, cache hit rate collapses, or durable job acceptance stops. Aggressive client retries can amplify the outage.

**Detection:** Dependency latency/error rate, database connection saturation, lock waits, replication lag, Redis evictions/memory, cache hit rate, API 5xx, and retry volume.

**Mitigation:**

- Use Multi-AZ services, timeouts, circuit breakers, connection pooling, bounded queries, and capacity headroom.
- Treat PostgreSQL as required for job acceptance: fail fast with `503 Retry-After` rather than pretend a job is durable.
- Treat Redis cache as optional: bypass it during an outage while applying conservative local admission limits. For paid quota correctness, fail closed if a trustworthy quota check is impossible.
- Add jittered client guidance and gateway rate limiting to suppress retry storms.
- Test failover and point-in-time restore quarterly.

**Recovery:** Confirm automated failover, shed nonessential reads, reduce worker concurrency if database writes are the bottleneck, and restore from point-in-time backup only for corruption/data loss. Warm Redis gradually from demand rather than bulk-reloading it.

## Residual risks

A cloud-region outage requires a separately funded multi-region design; the baseline is Multi-AZ within one region with infrastructure reproducible in a second region. Sudden abusive traffic is reduced by WAF, authentication, quotas, and cost alerts, but no finite system can promise completion under unbounded admitted load.
