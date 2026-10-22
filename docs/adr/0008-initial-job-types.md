# 0008. Four initial job types

- Status: Accepted
- Date: 2026-10-22
- Milestone: M5

## Context

The docs list seven example job types including video and image processing.
Each real handler needs infrastructure; the learning goal is to exercise every
reliability pattern, not to build media pipelines.

## Decision

We will build four handlers, each with a Zod payload schema and its own timeout:

| Type | Shows | Local dependency |
|------|-------|------------------|
| send-email | External side effect; idempotency key forwarded; permanent vs retryable SMTP errors | Mailpit in Docker Compose |
| deliver-webhook | HTTP retries, timeouts, 4xx permanent vs 5xx retryable | A small mock HTTP server with configurable failures |
| generate-report | CPU-bound work, progress events, cancellation checkpoints | None |
| flaky | Test handler that fails N times then succeeds, or always fails | None |

Job type decides the queue (`email`, `webhooks`, `reports`, `default`) on the
server; clients do not choose a queue name.

## Consequences

- Every pattern (retry, DLQ, idempotency, cancel, progress, backpressure) has a
  concrete demo.
- The `flaky` handler is disabled or admin-only outside development.
- New types later follow the same interface and get their own ADR if they add
  infrastructure.

## Alternatives considered

- **All seven example types:** more infrastructure, little extra learning.
- **Only a generic echo handler:** too abstract to show real failure modes.
