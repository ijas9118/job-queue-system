# Pattern 2: Exponential Backoff

## The Problem

**Naive retry**: Retry immediately when job fails.

```
Attempt 1: Fails
Retry immediately (1ms)
Attempt 2: Fails (still causes same error)
Retry immediately (1ms)
Attempt 3: Fails
Retry immediately (1ms)
...
```

**Issues**:

1. **Thundering Herd**: All retries hit the system simultaneously
2. **Wasted Resources**: Retrying immediately when issue hasn't resolved
3. **Cascading Failures**: One failing job brings down other services

## The Solution: Exponential Backoff

Wait longer each retry. Delay grows exponentially.

```
Attempt 1: Fails → Wait 1 second
Attempt 2: Fails → Wait 4 seconds (2^2)
Attempt 3: Fails → Wait 16 seconds (2^4)
Attempt 4: Fails → Move to DLQ
```

**Benefits**:

1. Gives transient issues time to resolve
2. Spreads retries over time (no thundering herd)
3. Saves resources
4. Prevents cascade failures

## Implementation

### Backoff Calculation

```typescript
function calculateBackoff(attemptNumber: number): number {
  // Base delay: 2^attemptNumber seconds (convert to ms)
  const baseDelay = Math.pow(2, attemptNumber) * 1000;

  // Add jitter (±20% randomness) to avoid thundering herd
  const jitter = baseDelay * (Math.random() - 0.5) * 0.4;

  // Cap at 1 hour max
  const maxDelay = 60 * 60 * 1000;

  return Math.min(baseDelay + jitter, maxDelay);
}

// Examples:
// Attempt 0: ~1s
// Attempt 1: ~4s
// Attempt 2: ~16s
// Attempt 3: ~64s
// Attempt 4: ~256s (4m)
// Attempt 5: ~1024s (17m)
// Attempt 6: ~3600s (1h, capped)
```

### With Jitter

Why add jitter? Prevents **thundering herd**:

```
WITHOUT jitter:
Job A fails at 10:00:00
Job A retries at 10:00:01 (same time as 100 other jobs!)
→ All hit server simultaneously → Crash

WITH jitter:
Job A fails at 10:00:00
Job A retries at 10:00:01.234 (randomized)
Job B fails at 10:00:00
Job B retries at 10:00:00.891 (different random time)
→ Retries spread across time → No crash
```

## Database Storage

When job fails, record retry schedule:

```sql
UPDATE jobs SET
  status = 'delayed',
  delayUntil = NOW() + INTERVAL '4 seconds',
  retryCount = retryCount + 1
WHERE id = ?;

-- retryCount tracks: Attempt 0? Attempt 1? etc.
```

## Redis Storage

Job scheduled in Redis delayed set:

```typescript
// Add to Redis delayed set (BullMQ handles this)
queue.scheduleRetry(jobId, 4000); // 4 seconds

// BullMQ automatically:
// 1. Calculates when job should run
// 2. Moves from active set to delayed set
// 3. Schedules it to return to queue at the right time
// 4. When time comes, moves back to queue
```

## Retry Loop Example

```
t=0s:    Job submitted, status = QUEUED

t=0.5s:  Worker picks up, status = ACTIVE

t=2s:    SMTP server timeout
         Handler throws Error('SMTP timeout')
         status = FAILED
         ↓
         Check: retryCount (0) < maxRetries (3)? YES
         ↓
         Calculate backoff: 2^0 = 1 second
         status = DELAYED
         delayUntil = t=3s
         ↓

t=3s:    Timer fires
         status = QUEUED
         Move back to queue

t=3.5s:  Worker picks up, status = ACTIVE

t=5s:    SMTP server timeout AGAIN
         Handler throws Error('SMTP timeout')
         status = FAILED
         ↓
         Check: retryCount (1) < maxRetries (3)? YES
         ↓
         Calculate backoff: 2^1 = 4 seconds
         status = DELAYED
         delayUntil = t=9s
         ↓

t=9s:    Timer fires
         status = QUEUED

t=9.5s:  Worker picks up, status = ACTIVE

t=11s:   SMTP server NOW ONLINE ✅
         Email sends successfully
         status = COMPLETED
         result = { messageId: 'msg-123' }
```

## Configuration

Job-specific retry config:

