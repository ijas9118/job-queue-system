# Job Executions Table

## Purpose

**Immutable append-only history** of every job execution attempt. Each row represents one processing attempt, regardless of success or failure.

**Critical**: Never update these rows. Only INSERT.

## Schema

```sql
CREATE TABLE job_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jobId UUID NOT NULL,
  workerId VARCHAR(255),
  attempt INT NOT NULL,
  status VARCHAR(50) NOT NULL,
  startedAt TIMESTAMP NOT NULL,
  completedAt TIMESTAMP,
  durationMs INT,
  result JSONB,
  errorType VARCHAR(255),
  errorMessage TEXT,
  errorStack TEXT,
  createdAt TIMESTAMP NOT NULL DEFAULT NOW(),

  FOREIGN KEY (jobId) REFERENCES jobs(id) ON DELETE CASCADE
);
```

## Columns

| Column         | Type         | Purpose                                       |
| -------------- | ------------ | --------------------------------------------- |
| `id`           | UUID         | Unique execution identifier                   |
| `jobId`        | UUID         | Which job this execution belongs to           |
| `workerId`     | VARCHAR(255) | Which worker processed it (for debugging)     |
| `attempt`      | INT          | Attempt number (1 = first, 2 = first retry)   |
| `status`       | VARCHAR(50)  | 'success' or 'failure'                        |
| `startedAt`    | TIMESTAMP    | When worker started processing                |
| `completedAt`  | TIMESTAMP    | When execution finished (success or failure)  |
| `durationMs`   | INT          | completedAt - startedAt in milliseconds       |
| `result`       | JSONB        | Result data (on success)                      |
| `errorType`    | VARCHAR(255) | Error class: 'SMTPTimeout', 'ValidationError' |
| `errorMessage` | TEXT         | Human-readable error message                  |
| `errorStack`   | TEXT         | Full stack trace for debugging                |
| `createdAt`    | TIMESTAMP    | When this row was created                     |

## Constraints

```sql
-- Must belong to a job
ALTER TABLE job_executions ADD CONSTRAINT ck_job_exec_jobId NOT NULL;

-- Valid statuses
ALTER TABLE job_executions ADD CONSTRAINT ck_job_exec_status
  CHECK (status IN ('success', 'failure'));

-- Attempt must be >= 1
ALTER TABLE job_executions ADD CONSTRAINT ck_job_exec_attempt
  CHECK (attempt >= 1);

-- completedAt must be after startedAt
ALTER TABLE job_executions ADD CONSTRAINT ck_job_exec_timestamps
  CHECK (completedAt IS NULL OR completedAt >= startedAt);

-- durationMs consistency check
ALTER TABLE job_executions ADD CONSTRAINT ck_job_exec_duration
  CHECK (durationMs IS NULL OR (
    EXTRACT(EPOCH FROM (completedAt - startedAt)) * 1000 = durationMs
  ));

-- Don't allow updates - this table is immutable!
CREATE RULE prevent_job_execution_updates AS
  ON UPDATE TO job_executions DO INSTEAD NOTHING;

CREATE RULE prevent_job_execution_deletes AS
  ON DELETE TO job_executions DO INSTEAD NOTHING;
```

## Indexes

```sql
-- Find all executions for a job
CREATE INDEX idx_job_executions_jobId
  ON job_executions(jobId);

-- Find recent failures (for debugging)
CREATE INDEX idx_job_executions_status_createdAt
  ON job_executions(status, createdAt DESC)
  WHERE status = 'failure';

-- Find executions by worker (for worker debugging)
CREATE INDEX idx_job_executions_workerId
  ON job_executions(workerId, startedAt DESC);

-- Analytics: execution duration
CREATE INDEX idx_job_executions_durationMs
  ON job_executions(durationMs)
  WHERE status = 'success';

-- Most recent execution for a job
CREATE INDEX idx_job_executions_jobId_attempt
  ON job_executions(jobId, attempt DESC);
```

**Why**:

- `jobId`: Retrieve all attempts for one job (debugging)
- `status, createdAt`: Find recent failures across all jobs
- `workerId`: Find jobs processed by a specific worker
- `durationMs`: Performance analytics
- `(jobId, attempt DESC)`: Get latest execution quickly

## Relationships

### job_executions ← jobs (N:1)

```sql
ALTER TABLE job_executions ADD CONSTRAINT fk_job_exec_jobId
  FOREIGN KEY (jobId) REFERENCES jobs(id) ON DELETE CASCADE;
```

Cascade: If job deleted, all executions deleted.

### job_executions → job_logs (1:N)

One execution can have many log lines.

## Usage Examples

### Record Successful Execution

```typescript
const execution = await db.jobExecutions.create({
  data: {
    jobId: job.id,
    workerId: 'worker-1',
    attempt: 1,
    status: 'success',
    startedAt: new Date(),
    completedAt: new Date(),
    durationMs: 234,
    result: {
      messageId: 'msg-123',
      to: 'john@example.com',
    },
  },
});
```

### Record Failed Execution

