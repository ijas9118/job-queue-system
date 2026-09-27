# Pattern 3: Dead Letter Queue (Poison Pill)

## The Problem

**Scenario**: Job fails repeatedly. Keeps retrying. Clogs the queue.

```
Job tries to send email to invalid address
  ↓
Attempt 1: FAILS (Invalid email)
  Wait 1s, retry
  ↓
Attempt 2: FAILS (Still invalid!)
  Wait 4s, retry
  ↓
Attempt 3: FAILS (Still invalid!)
  Wait 16s, retry
  ↓
Attempt 4: FAILS (Still invalid!)
  After 1 minute of retrying a broken job...
```

**Why is this bad?**

1. **Resource waste**: Worker cycles through same broken job repeatedly
2. **Queue blocked**: Valid jobs wait behind broken job
3. **Visibility**: Admin can't tell which jobs are poisoned
4. **Debugging**: Lost in noise of retry logs

## The Solution: Dead Letter Queue

When a job fails all retries, move it to a **dead-letter queue (DLQ)** for manual inspection.

```
Attempt 1: FAILS
Attempt 2: FAILS
Attempt 3: FAILS
Attempt 4: FAILS (maxRetries exhausted)
  ↓
Move to DLQ
  ↓
Admin notifies
Admin investigates
  ↓
Two options:
  a) Fix root cause (update job payload/config) → Replay
  b) Ignore (log as known issue)
```

## How It Works

### Flow Diagram

```
Job processing
    ↓
Handler throws error
    ↓
Check: retryCount < maxRetries?
    ├─ YES → Schedule retry
    │        status = 'delayed'
    │        retryCount++
    │        ↓ (exponential backoff)
    │        Retry
    │
    └─ NO → Move to DLQ
             status = 'dead_letter'
             ↓
        INSERT INTO dead_letter_queue
        INSERT INTO audit_log
        Emit WebSocket event
        ↓
        Admin dashboard shows warning ⚠️
        Admin can inspect & replay
```

### Implementation

```typescript
// Worker error handler
async function handleJobFailure(job: Job, error: Error) {
  const execution = await db.jobExecutions.create({
    jobId: job.id,
    attempt: job.retryCount + 1,
    status: 'failed',
    errorType: error.constructor.name,
    errorMessage: error.message,
    errorStack: error.stack
  });
  
  // Should we retry?
  if (job.retryCount < job.maxRetries) {
    // YES: Schedule retry
    const delay = calculateBackoff(job.retryCount);
    
    await db.jobs.update(job.id, {
      status: 'delayed',
      retryCount: job.retryCount + 1,
      delayUntil: new Date(Date.now() + delay)
    });
    
    await queue.scheduleRetry(job.id, delay);
    
    logger.info('Job scheduled for retry', {
      jobId: job.id,
      attempt: job.retryCount + 1,
      delayMs: delay
    });
  } else {
    // NO: Max retries exhausted, move to DLQ
    await moveToDLQ(job, error);
  }
}

async function moveToDLQ(job: Job, error: Error) {
  // Record in DLQ table
  await db.deadLetterQueue.create({
    jobId: job.id,
    lastExecutionId: execution.id,
    reason: `Max retries exceeded (${job.retryCount}/${job.maxRetries})`,
    failureCount: job.retryCount,
    canRetry: true  // Admin might be able to fix
  });
  
  // Update job status
  await db.jobs.update(job.id, {
    status: 'dead_letter'
  });
  
  // Log event
  await db.auditLog.create({
    jobId: job.id,
    action: 'job_moved_to_dlq',
    metadata: {
      failureCount: job.retryCount,
      errorType: error.constructor.name
    }
  });
  
  // Notify dashboard
  events.emit('job:dead-letter', {
    jobId: job.id,
    reason: 'Max retries exceeded'
  });
  
  logger.warn('Job moved to DLQ', {
    jobId: job.id,
    failureCount: job.retryCount
  });
}
```

## Database Schema

```sql
CREATE TABLE dead_letter_queue (
  id UUID PRIMARY KEY,
  jobId UUID NOT NULL REFERENCES jobs(id),
  lastExecutionId UUID REFERENCES job_executions(id),
  
  reason VARCHAR(500) NOT NULL,       -- Why moved to DLQ?
  failureCount INT NOT NULL,          -- How many retries?
  canRetry BOOLEAN DEFAULT true,      -- Admin can replay?
  
  movedAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT fk_dlq_jobId UNIQUE (jobId)
);

CREATE INDEX idx_dlq_movedAt ON dead_letter_queue(movedAt DESC);
```

## Admin Operations

### View DLQ

```
GET /api/v1/admin/dlq

Response:
{
  "data": [
    {
      "jobId": "job-123",
      "type": "send-email",
      "name": "Welcome email to invalid@example",
      "reason": "Max retries exceeded (3/3)",
      "failureCount": 3,
      "lastError": "Invalid email address: invalid@example",
      "movedAt": "2026-07-02T10:15:00Z"
    }
  ]
}
```

