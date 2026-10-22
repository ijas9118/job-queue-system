# Dead Letter Queue Table

## Purpose

Archive for jobs that have failed permanently after all retries exhausted. Separate table allows admin to:

- Review why jobs failed
- Inspect and debug issues
- Replay jobs with fixes
- Maintain separate retention policy

## Schema

```sql
CREATE TABLE dead_letter_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jobId UUID NOT NULL UNIQUE,
  reason VARCHAR(255) NOT NULL,
  failureCount INT NOT NULL,
  lastExecutionId UUID,
  metadata JSONB,
  createdAt TIMESTAMP NOT NULL DEFAULT NOW(),
  movedAt TIMESTAMP NOT NULL DEFAULT NOW(),
  reviewedAt TIMESTAMP,
  reviewedBy UUID,
  replayedAt TIMESTAMP,
  replayCount INT DEFAULT 0,

  FOREIGN KEY (jobId) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (lastExecutionId) REFERENCES job_executions(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewedBy) REFERENCES users(id) ON DELETE SET NULL
);
```

## Columns

| Column            | Type         | Purpose                                                        |
| ----------------- | ------------ | -------------------------------------------------------------- |
| `id`              | UUID         | DLQ entry ID                                                   |
| `jobId`           | UUID         | The failed job                                                 |
| `reason`          | VARCHAR(255) | Why it failed: 'Max retries exceeded', 'Invalid payload', etc. |
| `failureCount`    | INT          | Number of failed attempts                                      |
| `lastExecutionId` | UUID         | Last job_execution attempt                                     |
| `metadata`        | JSONB        | Structured failure info (error type, stack)                    |
| `createdAt`       | TIMESTAMP    | When job was created (original submission)                     |
| `movedAt`         | TIMESTAMP    | When moved to DLQ                                              |
| `reviewedAt`      | TIMESTAMP    | When admin reviewed it                                         |
| `reviewedBy`      | UUID         | Which admin reviewed it                                        |
| `replayedAt`      | TIMESTAMP    | When replay was triggered                                      |
| `replayCount`     | INT          | How many times replayed                                        |

## Constraints

```sql
-- Must reference a job
ALTER TABLE dead_letter_queue ADD CONSTRAINT ck_dlq_jobId NOT NULL;

-- One DLQ entry per job
ALTER TABLE dead_letter_queue ADD CONSTRAINT uq_dlq_jobId UNIQUE (jobId);

-- Valid reasons
ALTER TABLE dead_letter_queue ADD CONSTRAINT ck_dlq_reason
  CHECK (reason IN (
    'Max retries exceeded',
    'Invalid payload',
    'Validation failed',
    'Manually moved to DLQ',
    'Configuration error',
    'Unknown error type'
  ));

-- failureCount must be positive
ALTER TABLE dead_letter_queue ADD CONSTRAINT ck_dlq_failureCount
  CHECK (failureCount > 0);

-- reviewedAt can only be set once
ALTER TABLE dead_letter_queue ADD CONSTRAINT ck_dlq_reviewed
  CHECK (reviewedAt IS NULL OR reviewedBy IS NOT NULL);

-- replayCount can't be negative
ALTER TABLE dead_letter_queue ADD CONSTRAINT ck_dlq_replayCount
  CHECK (replayCount >= 0);
```

## Indexes

```sql
-- List unreviewed DLQ items
CREATE INDEX idx_dlq_reviewedAt
  ON dead_letter_queue(reviewedAt)
  WHERE reviewedAt IS NULL;

-- Find by move date (recent failures)
CREATE INDEX idx_dlq_movedAt
  ON dead_letter_queue(movedAt DESC);

-- Search by reason (common failure patterns)
CREATE INDEX idx_dlq_reason
  ON dead_letter_queue(reason);

-- Quick lookup by job
CREATE UNIQUE INDEX idx_dlq_jobId
  ON dead_letter_queue(jobId);

-- Find recently replayed jobs
CREATE INDEX idx_dlq_replayedAt
  ON dead_letter_queue(replayedAt DESC)
  WHERE replayedAt IS NOT NULL;
```

