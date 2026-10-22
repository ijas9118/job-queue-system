# 0003. Six stored job states; pause whole queues only

- Status: Accepted
- Date: 2026-10-22
- Milestone: M1

## Context

The docs define eight states: queued, active, completed, failed, delayed,
dead_letter, cancelled and paused. Two of them cause trouble:

- `paused` for a single active job: BullMQ cannot pause one job mid-run. A
  running handler can only be cancelled cooperatively.
- `failed` as a stored state: it lasts only until the retry decision, which
  happens in the same step, so nobody can observe it. It also adds transitions
  that every query must handle.

The docs also disagree on whether `dead_letter` is terminal or can be replayed.

## Decision

`jobs.status` will hold exactly six values:

| State       | Meaning                                                                               |
| ----------- | ------------------------------------------------------------------------------------- |
| queued      | Waiting to be picked up                                                               |
| active      | A worker is running it                                                                |
| delayed     | Waiting for a scheduled time or a retry backoff                                       |
| completed   | Succeeded (terminal)                                                                  |
| dead_letter | Retries exhausted or permanent error; only an explicit replay moves it back to queued |
| cancelled   | Stopped by a user or admin (terminal)                                                 |

Each failed attempt is recorded as an execution row and an event
(`job:failed`), not as a stored status. Pausing is a queue-level admin
action (`queue.pause()`), not a job state. A cancel request on an active job
sets a flag; the worker stops at its next checkpoint and records `cancelled`.

Transitions are driven by events in a pure state machine module
(`picked_up`, `succeeded`, `failed_retryable`, `failed_permanent`,
`retries_exhausted`, `delay_elapsed`, `cancel_requested`, `replayed`).

## Consequences

- Fewer states, each observable, each with a clear owner.
- The DB enum/CHECK, shared TypeScript enum and dashboard badges all use this
  one list.
- Docs that mention `failed` or `paused` as job states must be updated.
- Per-job pause is not available; admins pause the queue instead.

## Alternatives considered

- **Keep all eight states:** matches the docs but models things BullMQ cannot do
  and states nobody sees.
- **Mirror BullMQ's states exactly:** couples our schema to a library's internal
  vocabulary (waiting, prioritized, waiting-children).
