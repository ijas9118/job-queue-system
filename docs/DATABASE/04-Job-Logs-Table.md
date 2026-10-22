# Job Logs Table

## Purpose

**Immutable append-only log** of structured events during job execution. Workers emit logs; this table stores them for debugging, monitoring, and compliance.

**Critical**: Append-only, never update or delete.

## Schema

```sql
CREATE TABLE job_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jobExecutionId UUID NOT NULL,
  level VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB,
  createdAt TIMESTAMP NOT NULL DEFAULT NOW(),

  FOREIGN KEY (jobExecutionId) REFERENCES job_executions(id) ON DELETE CASCADE
);
```

## Columns

| Column           | Type        | Purpose                                     |
| ---------------- | ----------- | ------------------------------------------- |
| `id`             | UUID        | Unique log entry identifier                 |
| `jobExecutionId` | UUID        | Which execution this log belongs to         |
| `level`          | VARCHAR(20) | Log level: 'DEBUG', 'INFO', 'WARN', 'ERROR' |
| `message`        | TEXT        | Human-readable log message                  |
| `metadata`       | JSONB       | Structured key-value data                   |
| `createdAt`      | TIMESTAMP   | When log was emitted                        |

## Constraints

```sql
-- Must belong to an execution
ALTER TABLE job_logs ADD CONSTRAINT ck_job_logs_executionId NOT NULL;

-- Valid log levels
ALTER TABLE job_logs ADD CONSTRAINT ck_job_logs_level
  CHECK (level IN ('DEBUG', 'INFO', 'WARN', 'ERROR'));

-- Prevent updates and deletes
CREATE RULE prevent_job_logs_updates AS
  ON UPDATE TO job_logs DO INSTEAD NOTHING;

CREATE RULE prevent_job_logs_deletes AS
  ON DELETE TO job_logs DO INSTEAD NOTHING;
```

## Indexes

```sql
-- Find logs for an execution
CREATE INDEX idx_job_logs_executionId
  ON job_logs(jobExecutionId);

-- Find errors across all jobs
CREATE INDEX idx_job_logs_level_createdAt
  ON job_logs(level, createdAt DESC)
  WHERE level IN ('ERROR', 'WARN');

-- Search logs by level and execution
CREATE INDEX idx_job_logs_executionId_level
  ON job_logs(jobExecutionId, level);

-- Timeline analysis
CREATE INDEX idx_job_logs_createdAt
  ON job_logs(createdAt DESC);
```

**Why**:

- `executionId`: Get all logs for one execution (debugging)
- `level, createdAt`: Find recent errors (alerting, dashboard)
- `(executionId, level)`: Find errors in one execution
- `createdAt`: Timeline ordering for dashboard

## Relationships

### job_logs ← job_executions (N:1)

```sql
ALTER TABLE job_logs ADD CONSTRAINT fk_job_logs_executionId
  FOREIGN KEY (jobExecutionId) REFERENCES job_executions(id) ON DELETE CASCADE;
```

Cascade: If execution deleted, logs deleted.

## Usage Examples

### Emit Logs During Job Processing

```typescript
// In a job handler
const logger = getLogger('send-email');

logger.info('Starting email job', {
  to: payload.to,
  template: payload.template,
  executionId: execution.id,
});

try {
  const messageId = await emailService.send({
    to: payload.to,
    template: payload.template,
    variables: payload.variables,
  });

  logger.info('Email sent successfully', {
    messageId,
    to: payload.to,
    executionId: execution.id,
  });

  return { messageId };
} catch (error) {
  logger.error('Failed to send email', {
    error: error.message,
    to: payload.to,
    executionId: execution.id,
    errorCode: error.code,
  });
  throw error;
}
```

### Save Logs to Database

```typescript
// Worker's logging middleware
const pino = require('pino');
const pinoDb = require('@job-queue/logger/pinoDb');

const logger = pino(
  pinoDb.transport({
    async onLog(entry) {
      await db.jobLogs.create({
        data: {
          jobExecutionId: entry.executionId,
          level: entry.level.name,
          message: entry.msg,
          metadata: {
            ...entry,
            msg: undefined, // Don't duplicate
            level: undefined,
          },
        },
      });
    },
  })
);
```

### Query Logs for an Execution

```typescript
const logs = await db.jobLogs.findMany({
  where: { jobExecutionId: execution.id },
  orderBy: { createdAt: 'asc' },
});

// Result:
// [
//   { level: 'INFO', message: 'Starting email job', metadata: {...} },
//   { level: 'INFO', message: 'Email sent successfully', metadata: {...} },
// ]
```

### Get Execution Timeline (for debugging)

```typescript
// Show all events in order
const timeline = await db.jobLogs.findMany({
  where: { jobExecutionId: execution.id },
  orderBy: { createdAt: 'asc' },
  select: {
    createdAt: true,
    level: true,
    message: true,
    metadata: true,
  },
});

// Result in UI:
// [10:00:00.123] INFO: Starting email job
// [10:00:00.456] INFO: Connecting to SMTP server
// [10:00:01.789] INFO: Email sent successfully
```

