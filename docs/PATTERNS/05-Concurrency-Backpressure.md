# Pattern 5: Concurrency & Backpressure

## The Problem

**Without backpressure**: 10,000 jobs arrive instantly.

```
Process all at once in memory
→ Memory explodes
→ System crashes
→ Workers can't keep up
```

## The Solution: Backpressure

Workers process N jobs in parallel. Queue naturally throttles.

```
Queue has 10,000 jobs
Worker concurrency = 5
Worker 1 processes job A
Worker 1 processes job B
Worker 1 processes job C
Worker 1 processes job D
Worker 1 processes job E
(5 jobs in parallel, rest wait in queue)
```

## Implementation

### Worker Concurrency

```typescript
const CONCURRENCY = 5; // Jobs per worker

queue.process(CONCURRENCY, async (job) => {
  // Process job
});

// BullMQ automatically:
// - Limits to 5 concurrent jobs
// - Queues rest in Redis (doesn't load into memory)
// - Processes next when one completes
```

### Scaling

```
Light Load:
  1 API instance
  1 Worker instance (5 concurrency)
  = 5 jobs/time

Medium Load:
  2 API instances
  5 Worker instances (5 concurrency each)
  = 25 jobs/time

Heavy Load:
  4 API instances
  20 Worker instances (5 concurrency each)
  = 100 jobs/time
```

## Benefits

| Benefit | How |
|---------|-----|
| **Memory safe** | Don't load all jobs into memory |
| **Prevents overload** | Queue throttles naturally |
| **Fair processing** | Each job gets turn |
| **Resource efficient** | Use only needed resources |
| **Scalable** | Add workers as load increases |

## Testing

```typescript
describe('Backpressure', () => {
  it('limits concurrent processing', async () => {
    const queue = new JobQueue({ concurrency: 2 });
    let processing = 0;
    let maxConcurrent = 0;
    
    queue.process(async (job) => {
      processing++;
      maxConcurrent = Math.max(maxConcurrent, processing);
      await sleep(100);
      processing--;
    });
    
    // Submit 10 jobs
    for (let i = 0; i < 10; i++) {
      await queue.add({ id: i });
    }
    
    // Should never process more than 2 at once
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});
```

## Related Documentation

- [[PATTERNS/00-Overview]] - All patterns
- [[COMPONENTS/02-Worker-Service]] - Implements concurrency
- [[DEPLOYMENT]] - Scaling workers
