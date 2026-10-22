# 0001. BullMQ owns retries and backoff

- Status: Accepted
- Date: 2026-10-22
- Milestone: M5

## Context

The docs describe two retry mechanisms at once. The worker catches errors,
updates Postgres to `delayed` and calls a custom `scheduleRetry`, while also
relying on BullMQ to re-deliver jobs after a crash. Two systems deciding
whether and when to retry the same job will disagree: a job can be retried
twice, or counted wrongly, or retried after it was moved to the dead-letter
queue. BullMQ already implements attempts, delays and stalled-job recovery
atomically inside Redis with Lua scripts.

## Decision

We will let BullMQ own retry scheduling. Each job is added with `attempts`
(maxRetries + 1) and a custom `backoffStrategy` (see ADR 0004). Handlers
throw normal errors for retryable failures and `UnrecoverableError` for
permanent ones (validation errors, 4xx responses), which skip remaining
attempts.

Postgres mirrors what BullMQ decided: the worker records each attempt in
`job_executions` and updates `jobs.status` from the processor and from the
worker's `failed` and `completed` events. Postgres never schedules a retry
itself.

## Consequences

- One source of truth for "will this run again and when".
- Retry, delay and stalled-job behaviour is tested by the BullMQ project, not
  re-implemented by us.
- We must classify errors explicitly; anything not marked permanent will retry.
- Postgres status can lag Redis by a moment. The UI treats Postgres as the
  durable record and events as hints (ADR 0002, M7).
- Manual retry and DLQ replay re-add the job to BullMQ with a fresh attempt
  count; they do not only edit Postgres.

## Alternatives considered

- **Hand-rolled retries (as in the docs):** full control and more to learn,
  but duplicates BullMQ logic non-atomically across two stores and races with
  BullMQ's own stalled-job recovery.
- **Postgres-only queue (for example SKIP LOCKED polling):** removes the
  dual-store problem but abandons the Redis + BullMQ stack the project chose.