### Find Recent Errors

```typescript
const recentErrors = await db.jobLogs.findMany({
  where: {
    level: { in: ['ERROR', 'WARN'] },
    createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) }, // Last hour
  },
  orderBy: { createdAt: 'desc' },
  take: 100,
});
```

### Analyze Error Patterns

```typescript
const errorMessages = await db.jobLogs.groupBy({
  by: ['message'],
  where: {
    level: 'ERROR',
    createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  },
  _count: true,
});

// Most common errors:
// [
//   { message: 'SMTP timeout', _count: 45 },
//   { message: 'Invalid email', _count: 12 },
//   { message: 'Authentication failed', _count: 8 }
// ]
```

### Export Logs for Analysis

```typescript
// Export all logs for a job
const allLogs = await db.jobLogs.findMany({
  where: {
    jobExecutionId: {
      in: db.jobExecutions.findMany({
        where: { jobId: job.id },
        select: { id: true },
      }),
    },
  },
  orderBy: { createdAt: 'asc' },
});

// Can send to logging service (ELK, Datadog, etc.)
sendToLoggingService(allLogs);
```

## Log Levels

### DEBUG

Development and detailed tracing.

```typescript
logger.debug('Processing step', {
  currentRetry: 2,
  nextBackoffMs: 4000,
  handlerName: 'send-email',
});
```

### INFO

Normal operational events.

```typescript
logger.info('Email sent successfully', {
  messageId: 'msg-123',
  to: 'john@example.com',
});
```

### WARN

Warning conditions (will try to recover).

```typescript
logger.warn('Retry attempt', {
  attempt: 2,
  nextRetryIn: '4 seconds',
  reason: 'SMTP timeout',
});
```

### ERROR

Error conditions (processing failed).

```typescript
logger.error('Failed to send email', {
  reason: 'SMTP authentication failed',
  smtpCode: 535,
});
```

## Metadata Best Practices

### Good Metadata

```typescript
logger.info('Job started', {
  jobId: job.id,
  jobType: job.type,
  userId: job.userId,
  queueName: job.queueName,
  payload: job.payload, // Full context
});
```

### Avoid

```typescript
// ❌ Secrets in metadata
logger.info('Connected to database', {
  password: 'super-secret', // NEVER!
});

// ❌ Huge objects
logger.info('Processing', {
  entire_database_dump: allUsers, // Too much
});

// ❌ Non-serializable objects
logger.info('Error', {
  error: Error('message'), // Can't JSON.stringify
  connection: db_connection, // Circular references
});
```

### Good

```typescript
// ✅ Structured, security-conscious
logger.info('Database error', {
  errorType: 'QueryTimeout',
  errorMessage: 'Timeout after 30s',
  table: 'jobs',
  query_duration_ms: 30000,
  // No sensitive data!
});
```

## Storage Optimization

Job logs grow quickly (10+ logs per execution, 100M+ rows in production).

### Strategies

**1. Sampling (production only)**

```typescript
// Log all errors, 10% of info
if (level === 'ERROR' || Math.random() < 0.1) {
  await db.jobLogs.create({...});
}
```

**2. Archive Old Logs**

```sql
-- Archive logs older than 30 days
INSERT INTO job_logs_archive
SELECT * FROM job_logs
WHERE createdAt < NOW() - INTERVAL '30 days';

DELETE FROM job_logs
WHERE createdAt < NOW() - INTERVAL '30 days';
```

**3. Compress Metadata**

```typescript
// Store less metadata for INFO logs
if (level === 'INFO') {
  metadata = {/* minimal */};
} else if (level === 'ERROR') {
  metadata = {/* full context */};
}
```

## Design Rationale

### Structured Logging Over Text

```typescript
// ❌ Text log (hard to parse)
"2026-07-02T10:00:00Z - Sent email to john@example.com successfully"

// ✅ Structured log (queryable)
{
  level: 'INFO',
  message: 'Email sent successfully',
  metadata: {
    to: 'john@example.com',
    messageId: 'msg-123'
  }
}
```

Structured allows:

- Grep by `to` field
- COUNT by `level`
- Analyze patterns

### One Row Per Log Entry

```typescript
// ❌ Concatenate all logs in one field
{
  id: '123',
  jobExecutionId: 'exec-123',
  allLogs: 'Started email... Connected to SMTP... Email sent...'
}

// ✅ One row per entry (queryable)
[
  { jobExecutionId: 'exec-123', message: 'Started email...' },
  { jobExecutionId: 'exec-123', message: 'Connected to SMTP...' },
  { jobExecutionId: 'exec-123', message: 'Email sent...' }
]
```

One row per entry allows:

- Filter by level efficiently
- Timeline analysis
- Skip irrelevant logs

## Related Documentation

- [[DATABASE/00-Schema-Overview]] - Schema overview
- [[DATABASE/03-Job-Executions-Table]] - Execution metadata
- [[COMPONENTS/02-Worker-Service]] - Worker logging
- [[PATTERNS/06-Audit-Trail]] - Immutable logging pattern