```typescript
// Submit job with custom retry settings
POST /api/v1/jobs
{
  "type": "send-email",
  "payload": {...},
  "maxRetries": 5,           // Try up to 5 times
  "idempotencyKey": "..."
}

// Or handler-level defaults
export const sendEmailHandler: JobHandler = {
  type: 'send-email',
  maxRetries: 3,             // Default max retries
  timeout: 10000,            // Timeout: 10 seconds
  execute: async (payload) => { ... }
};
```

## Advanced: Exponential Backoff with Max Delay

```typescript
function calculateBackoff(attempt: number, maxDelayMs = 3600000): number {
  // Exponential: 2^attempt
  const baseDelay = Math.pow(2, attempt) * 1000;

  // Add jitter
  const jitter = baseDelay * (Math.random() - 0.5) * 0.4;

  // Cap at maximum
  const totalDelay = baseDelay + jitter;

  return Math.min(totalDelay, maxDelayMs);
}

// Timeline:
// Attempt 0: ~1s (2^0)
// Attempt 1: ~4s (2^2)
// Attempt 2: ~16s (2^4)
// Attempt 3: ~64s (2^6)
// Attempt 4: ~256s (2^8)
// Attempt 5: ~1024s (2^10, capped if > max)
```

## Monitoring

Track retry patterns:

```sql
-- How many jobs are being retried?
SELECT
  type,
  COUNT(*) as retrying
FROM jobs
WHERE status = 'delayed'
  AND delayUntil > NOW()
GROUP BY type;

-- Which job types retry most?
SELECT
  type,
  AVG(retryCount) as avg_retries,
  MAX(retryCount) as max_retries
FROM jobs
WHERE status IN ('completed', 'dead_letter')
GROUP BY type
ORDER BY avg_retries DESC;
```

## Testing

```typescript
describe('Exponential Backoff', () => {
  it('calculates correct delays', () => {
    expect(calculateBackoff(0)).toBeLessThan(2000); // ~1s
    expect(calculateBackoff(1)).toBeLessThan(6000); // ~4s
    expect(calculateBackoff(2)).toBeLessThan(20000); // ~16s
  });

  it('adds jitter', () => {
    const delays = Array.from({ length: 100 }, () => calculateBackoff(1));

    // All different (jitter applied)
    const unique = new Set(delays);
    expect(unique.size).toBeGreaterThan(1);

    // But all in expected range
    delays.forEach((d) => {
      expect(d).toBeGreaterThan(3200); // 4s * 0.8
      expect(d).toBeLessThan(4800); // 4s * 1.2
    });
  });

  it('caps at max delay', () => {
    const veryLateAttempt = calculateBackoff(20);
    expect(veryLateAttempt).toBeLessThanOrEqual(3600000); // 1 hour
  });
});
```

## Real-World Example

**Scenario**: Sending email, but SMTP server has intermittent issues.

```
t=0s:  Job submitted
t=1s:  Worker tries → SMTP timeout
       Schedule retry: 1s delay
t=2s:  Retry → SMTP timeout
       Schedule retry: 4s delay
t=6s:  Retry → SMTP timeout
       Schedule retry: 16s delay
t=22s: Retry → SMTP connection timeout
       Schedule retry: 64s delay
t=86s: Retry → SMTP service recovered
       Email sends successfully ✅

Total elapsed: 86 seconds
But only 4 attempts made
Without backoff: Would've hammered SMTP 100+ times in same period
```

## Comparison: Strategies

| Strategy                          | Pro                    | Con                               |
| --------------------------------- | ---------------------- | --------------------------------- |
| **No retry**                      | Simple                 | Loses transient failures          |
| **Immediate retry**               | Fast recovery          | Thundering herd, wastes resources |
| **Fixed backoff** (1s every time) | Simple                 | Can miss recovery window          |
| **Exponential backoff**           | Adaptive, spreads load | Longer wait times initially       |
| **Exponential + jitter**          | ✅ Best overall        | Slightly more complex             |

## Interview Question

**Q: "Job is failing. How do you retry?"**  
A: Exponential backoff with jitter. Wait 1s, 4s, 16s between retries. Prevents thundering herd, gives transient issues time to resolve, spreads load over time.

## Related Documentation

- [[PATTERNS/03-Dead-Letter-Queue]] - After max retries
- [[JOB-LIFECYCLE/03-Retry-Logic]] - Retry mechanics
- [[COMPONENTS/02-Worker-Service]] - Implements retries
