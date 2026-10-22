# Jobs Table

## Purpose

Central job metadata registry. Stores current state and summary info for all jobs. Redis owns active queue state; this table owns historical and state truth.

## Schema

```sql
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  userId UUID NOT NULL,
  type VARCHAR(100) NOT NULL,
  name VARCHAR(255),
  queueName VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'queued',
  priority INT DEFAULT 0,
  payload JSONB NOT NULL,
  result JSONB,
  maxRetries INT NOT NULL DEFAULT 3,
  retryCount INT NOT NULL DEFAULT 0,
  idempotencyKey VARCHAR(255),
  delayUntil TIMESTAMP,
  createdAt TIMESTAMP NOT NULL DEFAULT NOW(),
  startedAt TIMESTAMP,
  completedAt TIMESTAMP,
  failedAt TIMESTAMP,
  movedToDLQAt TIMESTAMP,
  cancelledAt TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Tags for filtering
  tags JSONB,

  -- Timing analysis
  estimatedDurationMs INT,

  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
```

## Columns

| Column                | Type         | Purpose                                                                                   |
| --------------------- | ------------ | ----------------------------------------------------------------------------------------- |
| `id`                  | UUID         | Unique job identifier                                                                     |
| `userId`              | UUID         | Owner of this job                                                                         |
| `type`                | VARCHAR(100) | Job type: 'send-email', 'process-payment', etc.                                           |
| `name`                | VARCHAR(255) | Human-readable job name                                                                   |
| `queueName`           | VARCHAR(100) | Queue this job belongs to: 'email', 'payment', 'background'                               |
| `status`              | VARCHAR(50)  | Current state: queued, active, completed, failed, delayed, dead_letter, cancelled, paused |
| `priority`            | INT          | 0 = normal, 1+ = higher priority, -1 = lower                                              |
| `payload`             | JSONB        | Input data for the job handler                                                            |
| `result`              | JSONB        | Result after successful completion                                                        |
| `maxRetries`          | INT          | Max retry attempts before moving to DLQ                                                   |
| `retryCount`          | INT          | Current retry count                                                                       |
| `idempotencyKey`      | VARCHAR(255) | Unique key per user for duplicate prevention                                              |
| `delayUntil`          | TIMESTAMP    | If delayed, when to retry                                                                 |
| `createdAt`           | TIMESTAMP    | Job submission time                                                                       |
| `startedAt`           | TIMESTAMP    | First processing start                                                                    |
| `completedAt`         | TIMESTAMP    | Successful completion time                                                                |
| `failedAt`            | TIMESTAMP    | Last failure time                                                                         |
| `movedToDLQAt`        | TIMESTAMP    | When moved to dead letter queue                                                           |
| `updatedAt`           | TIMESTAMP    | Last status update                                                                        |
| `cancelledAt`         | TIMESTAMP    | Set when `status` transitions to `'cancelled'`                                            |
| `tags`                | JSONB        | Array of tags: `["stripe", "invoice", "urgent"]`                                          |
| `estimatedDurationMs` | INT          | Job execution time estimate for analytics                                                 |

## Constraints

```sql
-- Must belong to a user
ALTER TABLE jobs ADD CONSTRAINT ck_jobs_userId NOT NULL;

-- Valid status values
ALTER TABLE jobs ADD CONSTRAINT ck_jobs_status
  CHECK (status IN ('queued', 'active', 'completed', 'failed', 'delayed', 'dead_letter', 'cancelled', 'paused'));

-- retryCount can't exceed maxRetries
ALTER TABLE jobs ADD CONSTRAINT ck_jobs_retryCount
  CHECK (retryCount <= maxRetries);

-- priority is reasonable range
ALTER TABLE jobs ADD CONSTRAINT ck_jobs_priority
  CHECK (priority >= -100 AND priority <= 100);

-- Idempotency key unique per user (not global)
ALTER TABLE jobs ADD CONSTRAINT uq_jobs_idempotencyKey
  UNIQUE (userId, idempotencyKey) WHERE idempotencyKey IS NOT NULL;
```

## Indexes

```sql
-- Most critical
CREATE INDEX idx_jobs_userId_status_createdAt
  ON jobs(userId, status, createdAt DESC)
  WHERE cancelledAt IS NULL;

CREATE INDEX idx_jobs_status
  ON jobs(status)
  WHERE cancelledAt IS NULL;

CREATE INDEX idx_jobs_queueName_status
  ON jobs(queueName, status)
  WHERE cancelledAt IS NULL;

-- For retries
CREATE INDEX idx_jobs_delayUntil
  ON jobs(delayUntil)
  WHERE status = 'delayed' AND cancelledAt IS NULL;

-- For idempotency
CREATE UNIQUE INDEX idx_jobs_idempotency
  ON jobs(userId, idempotencyKey)
  WHERE idempotencyKey IS NOT NULL AND cancelledAt IS NULL;

-- For analytics
CREATE INDEX idx_jobs_createdAt_status
  ON jobs(createdAt DESC, status)
  WHERE cancelledAt IS NULL;

-- For DLQ lookup
CREATE INDEX idx_jobs_movedToDLQAt
  ON jobs(movedToDLQAt DESC)
  WHERE movedToDLQAt IS NOT NULL;
```