**Why**:

- `reviewedAt IS NULL`: Admin dashboard (show unreviewed items)
- `movedAt DESC`: Most recent failures
- `reason`: Identify patterns ("all InvalidPayload failures")
- `replayedAt`: Track replay activity

## Relationships

### jobs → dead_letter_queue (1:1)

```sql
ALTER TABLE dead_letter_queue ADD CONSTRAINT fk_dlq_jobId
  FOREIGN KEY (jobId) REFERENCES jobs(id) ON DELETE CASCADE;
```

**Cascade**: If job deleted, DLQ entry deleted.

### job_executions → dead_letter_queue (N:1)

```sql
ALTER TABLE dead_letter_queue ADD CONSTRAINT fk_dlq_lastExecutionId
  FOREIGN KEY (lastExecutionId) REFERENCES job_executions(id) ON DELETE SET NULL;
```

**Set NULL**: If last execution deleted, reference is null (but DLQ entry remains).

## Usage Examples

### Move Job to DLQ (after max retries)

```typescript
// In worker, after final failed attempt
if (job.retryCount >= job.maxRetries) {
  // Create DLQ entry
  await db.deadLetterQueue.create({
    data: {
      jobId: job.id,
      reason: 'Max retries exceeded',
      failureCount: job.retryCount,
      lastExecutionId: execution.id,
      movedAt: new Date(),
      metadata: {
        errorType: execution.errorType,
        errorMessage: execution.errorMessage,
        lastAttemptAt: execution.completedAt,
        jobType: job.type,
      },
    },
  });

  // Update job
  await db.jobs.update({
    where: { id: job.id },
    data: {
      status: 'dead_letter',
      movedToDLQAt: new Date(),
    },
  });
}
```

### List DLQ Items (Admin Dashboard)

```typescript
const dlqItems = await db.deadLetterQueue.findMany({
  where: {
    reviewedAt: null, // Unreviewed
  },
  orderBy: { movedAt: 'desc' },
  take: 50,
  include: {
    job: {
      select: {
        id: true,
        type: true,
        name: true,
        payload: true,
      },
    },
    lastExecution: {
      select: {
        errorType: true,
        errorMessage: true,
        errorStack: true,
      },
    },
  },
});

// Result:
// [
//   {
//     id: 'dlq-123',
//     jobId: 'job-456',
//     reason: 'Max retries exceeded',
//     failureCount: 3,
//     job: { type: 'send-email', payload: { to: 'user@example.com' } },
//     lastExecution: { errorType: 'SMTPTimeout', errorMessage: '...' }
//   }
// ]
```

### Inspect DLQ Item Details

```typescript
const dlqItem = await db.deadLetterQueue.findUnique({
  where: { jobId: jobId },
  include: {
    job: true,
    lastExecution: true,
  },
});

// Get all execution attempts for this job
const attempts = await db.jobExecutions.findMany({
  where: { jobId: dlqItem.jobId },
  orderBy: { attempt: 'asc' },
});

// Show timeline in UI
attempts.forEach((attempt) => {
  console.log(`Attempt ${attempt.attempt}: ${attempt.status}`);
  console.log(`  Error: ${attempt.errorType} - ${attempt.errorMessage}`);
  console.log(`  Duration: ${attempt.durationMs}ms`);
});
```

### Mark DLQ Item as Reviewed

```typescript
await db.deadLetterQueue.update({
  where: { jobId: jobId },
  data: {
    reviewedAt: new Date(),
    reviewedBy: adminUser.id,
  },
});
```

### Replay a DLQ Job

```typescript
// Admin fixes the issue (e.g., configuration update)
// Then replays the job

const dlqItem = await db.deadLetterQueue.findUnique({
  where: { jobId: jobId },
});

// Update original job
await db.jobs.update({
  where: { id: jobId },
  data: {
    status: 'queued', // Back to queue
    retryCount: 0, // Reset retries
    movedToDLQAt: null,
  },
});

// Update DLQ entry
await db.deadLetterQueue.update({
  where: { jobId: jobId },
  data: {
    replayedAt: new Date(),
    replayCount: { increment: 1 },
  },
});

// Worker picks it up again
logger.info('Job replayed from DLQ', { jobId, replayCount: dlqItem.replayCount + 1 });
```

