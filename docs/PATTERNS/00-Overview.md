# Design Patterns Overview

## What We're Teaching

This system implements **10 fundamental patterns** used in distributed systems, job queues, and backend architecture. Learning these patterns is the core educational value of this project.

## Quick Reference

| #   | Pattern                                  | Problem Solved           | Example                                       |
| --- | ---------------------------------------- | ------------------------ | --------------------------------------------- |
| 1   | [[PATTERNS/01-Idempotency]]              | Duplicate processing     | Webhook fires twice, both create same job     |
| 2   | [[PATTERNS/02-Exponential-Backoff]]      | Retry storms             | Retry with 1s, 4s, 16s delays (not constant)  |
| 3   | [[PATTERNS/03-Dead-Letter-Queue]]        | Poison pills             | Failed job moved to DLQ for manual review     |
| 4   | [[PATTERNS/04-State-Machine]]            | Ambiguous states         | Explicit job states prevent bugs              |
| 5   | [[PATTERNS/05-Concurrency-Backpressure]] | System overload          | Workers process N jobs parallel, not infinite |
| 6   | [[PATTERNS/06-Audit-Trail]]              | Compliance & debugging   | Immutable history of every attempt            |
| 7   | [[PATTERNS/07-Redis-vs-PostgreSQL]]      | Performance + durability | Fast queue + durable history                  |
| 8   | [[PATTERNS/08-RBAC]]                     | Security                 | Admin can do everything, users see own jobs   |
| 9   | [[PATTERNS/09-Real-Time-Updates]]        | User experience          | WebSocket shows progress without polling      |
| 10  | [[PATTERNS/10-Graceful-Shutdown]]        | Clean restarts           | Workers finish jobs before stopping           |

## Pattern Dependency Graph

```
Core Patterns (Foundation):
├── State Machine (4)
│   └── Used by all job lifecycle
├── RBAC (8)
│   └── Used by API for permissions
└── Audit Trail (6)
    └── Records all state changes

Reliability Patterns:
├── Idempotency (1)
│   └── Prevents duplicate processing
├── Exponential Backoff (2)
│   └── Implements smart retries
└── Dead Letter Queue (3)
    └── Handles permanently failed jobs

Infrastructure Patterns:
├── Concurrency & Backpressure (5)
│   └── Protects system from overload
├── Redis vs PostgreSQL (7)
│   └── Separates concerns
└── Graceful Shutdown (10)
    └── Clean resource cleanup

UX Patterns:
└── Real-Time Updates (9)
    └── WebSocket for live status
```

## Learning Path

### Day 1: Foundations

1. **State Machine** - Understand explicit states
2. **RBAC** - Permission model
3. **Audit Trail** - Immutable history

### Day 2: Reliability

4. **Idempotency** - Duplicate safety
5. **Exponential Backoff** - Smart retries
6. **Dead Letter Queue** - Poison pill handling

### Day 3: Infrastructure

7. **Concurrency & Backpressure** - System protection
8. **Redis vs PostgreSQL** - Separation of concerns
9. **Graceful Shutdown** - Clean operations

### Day 4: Polish

10. **Real-Time Updates** - User experience

## Pattern Descriptions (Short)

### 1️⃣ Idempotency

**Problem**: Job submission API gets called twice (network retry, webhook duplicate).

**Solution**: Attach idempotency key. Same key = same result, no side effects.

**Example**:

```
First request:  POST /jobs with idempotencyKey='stripe-evt-123' → Creates job
Retry request:  POST /jobs with idempotencyKey='stripe-evt-123' → Returns existing job
```

**Interview**: "How do you handle webhook duplicates?" → Idempotency key

---

### 2️⃣ Exponential Backoff

**Problem**: Job fails, retry immediately, fails again. Retrying instantly causes thundering herd.

**Solution**: Wait longer each time: 1s, 4s, 16s, 64s...

**Example**:

```
Attempt 1: Fails → wait 1s
Attempt 2: Fails → wait 4s (2^2)
Attempt 3: Fails → wait 16s (2^4)
Attempt 4: Fails → move to DLQ
```

**Interview**: "How do you retry failed jobs?" → Exponential backoff with jitter

---

### 3️⃣ Dead Letter Queue

**Problem**: Job fails repeatedly. Moving it keeps failing. It's a "poison pill."

**Solution**: Move to dead-letter queue for manual inspection.

**Example**:

```
After 3 retries fail:
  Move to DLQ
  Admin reviews logs
  Fix root cause (bad payload? missing config?)
  Replay from DLQ
```

**Interview**: "What happens when a job fails permanently?" → DLQ pattern

---

### 4️⃣ State Machine

**Problem**: Job can be in ambiguous states (is it retrying? waiting? stuck?).

**Solution**: Explicit states with valid transitions.

