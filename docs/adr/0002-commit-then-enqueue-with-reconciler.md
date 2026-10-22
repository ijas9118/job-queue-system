# 0002. Commit to Postgres, then enqueue, with a reconciler

- Status: Accepted
- Date: 2026-10-22
- Milestone: M3

## Context

Submitting a job writes to two stores: a row in Postgres and a job in Redis.
There is no transaction spanning both (the dual-write problem). If the process
crashes or Redis is unreachable after the Postgres commit but before the
enqueue, the job exists in Postgres and never runs. The docs assume this
cannot happen.

## Decision

We will:

1. Insert the job row in Postgres with status `queued` and commit.
2. Call `queue.add(type, { jobId }, { jobId: row.id })`, using the Postgres id
   as the BullMQ job id. BullMQ ignores an add whose job id already exists, so
   enqueueing the same row twice is harmless.
3. Run a reconciler loop (in the worker process, every 30 s) that finds rows in
   `queued` older than 60 s and re-adds them with the same job id.

If the enqueue fails during the request, the API still returns 201; the
reconciler picks the job up.

## Consequences

- No job is lost when Redis is briefly down; it is delayed by at most the
  reconciler interval plus threshold.
- Correctness depends on the job id being the Postgres id. This is an
  invariant to test.
- The reconciler must check the job is still `queued` and not cancelled
  before re-adding.
- Some jobs can start a little late; acceptable at this project's scale.
- The transactional outbox (below) remains a documented stretch goal.

## Alternatives considered

- **Transactional outbox:** write the job and an outbox row in one transaction;
  a relay process pushes outbox rows to Redis. The textbook answer, but more
  moving parts. Planned as a stretch milestone and a future ADR.
- **Enqueue first, then insert:** the worker could pick up a job whose row does
  not exist yet. Rejected.
- **Ignore the problem:** loses jobs on partial failure. Rejected.