```typescript
const execution = await db.jobExecutions.create({
  data: {
    jobId: job.id,
    workerId: 'worker-1',
    attempt: 1,
    status: 'failure',
    startedAt: new Date(),
    completedAt: new Date(),
    durationMs: 5000,
    errorType: 'SMTPTimeout',
    errorMessage: 'Connection timeout after 5s',
    errorStack: error.stack,
  },
});
```

### Check if Job Already Completed (Idempotency)

```typescript
// Before processing, check if already succeeded
const lastExecution = await db.jobExecutions.findFirst({
  where: { jobId: job.id },
  orderBy: { attempt: 'desc' },
});

if (lastExecution?.status === 'success') {
  // Already completed, don't process again
  return lastExecution.result;
}
```

### Get Job's Execution History

```typescript
const history = await db.jobExecutions.findMany({
  where: { jobId: job.id },
  orderBy: { attempt: 'asc' },
});

// Result:
// [
//   { attempt: 1, status: 'failure', errorMessage: 'SMTP timeout' },
//   { attempt: 2, status: 'failure', errorMessage: 'SMTP timeout' },
//   { attempt: 3, status: 'success', result: {...} }
// ]
```

### Analyze Performance by Error Type

```typescript
const errorAnalysis = await db.jobExecutions.groupBy({
  by: ['errorType'],
  where: {
    status: 'failure',
    createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  },
  _count: true,
  _avg: { durationMs: true },
});

// Result:
// [
//   { errorType: 'SMTPTimeout', _count: 45, _avg: { durationMs: 5234 } },
//   { errorType: 'ValidationError', _count: 12, _avg: { durationMs: 234 } }
// ]
```

### Find Longest Running Jobs

```typescript
const slowJobs = await db.jobExecutions.findMany({
  where: {
    status: 'success',
    durationMs: { gt: 10000 }, // > 10 seconds
  },
  orderBy: { durationMs: 'desc' },
  take: 10,
});
```

### Get Worker's Processing Stats

```typescript
const workerStats = await db.jobExecutions.groupBy({
  by: ['workerId'],
  where: {
    createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) }, // Last hour
  },
  _count: true,
  _avg: { durationMs: true },
});

// Result:
// [
//   { workerId: 'worker-1', _count: 234, _avg: { durationMs: 2134 } },
//   { workerId: 'worker-2', _count: 198, _avg: { durationMs: 1956 } }
// ]
```

## Immutability Guarantees

### Why No Updates?

```typescript
// ❌ Never do this
await db.jobExecutions.update({
  where: { id: executionId },
  data: { status: 'success' }  // WRONG!
});

// ✅ Always insert new execution
await db.jobExecutions.create({
  data: { jobId, attempt: 2, status: 'success', ... }
});
```

**Benefits of immutability**:

- Complete audit trail (can't hide failures)
- Replay history exactly
- Compliance/legal requirements
- Debugging (see exact sequence of events)

### Prevent Accidental Updates

The database enforces this:

```sql
-- Prevent any UPDATE
CREATE RULE prevent_job_execution_updates AS
  ON UPDATE TO job_executions DO INSTEAD NOTHING;

-- Prevent any DELETE
CREATE RULE prevent_job_execution_deletes AS
  ON DELETE TO job_executions DO INSTEAD NOTHING;
```

If someone tries to update/delete, PostgreSQL silently ignores it:

```typescript
// This will succeed but do nothing
await db.jobExecutions.update({
  where: { id: '123' },
  data: { status: 'different' },
});

// Row is unchanged - rules prevented the operation
```

## Design Rationale

### Every Attempt Gets a Row

```
Job submission
  ↓
Attempt 1: Worker picks up, fails with timeout
  → INSERT INTO job_executions (attempt=1, status='failure', errorType='Timeout')
  ↓
Retry scheduled
  ↓
Attempt 2: Different worker picks up, fails with validation error
  → INSERT INTO job_executions (attempt=2, status='failure', errorType='ValidationError')
  ↓
Retry scheduled
  ↓
Attempt 3: Worker picks up, succeeds
  → INSERT INTO job_executions (attempt=3, status='success', result={...})
```

**One row per attempt** = complete history.

### Structured Errors

```typescript
// Good for analysis
{
  errorType: 'SMTPTimeout',      // Category (can COUNT by type)
  errorMessage: 'Connection refused on smtp.example.com:587',  // Readable
  errorStack: 'at SMTPClient.connect() ...'  // Debugging
}
```

Enables:

- Group failures by type
- Find patterns
- Debug specific issues

### Worker ID Tracking

```typescript
// Know which worker processed job
{
  workerId: 'worker-1',
  attempt: 3,
  result: { messageId: '123' }
}
```

If result is wrong, can check worker logs. Useful for:

- Debugging worker-specific issues
- Load balancing analysis
- Worker performance monitoring

## Related Documentation

- [[DATABASE/00-Schema-Overview]] - Schema overview
- [[DATABASE/02-Jobs-Table]] - Job metadata
- [[DATABASE/04-Job-Logs-Table]] - Detailed logs
- [[PATTERNS/06-Audit-Trail]] - Immutable history pattern
- [[JOB-LIFECYCLE/00-Overview]] - Job processing flow
