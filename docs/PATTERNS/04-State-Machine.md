# Pattern 4: State Machine

## The Problem

**Without explicit states**: Job can be in ambiguous conditions.

```
Is job retrying? Waiting? Stuck? Who knows?
Logs show "processing" but status is unclear
Database has contradictory data
Debugging becomes guesswork
```

## The Solution: Explicit State Machine

Every job has ONE clear state at any moment. Valid transitions are defined.

```
States: QUEUED, ACTIVE, COMPLETED, FAILED, DELAYED, DEAD_LETTER, CANCELLED, PAUSED

Valid transitions documented
Invalid transitions prevented
State changes are atomic
Clear audit trail of state history
```

## Why It Matters

### 1. Debugging

```
Job stuck?
Check state: DELAYED
Check delayUntil: 2026-07-02T10:15:00Z
Current time: 2026-07-02T10:13:00Z
→ It will return to queue in 2 minutes
Problem: None, working as designed
```

### 2. Correctness

```
Can't have:
- Job in both QUEUED and ACTIVE (invalid)
- Job completed twice (terminal state prevents)
- Job stuck in FAILED forever (transitions force decision)
```

### 3. Consistency

```
API sees: status = COMPLETED
Worker sees: status = COMPLETED (same truth)
Dashboard sees: status = COMPLETED (same truth)
No contradictions
```

## Implementation

### In Database

```sql
-- Enum type (one of defined states)
CREATE TYPE job_status AS ENUM (
  'queued',
  'active',
  'completed',
  'failed',
  'delayed',
  'dead_letter',
  'cancelled',
  'paused'
);

CREATE TABLE jobs (
  id UUID PRIMARY KEY,
  status job_status NOT NULL DEFAULT 'queued',
  -- ... other fields
);

-- Can't insert invalid state
INSERT INTO jobs (status) VALUES ('invalid'); -- ERROR
```

### In Application

```typescript
enum JobStatus {
  QUEUED = 'queued',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  FAILED = 'failed',
  DELAYED = 'delayed',
  DEAD_LETTER = 'dead_letter',
  CANCELLED = 'cancelled',
  PAUSED = 'paused',
}

// Validate state transitions
function isValidTransition(from: JobStatus, to: JobStatus): boolean {
  const validTransitions: Record<JobStatus, JobStatus[]> = {
    [JobStatus.QUEUED]: [JobStatus.ACTIVE, JobStatus.DELAYED, JobStatus.CANCELLED],
    [JobStatus.ACTIVE]: [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.PAUSED],
    [JobStatus.FAILED]: [
      JobStatus.DELAYED, // if retries left
      JobStatus.DEAD_LETTER, // if no retries
    ],
    [JobStatus.DELAYED]: [JobStatus.QUEUED, JobStatus.CANCELLED],
    [JobStatus.PAUSED]: [JobStatus.ACTIVE, JobStatus.CANCELLED],
    // Terminal states
    [JobStatus.COMPLETED]: [],
    [JobStatus.DEAD_LETTER]: [],
    [JobStatus.CANCELLED]: [],
  };

  return validTransitions[from]?.includes(to) ?? false;
}

// Only allow valid transitions
async function updateJobStatus(jobId: string, newStatus: JobStatus) {
  const job = await db.jobs.findUnique(jobId);

  if (!isValidTransition(job.status, newStatus)) {
    throw new Error(`Invalid transition: ${job.status} → ${newStatus}`);
  }

  await db.jobs.update(jobId, { status: newStatus });
}
```

## State Diagram

See [[JOB-LIFECYCLE/01-State-Machine]] for detailed diagram.

```
QUEUED → ACTIVE → COMPLETED (terminal)
  ↓                 ↓
  │            FAILED
  ↓                 ↓
DELAYED        (if retries)
  ↓
QUEUED (loop back)
            (if no retries)
                 ↓
            DEAD_LETTER (terminal)
```

## Examples

### Invalid Transition Prevention

```typescript
// Prevent invalid transition
const job = { status: 'completed', id: 'job-123' };

try {
  await updateJobStatus('job-123', 'active');
  // ERROR: Can't go from completed → active
} catch (error) {
  console.error(error.message);
}

// Correct way: Submit new job instead
const newJob = await submitJob(payload);
```

### Audit Trail

Every state change recorded:

```sql
INSERT INTO audit_log (jobId, action, metadata)
VALUES (
  'job-123',
  'job_status_changed',
  '{"from": "active", "to": "completed", "result": {...}}'
);
```

## Benefits

| Benefit                 | Example                                    |
| ----------------------- | ------------------------------------------ |
| **No ambiguous states** | Job is always in exactly one state         |
| **Prevents bugs**       | Can't accidentally reprocess completed job |
| **Debuggable**          | Know exactly what state job is in          |
| **Testable**            | Test each state and transition             |
| **Observable**          | Clear state history for monitoring         |
| **Recoverable**         | Can replay from known state                |

## Testing

```typescript
describe('Job State Transitions', () => {
  it('allows QUEUED → ACTIVE', () => {
    expect(isValidTransition('queued', 'active')).toBe(true);
  });

  it('prevents COMPLETED → ACTIVE', () => {
    expect(isValidTransition('completed', 'active')).toBe(false);
  });

  it('allows FAILED → DELAYED (if retries)', () => {
    expect(isValidTransition('failed', 'delayed')).toBe(true);
  });

  it('allows DELAYED → QUEUED (timer expires)', () => {
    expect(isValidTransition('delayed', 'queued')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    const invalidTransitions = [
      ['completed', 'queued'],
      ['cancelled', 'active'],
      ['paused', 'completed'],
      ['queued', 'failed'],
    ];

    invalidTransitions.forEach(([from, to]) => {
      expect(isValidTransition(from, to)).toBe(false);
    });
  });
});
```

## Real-World Comparison

### Without State Machine

```
"Is the job done?"
Check logs... not clear
Check database... status column has unclear value
Call API... gives different answer
→ Confusion, bugs, data corruption
```

### With State Machine

```
"Is the job done?"
Check job.status === 'completed'
→ Yes, definitively
All systems agree
Impossible to be in contradictory states
```

## Interview Question

**Q: "How do you model job lifecycle?"**  
A: Explicit state machine. Each job has one state (QUEUED, ACTIVE, COMPLETED, etc.). Valid transitions defined and enforced. Prevents ambiguous states, enables debugging, ensures consistency.

## Related Documentation

- [[JOB-LIFECYCLE/01-State-Machine]] - Detailed state machine
- [[JOB-LIFECYCLE/00-Overview]] - Job flow overview
- [[PATTERNS/06-Audit-Trail]] - Recording state changes
- [[COMPONENTS/02-Worker-Service]] - Implements transitions