### Find Common Failure Reasons

```typescript
const failurePatterns = await db.deadLetterQueue.groupBy({
  by: ['reason'],
  where: {
    movedAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  },
  _count: true,
});

// Result:
// [
//   { reason: 'Max retries exceeded', _count: 45 },
//   { reason: 'Invalid payload', _count: 12 },
//   { reason: 'Configuration error', _count: 3 }
// ]
```

### Clean Up Old DLQ Entries

```typescript
// Keep DLQ entries for 90 days, then delete
const thirtyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

const deleted = await db.deadLetterQueue.deleteMany({
  where: {
    movedAt: { lt: thirtyDaysAgo },
    replayCount: 0, // Only delete unreviewed/unreplayed
  },
});

logger.info('Cleaned DLQ', { deletedCount: deleted.count });
```

### Export DLQ for Analysis

```typescript
const allDLQ = await db.deadLetterQueue.findMany({
  include: {
    job: true,
    lastExecution: true,
    reviewedBy: { select: { email: true } },
  },
  orderBy: { movedAt: 'desc' },
});

// Export to CSV for analysis
const csv = csvStringify(
  allDLQ.map((dlq) => ({
    jobId: dlq.jobId,
    type: dlq.job.type,
    reason: dlq.reason,
    failureCount: dlq.failureCount,
    errorType: dlq.lastExecution?.errorType,
    movedAt: dlq.movedAt,
    reviewedBy: dlq.reviewedBy?.email || 'Not reviewed',
    replayed: dlq.replayCount > 0,
  }))
);

sendToAnalyticsService(csv);
```

## DLQ Workflow

```
Job fails for the Nth time
  ↓
Job status = 'failed'
  ↓
retryCount >= maxRetries?
  ↓ NO → schedule retry (update delayUntil)
  ↓ YES → Move to DLQ
    ↓
    INSERT INTO dead_letter_queue (jobId, reason, ...)
    UPDATE jobs SET status='dead_letter'
    ↓
    Admin sees in dashboard
    ↓
    Admin investigates (view logs, error details)
    ↓
    Admin fixes root cause (DB config, API key, etc.)
    ↓
    Admin clicks "Replay"
    ↓
    UPDATE jobs SET status='queued', retryCount=0
    ↓
    Worker picks up and processes again
    ↓
    Success! ✅
```

## Design Rationale

### Separate Table from Jobs

```typescript
// ✅ Separate DLQ table
// Jobs table only shows active jobs
// SELECT * FROM jobs (fast, clean)
// DLQ is archived separately
// SELECT * FROM dead_letter_queue (reviewed separately)

// ❌ Status='dead_letter' in jobs table
// Have to filter status != 'dead_letter' everywhere
// Slower queries
```

**Why separate**:

- Jobs table stays fast (active jobs only)
- DLQ is reviewed asynchronously
- Separate retention policy
- Clear conceptual boundary

### Reason String (not code)

```typescript
// ✅ Human-readable reason
reason: 'Max retries exceeded';

// ❌ Error code
reason: 'ERR_MAX_RETRIES'; // Hard to remember
```

**Why human-readable**:

- Easy to GROUP BY and analyze
- Admin understands immediately
- Better for reporting

### Replay Count (not replay flag)

```typescript
// ✅ Count replays
replayCount: 3; // Replayed 3 times

// ❌ Boolean replay flag
isReplayed: true; // Only knows if ever replayed
```

**Why count**:

- Track if job is "stuck in a loop"
- Alert if replayed > N times
- Analytics on replay patterns

## Related Documentation

- [[DATABASE/00-Schema-Overview]] - Schema overview
- [[DATABASE/02-Jobs-Table]] - Job metadata
- [[DATABASE/03-Job-Executions-Table]] - Execution history
- [[PATTERNS/03-Dead-Letter-Queue]] - DLQ pattern details
- [[COMPONENTS/01-API-Service]] - Admin endpoints for DLQ
