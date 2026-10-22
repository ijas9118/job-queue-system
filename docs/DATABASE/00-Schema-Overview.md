# Database Schema Overview

## Design Philosophy

- **Redis** = Fast, transient queue state (who owns this now?)
- **PostgreSQL** = Durable history, audit trail, analytics (what happened?)
- **Immutable History** = job_executions never updated, only appended
- **Soft Deletes** = `deletedAt` on users, `cancelledAt` on jobs — distinct fields for distinct concepts
- **Indexing** = Strategic indexes for common queries

## Quick Reference

| Table               | Purpose                           | Rows    | Immutable?     |
| ------------------- | --------------------------------- | ------- | -------------- |
| `users`             | User accounts & roles             | ~1000s  | No             |
| `jobs`              | Job metadata & current state      | ~1M     | No             |
| `job_executions`    | Execution history (every attempt) | ~10M    | ✅ Yes         |
| `job_logs`          | Structured logs per execution     | ~100M   | ✅ Yes         |
| `workers`           | Worker registry & health          | ~10-100 | No (ephemeral) |
| `dead_letter_queue` | Failed jobs archive               | ~1000s  | No             |
| `audit_log`         | System events for compliance      | ~10M    | ✅ Yes         |

## Core Relationships

```
users (1) ──────────────── (N) jobs
                              │
                              ├── (N) job_executions (immutable history)
                              │       │
                              │       └── (N) job_logs (immutable logs)
                              │
                              ├── (1) dead_letter_queue (if failed)
                              │
                              └── (N) audit_log (who did what)

workers (N) ────── processes ──── jobs
```

## Data Flow

### Job Submission

```
API receives request
    ↓
Validate with Zod schema
    ↓
INSERT INTO jobs (POST)
    status = 'queued'
    idempotencyKey = 'stripe-evt-123'
    ↓
INSERT INTO audit_log
    action = 'job_submitted'
    ↓
PUSH to Redis queue (BullMQ)
    ↓
Response to user
```

### Job Processing

```
Worker picks up job
    ↓
SELECT * FROM jobs WHERE id = ?
SELECT * FROM job_executions WHERE jobId = ? ORDER BY attempt DESC
    ↓
Check idempotency (already completed?)
    ↓
Execute handler
    ↓
Success:
    INSERT INTO job_executions (status='completed', result=...)
    UPDATE jobs (status='completed', completedAt=NOW())
    INSERT INTO audit_log (action='job_completed')

Failure:
    INSERT INTO job_executions (status='failed', errorType=..., errorStack=...)
    If retryCount < maxRetries:
        UPDATE jobs (status='delayed', retryCount++, delayUntil=...)
    Else:
        UPDATE jobs (status='dead_letter')
        INSERT INTO dead_letter_queue
        INSERT INTO audit_log (action='job_failed')
```

## Key Design Patterns

### Pattern 1: Immutable History

```sql
-- job_executions is append-only
INSERT INTO job_executions (jobId, attempt, status, result) VALUES (...);

-- Never update
-- UPDATE job_executions SET ... ❌ NEVER
```

**Why**: Can replay history, debug failures, satisfy compliance

### Pattern 2: Idempotency Key

```sql
-- Prevent duplicate submissions
SELECT * FROM jobs WHERE idempotencyKey = ? AND userId = ?;

-- If exists, return it (don't create new)
-- If not, create with this key
INSERT INTO jobs (idempotencyKey, ...) VALUES (?);
UNIQUE (idempotencyKey, userId);
```

**Why**: Webhooks fire multiple times, retried requests, API safety

### Pattern 3: Cancellation vs Soft Delete

Jobs use `cancelledAt`; users use `deletedAt`. Different concepts get different field names.

```sql
-- Cancel a job
UPDATE jobs SET status = 'cancelled', cancelledAt = NOW() WHERE id = ?;

-- Soft-delete a user
UPDATE users SET deletedAt = NOW() WHERE id = ?;

-- Exclude cancelled jobs from queries
SELECT * FROM jobs WHERE cancelledAt IS NULL;
```

**Why**: `deletedAt` implies admin/system removal; `cancelledAt` implies user intent. Overloading one field for both makes queries and audit logs ambiguous.

### Pattern 4: Structured Errors

```sql
-- Store error as JSONB for rich debugging
INSERT INTO job_executions (
  errorType,      -- 'SMTPTimeout'
  errorMessage,   -- 'Connection timeout'
  errorStack      -- Full stack trace
) VALUES (...);
```

**Why**: Easy to analyze failure patterns, debug issues

### Pattern 5: Worker Registry

```sql
-- Track which workers are alive
INSERT INTO workers (workerId, hostname, status, lastHeartbeat) VALUES (...);
UPDATE workers SET lastHeartbeat = NOW() WHERE id = ?;

-- Find stale workers
SELECT * FROM workers WHERE lastHeartbeat < NOW() - INTERVAL '5 minutes';
```

**Why**: Monitor worker health, detect crashes, reassign work

## Query Patterns

### Find User's Jobs

```sql
SELECT * FROM jobs
WHERE userId = ? AND cancelledAt IS NULL
ORDER BY createdAt DESC
LIMIT 50;

-- Index: (userId, cancelledAt, createdAt DESC)
```

### Get Job with Full History

```sql
SELECT * FROM jobs WHERE id = ? AND cancelledAt IS NULL;
SELECT * FROM job_executions WHERE jobId = ? ORDER BY attempt DESC;
SELECT * FROM job_logs WHERE jobExecutionId IN (...) ORDER BY createdAt;
```

