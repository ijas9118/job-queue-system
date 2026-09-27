# State Machine (Detailed)

## Formal State Machine Definition

A **state machine** is a mathematical model with:
- **States**: Defined conditions (QUEUED, ACTIVE, COMPLETED, etc.)
- **Transitions**: Valid moves between states
- **Events**: What triggers transitions
- **Actions**: What happens during transition

## Job States

### QUEUED
**Meaning**: Job submitted, waiting in queue for worker to pick up

**Properties**:
- In Redis queue (BullMQ waiting list)
- Can be filtered/searched
- User sees as "pending"

**Transitions**:
- → ACTIVE (worker picks up)
- → DELAYED (scheduled for later)
- → CANCELLED (user cancels)

**Duration**: Minutes to hours

---

### ACTIVE
**Meaning**: Worker is processing right now

**Properties**:
- Job locked in Redis (no other worker can take it)
- Worker heartbeat active
- Logs streaming in real-time
- Progress updates possible

**Transitions**:
- → COMPLETED (success)
- → FAILED (error, retryable)
- → PAUSED (admin pause)

**Duration**: Seconds to minutes (usually)

---

### COMPLETED
**Meaning**: Job succeeded ✅

**Properties**:
- Result stored in database
- Execution history recorded
- Total duration calculated
- Terminal state (no further changes)

**Transitions**:
- (None - terminal)

**Duration**: N/A (end state)

---

### FAILED
**Meaning**: Job failed on this attempt (but may retry)

**Properties**:
- Error type, message, stack recorded
- Attempt number incremented
- Not yet terminal (decision pending)

**Transitions**:
- → DELAYED (if retries remaining)
- → DEAD_LETTER (if no retries left)

**Duration**: Immediate (temporary state)

---

### DELAYED
**Meaning**: Waiting for retry timer to expire

**Properties**:
- In Redis delayed set (not in queue yet)
- `delayUntil` timestamp stored
- Exponential backoff delay applied
- Not consuming worker resources

**Transitions**:
- → QUEUED (when delay expires)
- → CANCELLED (user cancels)

**Duration**: 1s, 4s, 16s, etc. (exponential)

---

### DEAD_LETTER
**Meaning**: Permanently failed, needs manual intervention ⚠️