**Example**:

```
queued → active → completed ✅
  ↓
failed → (if retries left) delayed → queued (loop back)
  ↓
       (if no retries) dead_letter ⚠️
```

**Interview**: "How do you model job lifecycle?" → State machine

---

### 5️⃣ Concurrency & Backpressure

**Problem**: 10,000 jobs arrive instantly. Process all at once → Memory explosion.

**Solution**: Workers process N jobs in parallel. Queue naturally throttles.

**Example**:

```
Worker concurrency = 5
10,000 jobs available
Worker processes 5 at a time
Rest wait in queue (doesn't load into memory)
```

**Interview**: "How do you prevent system overload?" → Backpressure

---

### 6️⃣ Audit Trail

**Problem**: Job failed. Where did it fail? What was the state? Can we replay?

**Solution**: Immutable history of every attempt (append-only).

**Example**:

```
job_executions (never updated):
  - attempt 1: failed, error = 'Timeout', duration = 2s
  - attempt 2: failed, error = 'Timeout', duration = 2s
  - attempt 3: success, result = {...}, duration = 1s
```

**Interview**: "How do you debug failed jobs?" → Audit trail + immutability

---

### 7️⃣ Redis vs PostgreSQL

**Problem**: Need fast queue for responsiveness AND durable history for reliability.

**Solution**: Separate concerns. Redis owns active state. PostgreSQL owns history.

**Example**:

```
Redis:       Active queues (who's waiting/processing?)
PostgreSQL:  History (what happened?)

If Redis crashes → rebuild from PostgreSQL
If PostgreSQL crashes → queue still works, flush to DB later
```

**Interview**: "Why two databases?" → Separation of concerns

---

### 8️⃣ RBAC

**Problem**: Not all users should see all jobs or retry failed jobs.

**Solution**: Role-based permissions (admin vs user).

**Example**:

```
Admin:  Can view all jobs, retry any, manage DLQ
User:   Can only see own jobs, retry own failures
```

**Interview**: "How do you handle permissions?" → RBAC middleware

---

### 9️⃣ Real-Time Updates

**Problem**: User submits job, refreshes dashboard every second to check status.

**Solution**: WebSocket subscriptions. Server pushes updates.

**Example**:

```
User sees job submitted
WebSocket receives: job:started (worker picked it up)
WebSocket receives: job:progress (50% complete)
WebSocket receives: job:completed (done!)
All without page refresh
```

**Interview**: "How do you show live job status?" → WebSocket events

---

### 🔟 Graceful Shutdown

**Problem**: Kill worker mid-job. In-flight work lost. State inconsistent.

**Solution**: On SIGTERM, finish current jobs (timeout: 30s) then exit.

**Example**:

```
Worker receives SIGTERM
  Stop accepting new jobs
  Finish current jobs (wait up to 30s)
  Jobs that timeout moved back to queue
  Close connections cleanly
  Exit
```

**Interview**: "How do you restart workers safely?" → Graceful shutdown

---

## Cross-Pattern Interactions

### Idempotency + Exponential Backoff

```
Job fails (attempt 1)
Retry after 1s
Check idempotency: Has it succeeded elsewhere? No.
Process again
(Prevents duplicate email sends on retry)
```

### State Machine + Audit Trail

```
Each state transition recorded immutably
queued → (logged)
active → (logged)
failed → (logged, with error)
delayed → (logged, with backoff)
completed → (logged, with result)
(Can replay entire history)
```

### RBAC + Audit Trail

```
User retries job
Audit log records: 'user-123 retried job-456'
Only user's own jobs (RBAC check)
But admin can see who did what (audit trail)
```

### Concurrency + Dead Letter Queue

```
Worker 1 processing job
Crashes
Job timeout in Redis (30min)
Returns to queue
Worker 2 picks up
Fails again
After max retries → DLQ
(Backpressure prevented memory explosion)
```

## Related Documentation

- [[01-PROJECT-OVERVIEW]] - Why we're learning these patterns
- [[PATTERNS/01-Idempotency]] - Pattern 1 details
- [[PATTERNS/02-Exponential-Backoff]] - Pattern 2 details
- [[PATTERNS/03-Dead-Letter-Queue]] - Pattern 3 details
- [[PATTERNS/04-State-Machine]] - Pattern 4 details
- [[PATTERNS/05-Concurrency-Backpressure]] - Pattern 5 details
- [[PATTERNS/06-Audit-Trail]] - Pattern 6 details
- [[PATTERNS/07-Redis-vs-PostgreSQL]] - Pattern 7 details
- [[PATTERNS/08-RBAC]] - Pattern 8 details
- [[PATTERNS/09-Real-Time-Updates]] - Pattern 9 details
- [[PATTERNS/10-Graceful-Shutdown]] - Pattern 10 details
