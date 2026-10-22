# 0007. Worker liveness in Redis TTL keys

- Status: Accepted
- Date: 2026-10-22
- Milestone: M6

## Context

The docs keep a `workers` table in Postgres, updated every 5 s, with a single
`currentJobId` (though each worker runs 5 jobs at once). A custom reaper
deletes stale workers and resets their jobs to `queued` in Postgres only,
which conflicts with BullMQ's own stalled-job recovery and leaves Redis
unchanged.

## Decision

- Each worker writes `worker:<id>` in Redis every 5 s with a 15 s TTL. The
  value holds hostname, pid, concurrency, active job ids, started-at and
  counters. A missing key means the worker is gone.
- Recovering jobs from dead workers is left to BullMQ: lock renewal plus the
  stalled-job checker (`lockDuration`, `stalledInterval`, `maxStalledCount`
  tuned to our longest normal job). No custom reaper.
- Worker online/offline events are published for the dashboard.
- Optionally, a `worker_sessions` table in Postgres stores start and stop times
  for history, written twice per worker lifetime, not every 5 s.

## Consequences

- No heartbeat write load on Postgres.
- One mechanism decides when a job is abandoned, so no double processing from
  competing reapers.
- The admin worker list reads from Redis (SCAN for `worker:*`).
- We must understand and test BullMQ's stalled-job behaviour (M6 drill).

## Alternatives considered

- **Postgres heartbeat table (docs):** durable but noisy, with a reaper that
  races BullMQ.
- **BullMQ `getWorkers()` only:** lists connections but not our metadata;
  can complement the TTL keys.
