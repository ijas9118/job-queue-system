# Job Lifecycle Overview

## What is a Job Lifecycle?

A **job lifecycle** describes the complete journey of a job from submission to completion (or failure). Understanding this is critical because:

1. **State Visibility**: Know exactly where a job is at any moment
2. **Debugging**: When something fails, trace through states to find issues
3. **Reliability**: Explicit states prevent ambiguous situations
4. **Patterns**: Teaches state machine pattern (used everywhere in distributed systems)

## High-Level Flow

```
User submits job
    ↓
┌─ QUEUED (waiting to be processed)
│   ↓
│  ACTIVE (worker is processing)
│   ├─ SUCCESS → COMPLETED ✅
│   ├─ FAILURE → Retry? 
│   │   ├─ Yes → DELAYED (exponential backoff)
│   │   │   ↓
│   │   │   ┌─ Back to QUEUED
│   │   │   ├─ Back to ACTIVE
│   │   │   └─ If fails again → loop or DLQ
│   │   │
│   │   └─ No → DEAD_LETTER ⚠️ (manual intervention)
│   │
│   └─ CANCELLED (user stopped it)
│
└─ DELAYED (scheduled for specific time)
    └─ When delay expires → QUEUED
```

## State Definitions

| State | Meaning | Transitions | Duration |
|-------|---------|-----------|----------|
| **QUEUED** | Waiting for worker to pick up | → ACTIVE, DELAYED, CANCELLED | Minutes to hours |
| **ACTIVE** | Worker is processing right now | → COMPLETED, FAILED, PAUSED | Seconds to minutes |
| **COMPLETED** | ✅ Job succeeded | Terminal | - |
| **FAILED** | Transient failure, will retry | → DELAYED (if retries left), DEAD_LETTER | - |
| **DELAYED** | Waiting for retry timer (backoff) | → QUEUED (when timer fires) | 1s, 4s, 16s... |
| **DEAD_LETTER** | ⚠️ Permanently failed, needs investigation | → QUEUED (if replayed) | Days to weeks |
| **PAUSED** | User or admin paused | → ACTIVE (resumed), CANCELLED | User-dependent |
| **CANCELLED** | User cancelled | Terminal | - |

## Example Journey

### Happy Path (Success on First Try)

```
1. User submits job
   status = 'queued'
   payload = { to: 'user@example.com', subject: 'Welcome' }
   
2. Worker picks it up
   status = 'active'
   workerId = 'worker-1'
   startedAt = 2026-07-02T10:00:00Z
   
3. Job executes successfully
   Handler sends email
   Returns: { messageId: 'msg-123' }
   
4. Worker stores result
   status = 'completed'
   result = { messageId: 'msg-123' }
   completedAt = 2026-07-02T10:00:02Z
   duration = 2000ms
   
5. Dashboard shows COMPLETED ✅
   User happy
```

### Retry Path (Fails, Then Succeeds)

```
1. User submits job
   status = 'queued'
   
2. Worker picks it up (attempt 1)
   status = 'active'
   
3. Job fails (SMTP timeout)
   errorType = 'SMTPTimeout'
   errorMessage = 'Connection refused'
   
4. Worker checks retryCount (0) < maxRetries (3)
   ✅ Yes, schedule retry
   
5. Calculate backoff
   delay = 2^0 * 1000 + jitter = ~1000-1200ms
   
6. Reschedule
   status = 'delayed'
   retryCount = 1
   delayUntil = 2026-07-02T10:00:01Z
   
7. Wait...
   
8. Timer fires at delayUntil
   status = 'queued'
   
9. Worker picks up again (attempt 2)
   status = 'active'
   
10. Job succeeds
    status = 'completed'
    result = { messageId: 'msg-456' }
    
11. Dashboard shows COMPLETED ✅
    (But with retryCount = 1 visible)
```

### Dead Letter Path (All Retries Exhausted)

