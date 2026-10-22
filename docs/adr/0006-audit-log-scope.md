# 0006. Audit log holds human and security actions only

- Status: Accepted
- Date: 2026-10-22
- Milestone: M2, M4

## Context

The docs write every job transition (started, completed, retry scheduled,
moved to DLQ) into `audit_log` and also into `job_executions`. That doubles
writes on the hot path and buries the events an auditor cares about (who did
what) under machine noise. Several actions the docs write are also missing
from the audit table's CHECK list, so those inserts would fail.

## Decision

`audit_log` records actions taken by a person or affecting security:

- Auth: login succeeded, login failed, logout, refresh-token reuse detected.
- Authorization: permission denied.
- Jobs by a person: submitted, cancelled, retried manually.
- Admin: DLQ replay, DLQ discard, queue pause/resume, worker drain, load test.
- Users: created, role changed, suspended, deleted.

Each row stores actor id, action, resource type and id, outcome, request id,
IP and user agent. Machine-driven job lifecycle lives in `job_executions` and
`jobs`. The allowed actions are one TypeScript enum mirrored by the DB
constraint. The table is append-only, enforced by an error-raising trigger.

## Consequences

- The audit log stays small and meaningful.
- "What happened to job X" is answered by joining jobs, executions and audit
  rows, not by one table.
- Adding an audited action means updating the enum and a migration together.

## Alternatives considered

- **Everything in audit_log (docs):** high volume, duplicated data.
- **Generic event store for all changes:** powerful but out of scope.
