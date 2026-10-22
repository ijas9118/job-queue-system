# Architecture Decision Records

This folder records the significant design decisions for the job queue system.
Each record explains the context, the decision, its consequences and the
alternatives we rejected, so the reasoning survives after the code changes.

Format: a light version of Michael Nygard's ADR template (see `0000-template.md`).

## Index

| #                                                   | Decision                                                         | Status   |
| --------------------------------------------------- | ---------------------------------------------------------------- | -------- |
| [0001](0001-bullmq-owns-retries.md)                 | BullMQ owns retries and backoff                                  | Accepted |
| [0002](0002-commit-then-enqueue-with-reconciler.md) | Commit to Postgres, then enqueue, with a reconciler              | Accepted |
| [0003](0003-stored-job-states.md)                   | Six stored job states; pause whole queues only                   | Accepted |
| [0004](0004-backoff-full-jitter.md)                 | Exponential backoff with full jitter                             | Accepted |
| [0005](0005-execution-history-model.md)             | One execution row per attempt, inserted at start, finalized once | Accepted |
| [0006](0006-audit-log-scope.md)                     | Audit log holds human and security actions only                  | Accepted |
| [0007](0007-worker-liveness-in-redis.md)            | Worker liveness in Redis TTL keys                                | Accepted |
| [0008](0008-initial-job-types.md)                   | Four initial job types                                           | Accepted |
| [0009](0009-refresh-token-in-httponly-cookie.md)    | Refresh token in an HttpOnly cookie                              | Accepted |
| [0010](0010-local-first-deployment.md)              | Local Docker Compose first; cloud decided at M12                 | Accepted |

## Adding a new ADR

1. Copy `0000-template.md` to the next number with a short kebab-case title,
   for example `0011-use-transactional-outbox.md`.
2. Fill in every section. Keep it to about one page.
3. Start with `Status: Proposed`. Change it to `Accepted` when you commit to it.
4. Add a row to the index above.
5. Commit the ADR in the same pull request as the code it describes, or before it.

## Changing a decision

Never rewrite an accepted ADR's decision. Write a new ADR that explains the
change, set the old one's status to `Superseded by NNNN`, and link both ways.
Typo fixes and added links are fine to edit in place.