**Why**:

- `(userId, status, createdAt)`: Main query - "my jobs ordered by recency, filtered by status"
- `status`: Dashboard counts by status
- `(queueName, status)`: Queue-specific analytics
- `delayUntil`: Worker needs to find jobs ready to retry
- `idempotencyKey`: Prevent duplicate submissions
- `movedToDLQAt`: Find jobs needing review

## Relationships

### users → jobs (1:N)

```sql
ALTER TABLE jobs ADD CONSTRAINT fk_jobs_userId
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE;
```

### jobs → job_executions (1:N)

One job can have many execution attempts.

### jobs → dead_letter_queue (1:1)

Optional - only if job fails permanently.

## Usage Examples

### Submit a Job

```typescript
// Check for duplicate (idempotency)
const existing = await db.jobs.findUnique({
  where: {
    jobs_userId_idempotencyKey: {
      userId: user.id,
      idempotencyKey: 'stripe-evt-123',
    },
  },
});

if (existing) return existing;

// Create new job
const job = await db.jobs.create({
  data: {
    userId: user.id,
    type: 'send-email',
    name: 'Welcome email for john@example.com',
    queueName: 'email',
    status: 'queued',
    payload: { to: 'john@example.com', template: 'welcome' },
    maxRetries: 3,
    idempotencyKey: 'stripe-evt-123',
    tags: ['stripe', 'invoice'],
  },
});
```

### Query User's Jobs

```typescript
const jobs = await db.jobs.findMany({
  where: {
    userId: user.id,
    cancelledAt: null,
  },
  orderBy: { createdAt: 'desc' },
  take: 50,
});
```

### Get Jobs Ready for Retry

```typescript
const readyToRetry = await db.jobs.findMany({
  where: {
    status: 'delayed',
    delayUntil: { lte: new Date() },
    cancelledAt: null,
  },
});
```

### Update Job Status

```typescript
// Start processing
await db.jobs.update({
  where: { id: jobId },
  data: {
    status: 'active',
    startedAt: new Date(),
    updatedAt: new Date(),
  },
});

// Mark completed
await db.jobs.update({
  where: { id: jobId },
  data: {
    status: 'completed',
    result: { messageId: 'msg-123' },
    completedAt: new Date(),
    updatedAt: new Date(),
  },
});

// Schedule retry
await db.jobs.update({
  where: { id: jobId },
  data: {
    status: 'delayed',
    retryCount: { increment: 1 },
    delayUntil: new Date(Date.now() + 4000), // Exponential backoff
    failedAt: new Date(),
    updatedAt: new Date(),
  },
});
```

### Dashboard Stats

```typescript
const stats = await db.jobs.groupBy({
  by: ['status'],
  where: {
    queueName: 'email',
    createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    cancelledAt: null,
  },
  _count: true,
});

// Result:
// { status: 'queued', _count: 45 }
// { status: 'active', _count: 3 }
// { status: 'completed', _count: 892 }
// { status: 'failed', _count: 2 }
```

### Cancel a Job

```typescript
await db.jobs.update({
  where: { id: jobId },
  data: {
    status: 'cancelled',
    cancelledAt: new Date(),
    updatedAt: new Date(),
  },
});
```

## Design Decisions

### JSONB for Payload and Result

- **Flexible schema**: Different job types have different inputs/outputs
- **Type safety in app**: Validate with Zod before storing
- **Queryable in SQL**: Can use `@>` operator for complex queries
- **Not searchable by default**: Add computed fields for frequent queries

### Status Field (not in Redis)

```typescript
// ❌ Truth in Redis only - can lose state
const jobState = await redis.get('job:123');

// ✅ Truth in PostgreSQL
const job = await db.jobs.findUnique({ where: { id: '123' } });
const status = job.status; // Single source of truth
```

**Why**: Redis can be flushed, restarted, or lost. Database is durable.

### Idempotency Key Scoped to User

```typescript
// ✅ Correct: per-user idempotency
UNIQUE(userId, idempotencyKey);

// ❌ Wrong: global idempotency
UNIQUE(idempotencyKey);
```

**Why**: Different users can retry the same request independently.

### Soft Deletes

- Cancelled jobs stay in DB for analytics
- Can restore accidental cancellations
- Audit trail remains intact

## Related Documentation

- [[DATABASE/00-Schema-Overview]] - Schema overview
- [[DATABASE/03-Job-Executions-Table]] - Execution history
- [[JOB-LIFECYCLE/00-Overview]] - Job state transitions
- [[PATTERNS/01-Idempotency]] - Idempotency pattern
- [[COMPONENTS/01-API-Service]] - Job submission API