### Dashboard: Queue Stats

```sql
SELECT
  COUNT(*) FILTER (WHERE status = 'queued') as waiting,
  COUNT(*) FILTER (WHERE status = 'active') as active,
  COUNT(*) FILTER (WHERE status = 'delayed') as delayed,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  COUNT(*) FILTER (WHERE status = 'completed') as completed
FROM jobs
WHERE queueName = ? AND cancelledAt IS NULL;
```

### Analytics: Job Performance

```sql
SELECT
  type,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status = 'completed') as succeeded,
  AVG(EXTRACT(EPOCH FROM (completedAt - createdAt))) as avg_total_time_sec
FROM jobs
WHERE createdAt > NOW() - INTERVAL '24 hours'
GROUP BY type
ORDER BY total DESC;
```

### DLQ: Failed Jobs Needing Review

```sql
SELECT
  j.id, j.type, j.name,
  d.failureCount, d.reason, d.movedAt,
  je.errorMessage
FROM dead_letter_queue d
JOIN jobs j ON d.jobId = j.id
JOIN job_executions je ON d.lastExecutionId = je.id
ORDER BY d.movedAt DESC;
```

## Indexes Strategy

### Critical Indexes

```sql
-- Job lookups
CREATE INDEX idx_jobs_id ON jobs(id);
CREATE INDEX idx_jobs_userId_cancelledAt ON jobs(userId, cancelledAt);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_createdAt ON jobs(createdAt DESC);

-- Execution history
CREATE INDEX idx_job_executions_jobId ON job_executions(jobId);
CREATE INDEX idx_job_executions_status ON job_executions(status);

-- Audit trail
CREATE INDEX idx_audit_log_userId ON audit_log(userId);
CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp DESC);

-- DLQ
CREATE INDEX idx_dlq_jobId ON dead_letter_queue(jobId);

-- Idempotency
CREATE UNIQUE INDEX idx_jobs_idempotency ON jobs(idempotencyKey, userId);
```

### Why These?

- **userId**: Users query their own jobs (filtered access)
- **status**: Dashboard shows job counts by status
- **createdAt**: Sort jobs by recency
- **jobId**: Look up executions for a job
- **idempotencyKey**: Prevent duplicates on retry

## Relationships

### users → jobs (1:N)

```sql
-- A user can have many jobs
ALTER TABLE jobs ADD CONSTRAINT fk_jobs_userId
FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE;
```

**Cascade delete**: If user deleted, jobs also deleted (soft delete still applies)

### jobs → job_executions (1:N)

```sql
-- A job can have many execution attempts
ALTER TABLE job_executions ADD CONSTRAINT fk_job_executions_jobId
FOREIGN KEY (jobId) REFERENCES jobs(id) ON DELETE CASCADE;
```

**Cascade delete**: Clean up history when job deleted

### job_executions → job_logs (1:N)

```sql
-- Logs belong to specific execution
ALTER TABLE job_logs ADD CONSTRAINT fk_job_logs_executionId
FOREIGN KEY (jobExecutionId) REFERENCES job_executions(id) ON DELETE CASCADE;
```

### jobs → dead_letter_queue (1:1)

```sql
-- A failed job moves to DLQ (optional)
ALTER TABLE dead_letter_queue ADD CONSTRAINT fk_dlq_jobId
FOREIGN KEY (jobId) REFERENCES jobs(id) ON DELETE CASCADE;
```

## Storage Estimates

Assuming:

- 1000 jobs/day
- 365 days (1 year)
- 1.5 executions per job (some succeed on first try)
- 10 logs per execution
- 10 workers

```
jobs:                 ~365,000 rows  × 500 bytes = 180 MB
job_executions:       ~548,000 rows  × 300 bytes = 160 MB
job_logs:          ~5,480,000 rows  × 100 bytes = 550 MB
audit_log:         ~1,000,000 rows  × 200 bytes = 200 MB
dead_letter_queue:      ~5,000 rows  × 400 bytes = 2 MB
workers:                    ~10 rows  × 200 bytes = 2 KB
users:                  ~1,000 rows  × 300 bytes = 300 KB

Total (1 year):                                  ≈ 1.1 GB
Total (5 years):                                ≈ 5.5 GB
```

**Mitigation**:

- Archive old records annually
- Partition by date for large tables
- Delete DLQ records after X days

## Migrations

Use Prisma migrations:

```bash
pnpm --filter database run migrate dev --name add_jobs_table
```

Migrations stored in `packages/database/prisma/migrations/`

Each migration creates schema version history:

- Can rollback
- Can replay on new environments
- Tracks schema evolution

## Related Documentation

- [[DATABASE/01-Users-Table]] - Users & auth
- [[DATABASE/02-Jobs-Table]] - Job metadata
- [[DATABASE/03-Job-Executions-Table]] - Execution history
- [[DATABASE/04-Job-Logs-Table]] - Logs
- [[DATABASE/05-Workers-Table]] - Worker registry
- [[DATABASE/06-DLQ-Table]] - Dead letter queue
- [[DATABASE/07-Audit-Log-Table]] - Audit trail
- [[02-ARCHITECTURE-OVERVIEW]] - How DB fits in architecture
- [[PATTERNS/06-Audit-Trail]] - Immutable history pattern
- [[PATTERNS/01-Idempotency]] - Idempotency key pattern
