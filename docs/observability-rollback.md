# Observability and rollback plan

## SLI measurement

SLIs are computed from server-side events, tagged by deployment version and region. Synthetic probes independently submit and retrieve a known public fixture every minute. Target-site failures are reported separately from PagePulse failures so an upstream `404` does not count against submission availability, while PagePulse timeouts and internal errors do.

| Area | Metrics and dimensions |
|---|---|
| Edge/API | Request rate, status, p50/p95/p99 latency, payload rejection, auth/rate-limit decisions; route, tenant tier, region, version |
| Jobs | Submitted, cache-hit, queued, running, succeeded, terminal upstream error, internal failure; state age and end-to-end duration |
| Queue/outbox | Visible/in-flight count, oldest-message age, receive count, publish latency, unpublished-row age, DLQ depth |
| Workers/egress | Active/max slots, autoscaling lag, fetch/DNS/TLS latency, timeout, redirect, bytes, per-host saturation, NAT ports |
| PostgreSQL | Query latency/errors, connections, pool wait, CPU/storage, lock waits, replication lag, backup/PITR status |
| Redis | Command latency/errors, memory, evictions, hit ratio, failover state, rejected connections |
| Runtime | CPU, memory/RSS, event-loop delay, restarts, file descriptors, network errors |
| Business/security | Audits per tenant, quota consumption, estimated cost/job, blocked private-address attempts, WAF blocks |

Metrics use bounded-cardinality labels; URL, request ID, and job ID belong in logs/traces, not metric labels. Structured logs include timestamp, severity, event, request ID, job ID, tenant ID, version, state transition, duration, and stable error code. URL query strings and credentials are redacted. Traces link edge, API, database/outbox, queue propagation, worker, DNS, and fetch spans. Metrics are retained 13 months for trends, logs 30 days, and traces 7–14 days subject to policy.

## Dashboards

1. **SLA overview:** submission availability and latency, completion percentiles, error-budget remaining, traffic and cache hits.
2. **Queue/worker health:** depth, oldest age, outbox lag, DLQ, slots, autoscaling events, timeouts, dominant tenants/hosts.
3. **Dependencies:** PostgreSQL, Redis, egress/NAT, object storage, and third-party failure breakdown.
4. **Release comparison:** current versus previous version for traffic, latency, 5xx, job failure, resource use, and synthetic results.

## Alerts

Alerts page only for actionable symptoms; lower-priority warnings create a ticket or chat notification.

| Severity | Condition | Window | First response |
|---|---|---|---|
| Page | Submission availability fast-burn: >14.4× monthly error budget | 5 min and 1 h | Check release/dependencies; rollback if version-correlated |
| Page | Submission p95 >300 ms or p99 >750 ms | 10 min | Inspect dependency and pool latency |
| Page | Oldest queue message >15 s or completion p95 >30 s | 10 min | Verify autoscaling; apply admission control |
| Page | DLQ depth increases or unpublished outbox age >60 s | 5 min | Stop unsafe replay; restore relay/consumer |
| Page | PostgreSQL connection use >90% or errors >2% | 5 min | Shed load, inspect pool/failover |
| Warning | Oldest queue message >5 s or queue depth >100 | 5 min | Confirm scale-out before SLO breach |
| Warning | Redis memory >80%, evictions, or hit rate drops 30% | 15 min | Check key growth/TTL and failover |
| Warning | Cost per audit or daily forecast >2× baseline | 1 h | Check abuse, retries, and worker scaling |
| Ticket | Backup or restore drill failed | Immediate/daily | Restore backup coverage before next release |

Every page links to a runbook, dashboard, ownership rotation, and escalation path. Alert thresholds are reviewed against real baselines after launch. Multi-window burn-rate alerts protect the monthly 99.9% objective without paging on isolated errors.

## Deployment strategy

CI builds one immutable, signed image identified by Git SHA, runs unit/integration/security tests, scans dependencies and the image, and promotes that same digest through staging to production. Database changes use expand/contract migrations: add backward-compatible schema first, deploy code that can read both forms, backfill, then remove the old form in a later release.

Production rollout is canary-based:

1. Deploy API and worker task definitions to staging and pass synthetic submission/completion checks.
2. Deploy to one production canary task with 1% traffic and a separate low worker weight.
3. Observe at least 10 minutes and a minimum sample count; compare 5xx, p95 latency, terminal internal failures, queue age, CPU/memory, and synthetic output with the prior version.
4. Increase to 10%, 50%, then 100%, pausing at each stage. Keep the previous task definition and image warm until the observation window closes.
5. Feature flags independently disable new endpoints, webhook delivery, or a new analyzer without redeployment.

## Rollback runbook

Automatic rollback triggers if the canary causes API 5xx above 2%, p95 submission latency above 500 ms, internal audit failures above 2%, synthetic failure, or sustained queue-age regression versus the control.

1. Freeze promotion and record the incident timestamp, bad version, dashboards, and change reference.
2. Route API traffic back to the previous healthy task definition and set new workers' desired count to zero.
3. Allow bad-version workers already fetching to finish only if their writes are backward compatible; otherwise revoke their job leases and let the previous version retry after lease expiry.
4. Confirm health probes, synthetic audit, submission latency, queue age, and error rate recover. Keep admission control enabled until backlog burn-down is safe.
5. Do not destructively reverse a database migration. Disable the feature and roll application code back; use a tested forward repair for data/schema issues.
6. Reconcile jobs touched by the bad version using version-tagged state transitions. Idempotently requeue safe nonterminal jobs and quarantine questionable results.
7. Communicate impact and status, preserve logs/traces, open a blameless review, and block redeployment until the regression has a test or guardrail.

Rollback is exercised quarterly in staging, including a worker rollback with queued jobs and a PostgreSQL point-in-time restore drill. Recovery time to the previous application version targets under 10 minutes.

Related documents: [architecture](architecture.md), [technology decisions](technology-decisions.md), and [failure modes](failure-modes.md).