### Inspect Job Details

```
GET /api/v1/jobs/job-123

Shows:
- Original payload
- All execution attempts (3 attempts, all failed)
- Error messages from each attempt
- Logs from processing
```

### Replay from DLQ

Option 1: **Fix & Replay**

```
Admin identifies issue: Email address typo in database
Fix in source system
Replay job from DLQ:
  POST /api/v1/admin/dlq/job-123/replay
  {
    "maxRetries": 5  // Give it more chances
  }

Job returns to queue with fresh retryCount
Worker processes again
Now succeeds ✅
```

Option 2: **Ignore**

```
Admin identifies issue: User wants to unsubscribe
Don't replay
Leave in DLQ as record
```

## Real-World Examples

### Example 1: Invalid Email

```
Job: Send welcome email
Payload: { to: "invalid@example.com" }

Attempt 1: SMTP rejects (invalid domain)
Attempt 2: SMTP rejects (invalid domain)
Attempt 3: SMTP rejects (invalid domain)
  ↓
Move to DLQ

Admin view:
  Error: "SMTP 550 User unknown"
  
Admin action:
  Check customer database
  Fix email: "valid@example.com"
  Replay job
  Success ✅
```

### Example 2: Missing API Credential

```
Job: Process video via third-party API
Requires API key in config

Attempt 1: API returns 401 Unauthorized
Attempt 2: API returns 401 Unauthorized
Attempt 3: API returns 401 Unauthorized
  ↓
Move to DLQ

Admin view:
  Error: "401 Unauthorized"
  
Admin action:
  Check config: API key missing/invalid
  Update API key
  Replay job
  Success ✅
```

### Example 3: External Service Down

```
Job: Send data to third-party webhook
Webhook service temporarily down

Attempt 1: Connection refused
  (Wait 1s, retry)
Attempt 2: Connection refused
  (Wait 4s, retry)
Attempt 3: Connection timeout
  (Wait 16s, retry)
Attempt 4: Connection timeout
  ↓
Move to DLQ (after ~25 seconds)

Admin view:
  Error: "Connection timeout"
  
Admin action:
  Check if service is back online
  If yes: Replay job
  If no: Wait and replay later
```

## Monitoring

### Dashboard Shows DLQ

```
Dead Letter Queue
  Urgent: 5 jobs
  This Hour: 2 jobs
  Today: 12 jobs
  
Recent:
  - send-email (invalid email) → 3 retries
  - process-video (API error) → 3 retries
  - webhook-delivery (timeout) → 3 retries
```

### Alerts

```
If DLQ has > 10 jobs in last hour:
  → Alert admin
  → "Potential issue: Many jobs failing"

If specific job type fails > 50%:
  → Alert: "send-email has 50% failure rate"
```

## Key Decisions

### Max Retries Default: 3

```
Retry 0: Immediate
Retry 1: After 1s
Retry 2: After 4s
Retry 3: After 16s
Total: ~21 seconds of retrying
```

**Why 3?** Long enough to weather transient issues, short enough to fail fast.

### Backoff Cap: 1 hour

```
Retry 1: 2^1 = 2s
Retry 2: 2^2 = 4s
Retry 3: 2^3 = 8s
Retry 4: 2^4 = 16s
Retry 5: 2^5 = 32s
Retry 6: 2^6 = 64s (1m 4s)
Retry 7: 2^7 = 128s (2m 8s)
...
Retry N: Min(2^N, 3600s) ← Cap at 1 hour
```

**Why?** Don't wait indefinitely between retries.

## Trade-offs

| Pro | Con |
|-----|-----|
| Prevents queue clogging | Requires admin intervention |
| Clear visibility of failures | Manual replay isn't automatic |
| Captures failure context | Storage overhead (keep history) |
| Enables replay & learning | Can lose jobs if DLQ not monitored |

## Related Patterns

- [[PATTERNS/02-Exponential-Backoff]] - Retry strategy
- [[PATTERNS/04-State-Machine]] - dead_letter is a state
- [[PATTERNS/06-Audit-Trail]] - Immutable history of attempts
- [[JOB-LIFECYCLE]] - Job flows to dead_letter state

## Interview Questions

**Q: "What happens when a job fails?"**  
A: Retry with exponential backoff. After max retries, move to DLQ.

**Q: "How do you prevent queue overload?"**  
A: Move poison pills to DLQ so valid jobs aren't blocked.

**Q: "How do admins handle failed jobs?"**  
A: Inspect in DLQ, fix root cause, replay.

**Q: "What if the DLQ grows unbounded?"**  
A: Monitor it. Alert admin. Implement retention policy (delete after 30 days).

## Further Reading

- **Kafka Dead Letter Topic**: Similar concept in message systems
- **RabbitMQ Dead Letter Exchange**: Industry standard
- **AWS SQS DLQ**: Built-in DLQ support