```
1. Job fails on attempt 1
   Schedule retry with 1s backoff
   
2. Job fails on attempt 2
   Schedule retry with 4s backoff
   
3. Job fails on attempt 3
   Schedule retry with 16s backoff
   
4. Job fails on attempt 4
   retryCount (3) >= maxRetries (3)
   ❌ No more retries
   
5. Move to Dead Letter Queue
   status = 'dead_letter'
   reason = 'Max retries exceeded (4/3)'
   
6. Admin is notified
   Dashboard shows warning
   
7. Admin investigates
   Checks logs: Why did it fail?
   Looks at payload: Valid?
   
8. Two options:
   a) Fix root cause, replay job
   b) Ignore (user will retry or contact support)
```

## State Transitions

### Valid Transitions

```
QUEUED        → ACTIVE, DELAYED, CANCELLED
ACTIVE        → COMPLETED, FAILED, PAUSED
FAILED        → DELAYED (retry), DEAD_LETTER (exhausted)
DELAYED       → QUEUED (timer fires)
PAUSED        → ACTIVE (resumed), CANCELLED
COMPLETED     → (terminal, no further transitions)
DEAD_LETTER   → QUEUED (admin replay)
CANCELLED     → (terminal, no further transitions)
```

### Invalid Transitions

```
COMPLETED → ACTIVE    ❌ Can't reprocess completed job
CANCELLED → QUEUED    ❌ Can't unkill a cancelled job
ACTIVE → QUEUED       ❌ Must fail first, then retry
```

## Data Recorded

For each state transition, we record:

```typescript
interface JobStateTransition {
  jobId: UUID;
  previousStatus: JobStatus;
  newStatus: JobStatus;
  timestamp: ISO8601;
  
  // Context about transition
  workerId?: string;       // Who processed it?
  errorType?: string;      // Why did it fail?
  errorMessage?: string;
  retryCount?: number;     // Retry attempt #
  result?: object;         // What was the output?
  duration?: number;       // How long did it take?
}
```

All recorded in:
- **PostgreSQL** (`jobs` table) - Current state
- **PostgreSQL** (`job_executions` table) - Execution history
- **PostgreSQL** (`audit_log` table) - Who did what, when
- **Redis** (BullMQ) - Live queue state

## How States Map to Storage

### Redis/BullMQ (Queue State)

```
'queued'  → In waiting list, ready to process
'active'  → Currently being processed (locked)
'delayed' → In delayed set, waiting for timer
'failed'  → In failed set, ready to retry
```

### PostgreSQL (Persistent State)

```
jobs.status = current state (QUEUED, ACTIVE, COMPLETED, etc.)

job_executions = history of all attempts
  - attempt 1: status = 'failed', errorType = 'Timeout'
  - attempt 2: status = 'failed', errorType = 'Timeout'  
  - attempt 3: status = 'completed', result = {...}
```

## Job Cancellation

A user can cancel a job at any time:

```
if status == 'queued':
  Remove from Redis queue
  status = 'cancelled'
  
elif status == 'delayed':
  Remove from delayed set
  status = 'cancelled'
  
elif status == 'active':
  Worker will detect cancellation
  Stop processing
  status = 'cancelled'
  
elif status == 'completed' or 'dead_letter':
  ❌ Can't cancel already-terminal job
```

## Job Pause/Resume (Admin Only)

Admin can temporarily pause a job:

```
status = 'paused'
pausedAt = NOW()

Later, admin resumes:
status = 'active'
Worker picks up where it left off (if possible)
```

## Related Documentation

- [[JOB-LIFECYCLE/01-State-Machine]] - Detailed state diagram
- [[JOB-LIFECYCLE/02-State-Transitions]] - All valid transitions
- [[JOB-LIFECYCLE/03-Retry-Logic]] - Retry & backoff strategy
- [[JOB-LIFECYCLE/04-Idempotency]] - Idempotent processing
- [[PATTERNS/04-State-Machine]] - State machine pattern (general)
- [[COMPONENTS/02-Worker-Service]] - How worker processes jobs
- [[DATABASE/00-Schema-Overview]] - Where states stored