**Properties**:
- Moved to dead-letter-queue table
- Failure count maxed out
- Immutable (can't auto-retry)
- Admin can inspect and replay

**Transitions**:
- → QUEUED (admin replays)

**Duration**: Days to weeks (until admin acts)

---

### CANCELLED
**Meaning**: User cancelled the job 🛑

**Properties**:
- Removed from queue
- Terminal state
- User can resubmit if needed

**Transitions**:
- (None - terminal)

**Duration**: N/A (end state)

---

### PAUSED
**Meaning**: Admin paused execution (temporary stop)

**Properties**:
- Worker stops processing
- Can be resumed
- State preserved

**Transitions**:
- → ACTIVE (resumed)
- → CANCELLED (cancel instead)

**Duration**: User-dependent

---

## State Transition Diagram (Detailed)

```
                           ┌─────────────────────┐
                           │      QUEUED         │
                           │  (waiting in queue) │
                           └──────────┬──────────┘
                                      │
                      ┌───────────────┼───────────────┐
                      │               │               │
                      ▼               ▼               ▼
             ┌──────────────┐  ┌──────────────┐  ┌─────────────┐
             │   ACTIVE     │  │  DELAYED     │  │ CANCELLED   │
             │(processing)  │  │(wait timer)  │  │  (stopped)  │
             └──────┬───────┘  └──────┬───────┘  └─────────────┘
                    │                 │               (terminal)
         ┌──────────┼──────────┐      │
         │          │          │      │
         ▼          ▼          ▼      │
    ┌──────────┐ ┌──────┐ ┌────────┐ │
    │COMPLETED │ │FAILED│ │ PAUSED │ │
    │  (✅)    │ │      │ │        │ │
    └──────────┘ └──┬───┘ └──┬─────┘ │
    (terminal)      │        │       │
                    │    ┌───▼───┐   │
                    │    │ ACTIVE│───┘
                    │    │(resume)
                    │    └───────┘
              ┌─────┴─────┐
              │           │
          Retries?   No retries
              │           │
              ▼           ▼
         ┌────────┐  ┌──────────────┐
         │DELAYED │  │ DEAD_LETTER  │
         │(wait)  │  │   (manual)   │
         └────┬───┘  └──────┬───────┘
              │             │
              └─────┬───────┘
                    │
              ┌─────▼──────┐
              │  QUEUED    │ (admin replays from DLQ)
              │(retry loop)│
              └────────────┘
```

## State Transition Table

| From | To | Trigger | Condition | Action |
|------|----|---------|-----------|---------| 
| QUEUED | ACTIVE | Worker picks up | Always | Acquire lock, start processing |
| QUEUED | DELAYED | Schedule delay | Always | Move to delayed set |
| QUEUED | CANCELLED | User cancel | Always | Remove from queue |
| ACTIVE | COMPLETED | Handler succeeds | Always | Store result, release lock |
| ACTIVE | FAILED | Handler throws | Always | Record error, check retries |
| ACTIVE | PAUSED | Admin pause | Always | Keep job state, stop worker |
| FAILED | DELAYED | Retry scheduled | retryCount < maxRetries | Calculate backoff, reschedule |
| FAILED | DEAD_LETTER | Max retries | retryCount >= maxRetries | Move to DLQ, record reason |
| DELAYED | QUEUED | Delay expires | Timer fired | Return to queue, clear delay |
| DELAYED | CANCELLED | User cancel | Always | Remove from delayed set |
| PAUSED | ACTIVE | Admin resume | Always | Resume processing |
| PAUSED | CANCELLED | Cancel | Always | Mark cancelled |

## Invalid Transitions

These should NEVER happen:

```
COMPLETED → ACTIVE    ❌ Can't reprocess completed job
COMPLETED → DELAYED   ❌ Already done
CANCELLED → ACTIVE    ❌ Cancelled means stop
CANCELLED → QUEUED    ❌ Dead is dead (user can resubmit)
DEAD_LETTER → ACTIVE  ❌ Needs manual replay
ACTIVE → QUEUED       ❌ Must fail first
```

## Transition Event Details

### Transition: QUEUED → ACTIVE

**Event**: Worker picks up job

**Preconditions**:
- Job in queue
- Worker available
- Job not locked

**Action**:
```typescript
await db.jobs.update(jobId, {
  status: 'active',
  workerId: 'worker-1',
  startedAt: NOW()
});

// Acquire lock in Redis (30 minute timeout)
await queue.lockJob(jobId);

// Log event
await db.auditLog.create({
  action: 'job_started',
  jobId, workerId
});

// Emit event
events.emit('job:started', { jobId, workerId });
```

**Postconditions**:
- Job locked in Redis
- Status updated in DB
- Event emitted for dashboard

---

### Transition: ACTIVE → COMPLETED

**Event**: Handler succeeds

**Preconditions**:
- Job in ACTIVE state
- Handler returned result

**Action**:
```typescript
const result = await handler.execute(job.payload);
const duration = Date.now() - startTime;

await db.jobExecutions.create({
  jobId,
  attempt: retryCount + 1,
  status: 'completed',
  result,
  duration
});

await db.jobs.update(jobId, {
  status: 'completed',
  completedAt: NOW(),
  result
});

// Release lock
await queue.unlockJob(jobId);

// Log
await db.auditLog.create({
  action: 'job_completed',
  jobId,
  metadata: { duration, result }
});

// Emit
events.emit('job:completed', { jobId, result, duration });
```

**Postconditions**:
- Result stored
- Lock released
- Terminal state reached

---

### Transition: ACTIVE → FAILED

**Event**: Handler throws error

**Preconditions**:
- Job in ACTIVE state
- Exception thrown

**Action**:
```typescript
const error = /* error from handler */;
const duration = Date.now() - startTime;

// Record execution
await db.jobExecutions.create({
  jobId,
  attempt: retryCount + 1,
  status: 'failed',
  errorType: error.constructor.name,
  errorMessage: error.message,
  errorStack: error.stack,
  duration
});

// Next: Check if should retry
if (retryCount < maxRetries) {
  // Go to FAILED → DELAYED transition
  ...
} else {
  // Go to FAILED → DEAD_LETTER transition
  ...
}

// Emit
events.emit('job:failed', { jobId, error });
```

---

### Transition: FAILED → DELAYED

**Event**: Retry scheduled with backoff

**Preconditions**:
- Previous attempt failed
- retryCount < maxRetries

**Action**:
```typescript
const delay = calculateBackoff(retryCount);
const delayUntil = new Date(Date.now() + delay);

await db.jobs.update(jobId, {
  status: 'delayed',
  retryCount: retryCount + 1,
  delayUntil
});

// Schedule in Redis
await queue.scheduleRetry(jobId, delay);

// Log
await db.auditLog.create({
  action: 'job_retry_scheduled',
  jobId,
  metadata: { attempt: retryCount + 1, delayMs: delay }
});

// Emit
events.emit('job:retry_scheduled', { 
  jobId, 
  attempt: retryCount + 1, 
  delayMs: delay 
});
```

---

### Transition: DELAYED → QUEUED

**Event**: Delay timer expires

**Preconditions**:
- Job in DELAYED state
- Current time >= delayUntil

**Action**:
```typescript
await db.jobs.update(jobId, {
  status: 'queued',
  delayUntil: null
});

// Return to queue in Redis
await queue.addJob(jobId);

// Log
await db.auditLog.create({
  action: 'job_delay_expired',
  jobId
});

// No emit (quiet transition, job just returns to queue)
```

---

### Transition: FAILED → DEAD_LETTER

**Event**: Max retries exhausted

**Preconditions**:
- Previous attempt failed
- retryCount >= maxRetries

**Action**:
```typescript
const lastExecution = /* most recent failed execution */;

await db.jobs.update(jobId, {
  status: 'dead_letter'
});

await db.deadLetterQueue.create({
  jobId,
  lastExecutionId: lastExecution.id,
  reason: `Max retries exceeded (${retryCount}/${maxRetries})`,
  failureCount: retryCount
});

// Log
await db.auditLog.create({
  action: 'job_moved_to_dlq',
  jobId,
  metadata: { failureCount: retryCount }
});

// Emit
events.emit('job:dead_letter', { 
  jobId, 
  reason: 'Max retries exceeded' 
});
```

## Related Documentation

- [[JOB-LIFECYCLE/00-Overview]] - Overview and examples
- [[JOB-LIFECYCLE/02-State-Transitions]] - Transition rules
- [[JOB-LIFECYCLE/03-Retry-Logic]] - Retry mechanics
- [[PATTERNS/04-State-Machine]] - State machine pattern
- [[COMPONENTS/02-Worker-Service]] - How states change
