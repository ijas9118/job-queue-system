# Pattern 10: Graceful Shutdown

## The Problem

**Hard shutdown**: Kill worker mid-job.

```
Worker processing job
Job 90% complete
SIGKILL signal
Worker dies immediately
Job lost/incomplete
Data inconsistent
```

## The Solution: Graceful Shutdown

On SIGTERM, finish current jobs then exit (with timeout).

```
SIGTERM received
Stop accepting new jobs
Finish current jobs (max 30 seconds)
Jobs that timeout → return to queue (will retry)
Close connections
Exit cleanly
```

## Implementation

### Worker

```typescript
async function startWorker() {
  const queue = new JobQueue();
  let isShuttingDown = false;

  // Handle shutdown signals
  process.on('SIGTERM', async () => {
    logger.info('Graceful shutdown started');
    isShuttingDown = true;

    // Step 1: Stop accepting new jobs
    queue.pause();

    // Step 2: Wait for current jobs (timeout: 30s)
    const timeout = 30000;
    try {
      await queue.close(timeout);
      logger.info('All jobs completed');
    } catch (error) {
      logger.warn('Timeout waiting for jobs', { timeout });
    }

    // Step 3: Close database
    await db.$disconnect();

    // Step 4: Exit
    logger.info('Graceful shutdown complete');
    process.exit(0);
  });

  // Process jobs
  queue.process(CONCURRENCY, async (job) => {
    if (isShuttingDown) {
      throw new Error('Worker shutting down');
    }

    // Normal processing
    await handler.execute(job.payload);
  });
}
```

### API Server

```typescript
const server = app.listen(PORT, () => {
  logger.info(`API listening on :${PORT}`);
});

process.on('SIGTERM', async () => {
  logger.info('Graceful shutdown started');

  // Step 1: Stop accepting new requests
  server.close();

  // Step 2: Wait for in-flight requests (timeout: 10s)
  await new Promise((resolve) => setTimeout(resolve, 10000));

  // Step 3: Close database
  await db.$disconnect();

  // Step 4: Exit
  logger.info('Graceful shutdown complete');
  process.exit(0);
});
```

## What Happens to Jobs

```
During graceful shutdown:

Job A: 10% complete → Gets 30 seconds → Completes ✅
Job B: 50% complete → Gets 30 seconds → Completes ✅
Job C: 90% complete → Gets 30 seconds → Completes ✅
Job D: 95% complete → Timeout → Returns to queue (will retry)

Workers stop
Exit cleanly
Jobs in queue: Picked up by other workers
Jobs mid-process: Retried (idempotency prevents duplicates)
```

## Docker/K8s Integration

```yaml
# Docker compose
version: '3'
services:
  worker:
    image: job-queue-worker
    # Send SIGTERM on stop
    stop_signal: SIGTERM
    # Wait up to 40 seconds for graceful shutdown
    stop_grace_period: 40s
```

## Testing

```typescript
describe('Graceful Shutdown', () => {
  it('finishes current jobs before exiting', async () => {
    const worker = createTestWorker();
    const jobResults = [];

    worker.process(async (job) => {
      jobResults.push('started');
      await sleep(500);
      jobResults.push('completed');
    });

    // Submit 2 jobs
    await worker.queue.add({ id: 1 });
    await worker.queue.add({ id: 2 });

    // Give workers time to start processing
    await sleep(100);

    // Send shutdown signal
    worker.shutdown();

    // Wait for shutdown
    await sleep(2000);

    // Should have completed 2 jobs
    expect(jobResults.filter((r) => r === 'completed')).toHaveLength(2);
  });

  it('returns unfinished jobs to queue', async () => {
    const worker = createTestWorker();

    worker.process(async (job) => {
      // Intentionally slow
      await sleep(60000);
    });

    await worker.queue.add({ id: 1 });

    // Send shutdown with short timeout
    worker.shutdown(1000); // 1 second timeout

    await sleep(2000);

    // Job should be back in queue
    const queuedJob = await worker.queue.getWaiting();
    expect(queuedJob).toBeDefined();
  });

  it('closes database connection', async () => {
    const worker = createTestWorker();

    await worker.shutdown();

    // Should not be able to query
    expect(async () => {
      await db.jobs.findMany();
    }).toThrow();
  });
});
```

## Deployment Implications

### Blue-Green Deployment

```
Current:
  Worker-1 processing
  Worker-2 processing

Deploy new version:
  1. Send SIGTERM to Worker-1
  2. Worker-1 finishes current jobs (30s)
  3. Worker-1 exits
  4. Start Worker-3 (new version)
  5. Repeat for Worker-2

Result: Zero downtime, smooth transition
```

### Kubernetes

```yaml
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 40 # 40 second timeout
      containers:
        - name: worker
          lifecycle:
            preStop:
              exec:
                command: ['/bin/sh', '-c', 'sleep 5'] # Drain connections
```

## Related Documentation

- [[COMPONENTS/02-Worker-Service]] - Implements shutdown
- [[DEPLOYMENT]] - Deployment strategies
- [[PATTERNS/00-Overview]] - All patterns
