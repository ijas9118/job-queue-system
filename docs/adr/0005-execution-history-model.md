# 0005. One execution row per attempt, inserted at start, finalized once

- Status: Accepted
- Date: 2026-10-22
- Milestone: M2

## Context

The docs say `job_executions` is strictly append-only and write one row when
an attempt ends. If the worker crashes mid-attempt, no row is written, so
history has a gap exactly when it matters. Handler-level idempotency also needs
to see attempts that started but did not finish. The docs enforce immutability
with `CREATE RULE ... DO INSTEAD NOTHING`, which silently ignores updates and
hides bugs.

## Decision

- When a worker picks up a job it inserts a `job_executions` row with
  `status = 'running'`, `attempt`, `worker_id` and `started_at`.
- When the attempt ends it updates that row once to `succeeded`, `failed` or
  `cancelled` with `finished_at`, duration, result or error fields.
- A Postgres trigger raises an exception for any other update: changing a
  finished row, changing identifying columns, or deleting rows.
- An attempt left `running` by a crashed worker is closed as `abandoned` when
  BullMQ re-delivers the job and the next attempt starts.
- `UNIQUE (job_id, attempt)`.

## Consequences

- Every attempt is visible, including ones interrupted by crashes.
- History stays tamper-evident: violations fail loudly instead of silently.
- Status vocabulary for executions is fixed: running, succeeded, failed,
  cancelled, abandoned.
- Retention must be designed around the delete block (partition by month and
  drop old partitions, which bypasses row triggers by design).

## Alternatives considered

- **Insert only at the end (docs):** loses crashed attempts.
- **Two rows per attempt (started event, finished event):** purely append-only,
  but every query has to pair rows.
- **No database enforcement:** relies on discipline; rejected for a table
  sold as immutable.
