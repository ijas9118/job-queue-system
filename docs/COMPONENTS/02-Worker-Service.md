# Worker Service (`apps/worker`)

## Overview

The **Worker Service** is the job processor. It listens to Redis queues, executes jobs using registered handlers, implements retry logic, and records execution history.

**Location**: `apps/worker`  
**Language**: TypeScript (Node.js)  
**Purpose**: Process jobs from the queue  
**Scalability**: Run multiple instances in parallel

## Responsibilities

### ✅ Worker Handles

- **Queue Listening**: Monitor Redis for new jobs
- **Job Execution**: Run job handlers
- **Retry Logic**: Implement exponential backoff
- **Failure Handling**: Move failed jobs to DLQ
- **History Recording**: Store execution results in PostgreSQL
- **Event Emission**: Emit events for real-time updates
- **Idempotency Checking**: Skip re-processing if already succeeded
- **Graceful Shutdown**: Clean stop on SIGTERM

### ❌ Worker Does NOT

- **Accept User Input**: API validates input
- **Expose HTTP APIs**: No REST endpoints
- **Make Decisions**: Just executes handlers
- **Store State Locally**: Everything in DB/Redis

## Job Processing Cycle

```
┌─────────────────────────────────────────┐
│  Worker Starts                          │
│  Connect to Redis + PostgreSQL          │
└────────────────┬────────────────────────┘
                 │
                 ▼
         ┌──────────────────┐
         │ Listen to Queue  │
         │ (BullMQ)         │
         └────────┬─────────┘
                  │
         Job Available?
         │        │        │
        NO      YES       │
         │       ↓        │
         └←──────────────→┘
                  │
                  ▼
      ┌──────────────────────────┐
      │ Fetch Job Details        │
      │ From PostgreSQL          │
      └────────┬─────────────────┘
               │
               ▼
    ┌─────────────────────────────┐
    │ Check Idempotency           │
    │ (Already succeeded?)        │
    └─────────┬───────────────────┘
              │
          YES?  NO
           ↓    ↓
         DONE  ┌──────────────────┐
              │ Execute Handler  │
              │ Measure Duration │
              └────────┬─────────┘
                       │
              Success?  Failure?
                │        │
                ↓        ↓
          ┌─────────┐ ┌──────────────┐
          │ SUCCESS │ │ Check Retry  │
          │         │ │ Exhausted?   │
          └────┬────┘ └─────┬────────┘
               │            │
               │       YES   NO
               │       ↓     ↓
               │      DLQ  ┌──────────────┐
               │           │ Schedule     │
               │           │ Backoff      │
               │           │ Retry        │
               │           └──────────────┘
               │
               ▼
      ┌──────────────────────────┐
      │ Store Result             │
      │ In PostgreSQL            │
      │ Update Status            │
      └────────┬─────────────────┘
               │
               ▼
     ┌────────────────────────────┐
     │ Emit Events                │
     │ (WebSocket broadcast)      │
     └────────┬───────────────────┘
              │
              ▼
      ┌──────────────────┐
      │ Wait for Next    │
      │ Job              │
      └────────┬─────────┘
               │
               └─────→ (Loop)
```

## Directory Structure

```
apps/worker/
├── src/
│   ├── index.ts                 # Entry point
│   ├── processor.ts             # Main job processor
│   ├── handlers/
│   │   ├── index.ts             # Load all handlers
│   │   ├── sendEmail.ts
│   │   ├── processVideo.ts
│   │   └── generateReport.ts
│   ├── retryStrategy.ts         # Exponential backoff logic
│   ├── gracefulShutdown.ts      # SIGTERM handling
│   ├── types.ts
│   └── config.ts
├── __tests__/
│   ├── processor.test.ts
│   ├── retryStrategy.test.ts
│   └── handlers.test.ts
├── .env.example
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Processor Implementation

### Main Processor Loop

```typescript
// pseudo-code
async function startWorker() {
  const queue = new JobQueue();

  // Listen for jobs
  queue.process(CONCURRENCY, async (job) => {
    try {
      // Step 1: Log start
      logger.info('Processing job', { jobId: job.id });

      // Step 2: Fetch job details
      const jobData = await db.jobs.findUnique(job.id);

      // Step 3: Check idempotency
      const lastExecution = await db.jobExecutions.findLast({ jobId: job.id });
      if (lastExecution?.status === 'completed') {
        logger.info('Job already completed, using cached result');
        return lastExecution.result;
      }

      // Step 4: Get handler
      const handler = handlers.get(jobData.type);

      // Step 5: Execute
      const startTime = Date.now();
      const result = await handler.execute(jobData.payload);
      const duration = Date.now() - startTime;

      // Step 6: Store result
      await db.jobExecutions.create({
        jobId: job.id,
        status: 'completed',
        result,
        duration,
      });

      await db.jobs.update(job.id, {
        status: 'completed',
        completedAt: new Date(),
      });

      // Step 7: Emit event
      events.emit('job:completed', { jobId: job.id, result });

      return result;
    } catch (error) {
      // Handle error...
    }
  });

  // Graceful shutdown
  process.on('SIGTERM', () => queue.close());
}
```

## Job Handler Interface

```typescript
interface JobHandler<T extends object = any, R = any> {
  type: string; // 'send-email', etc.
  schema: ZodSchema; // Validates payload
  timeout?: number; // Milliseconds (default: 30000)
  maxRetries?: number; // Override default
  execute(payload: T): Promise<R>;
}
```

### Example Handler

```typescript
// send-email.ts
import { z } from 'zod';

export const sendEmailPayloadSchema = z.object({
  to: z.string().email(),
  subject: z.string(),
  template: z.string(),
  context: z.object({}).optional(),
});

export const sendEmailHandler: JobHandler = {
  type: 'send-email',
  schema: sendEmailPayloadSchema,
  timeout: 10000,
  maxRetries: 5,

  async execute(payload: typeof sendEmailPayloadSchema._type) {
    logger.info('Sending email', { to: payload.to });

    // Call email service
    const result = await emailService.send({
      to: payload.to,
      subject: payload.subject,
      template: payload.template,
      context: payload.context,
    });

    return {
      messageId: result.id,
      sentAt: new Date(),
    };
  },
};
```

## Retry Strategy

### Exponential Backoff

```typescript
function calculateBackoff(attemptNumber: number): number {
  // Base delay: 2^attemptNumber seconds
  const baseDelay = Math.pow(2, attemptNumber) * 1000;

  // Add random jitter (±20%)
  const jitter = baseDelay * (Math.random() - 0.5) * 0.4;

  return baseDelay + jitter;

  // Examples:
  // Attempt 0: ~1s (1000ms)
  // Attempt 1: ~4s (4000ms)
  // Attempt 2: ~16s (16000ms)
  // Attempt 3: ~64s (64000ms) - max (capped at 1 hour)
}
```

### Retry Logic

```typescript
async function handleJobFailure(job, error) {
  const { retryCount, maxRetries } = job;

  if (retryCount < maxRetries) {
    // Schedule retry
    const delay = calculateBackoff(retryCount);

    await db.jobs.update(job.id, {
      status: 'delayed',
      delayUntil: new Date(Date.now() + delay),
      retryCount: retryCount + 1,
    });

    await queue.scheduleRetry(job.id, delay);

    logger.info('Job scheduled for retry', {
      jobId: job.id,
      attempt: retryCount + 1,
      delayMs: delay,
    });
  } else {
    // Max retries exhausted
    await moveToDLQ(job, error);
    logger.warn('Job moved to DLQ', { jobId: job.id });
  }
}
```

## Concurrency & Backpressure

```typescript
// Each worker processes jobs concurrently
const CONCURRENCY = 5; // Jobs per worker instance

queue.process(CONCURRENCY, async (job) => {
  // Process job
});

// Backpressure automatically applied:
// • If queue is empty, workers idle
// • If queue is full, Redis throttles
// • No unbounded memory growth
```

### Scaling Workers

```
Low Load:  1 worker (concurrency: 5) = 5 jobs parallel
Medium:    5 workers (concurrency: 5) = 25 jobs parallel
High:     20 workers (concurrency: 5) = 100 jobs parallel
```

## Graceful Shutdown

When worker receives SIGTERM signal:

```typescript
process.on('SIGTERM', async () => {
  logger.info('Graceful shutdown started');

  // Step 1: Stop accepting new jobs
  queue.pause();

  // Step 2: Wait for current jobs (timeout: 30s)
  const timeout = 30000;
  await queue.close(timeout);

  // Step 3: Close database connection
  await db.$disconnect();

  // Step 4: Exit
  logger.info('Graceful shutdown complete');
  process.exit(0);
});
```

Benefits:

- Current jobs complete or timeout
- In-flight work doesn't hang
- State is consistent (jobs in DB)
- Clean restart on deployment

## Error Handling

All errors caught and recorded:

```typescript
try {
  const result = await handler.execute(jobPayload);
} catch (error) {
  // Store error details
  await db.jobExecutions.create({
    jobId: job.id,
    status: 'failed',
    errorType: error.constructor.name, // 'TypeError', 'NetworkError'
    errorMessage: error.message, // 'Connection timeout'
    errorStack: error.stack, // Full stack trace
    duration: Date.now() - startTime,
  });

  // Decide: retry or DLQ
  if (retryCount < maxRetries) {
    // Retry with backoff
  } else {
    // Move to DLQ
  }
}
```

## Idempotency

Prevents duplicate processing if job retried:

```typescript
// Before processing, check if already succeeded
const lastExecution = await db.jobExecutions.findLast({ jobId: job.id, status: 'completed' });

if (lastExecution) {
  logger.info('Job already completed, skipping', { jobId: job.id });
  return lastExecution.result; // Return cached result
}
```

Critical for:

- Retries (don't send email twice)
- Worker crashes (lost in-flight work)
- Duplicate queue entries

See [[PATTERNS/01-Idempotency]] for details.

## Monitoring & Observability

### Logging

Every job logs key events:

```typescript
logger.info('Processing job', { jobId, type, duration: 1234 });
logger.warn('Job failed', { jobId, errorType, attempt: 2 });
logger.error('Job failed permanently', { jobId, reason: 'DLQ' });
```

### Metrics

Worker emits metrics:

```typescript
metrics.increment('jobs.processed', 1, { type: 'send-email' });
metrics.gauge('jobs.processing', activeJobCount);
metrics.histogram('job.duration', duration, { type, status });
```

### Worker Health

Dashboard shows:

```typescript
{
  workerId: 'worker-1',
  status: 'busy',  // or 'idle', 'offline'
  currentJobId: 'job-123',
  jobsProcessed: 1523,
  jobsSucceeded: 1501,
  jobsFailed: 22,
  avgProcessingTime: 2345,
  lastHeartbeat: '2026-07-02T10:15:30Z'
}
```

## Testing Strategy

See [[TESTING/01-Unit-Tests]] for details.

### Unit Tests

Test handlers in isolation:

```typescript
describe('sendEmailHandler', () => {
  it('sends email and returns message ID', async () => {
    const payload = {
      to: 'user@example.com',
      subject: 'Test',
      template: 'welcome',
    };

    const result = await sendEmailHandler.execute(payload);

    expect(result.messageId).toBeDefined();
  });

  it('throws on invalid email', async () => {
    expect(() => {
      sendEmailHandler.execute({
        to: 'not-an-email',
        subject: 'Test',
        template: 'welcome',
      });
    }).toThrow();
  });
});
```

### Integration Tests

Test processor with real queue:

```typescript
describe('Job Processor', () => {
  it('processes job and stores result', async () => {
    const job = await queue.add('send-email', {
      to: 'user@example.com',
      subject: 'Test',
    });

    await processor.process(job);

    const execution = await db.jobExecutions.findLast(job.id);
    expect(execution.status).toBe('completed');
  });

  it('retries on failure', async () => {
    // Mock handler to fail first time
    handlers.get('test-job').execute = () => {
      throw new Error('Temporary failure');
    };

    await processor.process(job);

    expect(job.retryCount).toBe(1);
  });
});
```

## Configuration

Environment variables:

```bash
# Database
DATABASE_URL=postgresql://user:pass@host/job_queue

# Redis
REDIS_URL=redis://localhost:6379

# Worker
WORKER_ID=worker-1              # Auto-generated if not set
WORKER_CONCURRENCY=5            # Jobs processed in parallel
WORKER_QUEUE_NAMES=*            # Which queues to process

# Logging
LOG_LEVEL=info

# Graceful Shutdown
GRACEFUL_SHUTDOWN_TIMEOUT=30000 # Milliseconds
```

## Performance Characteristics

| Metric             | Value         | Notes               |
| ------------------ | ------------- | ------------------- |
| **Job Processing** | ~100ms-5s     | Depends on handler  |
| **Concurrency**    | 5-10 jobs     | Per worker instance |
| **Throughput**     | ~500 jobs/min | With 100 workers    |
| **Memory**         | ~200MB        | Per worker instance |
| **Startup Time**   | ~2s           | Connect to Redis/DB |

## Development

### Start Worker

```bash
cd apps/worker
pnpm dev
```

### Run Tests

```bash
pnpm test
pnpm test:watch
```

### Create Custom Handler

1. Create file in `src/handlers/myJobType.ts`
2. Implement `JobHandler` interface
3. Export from `src/handlers/index.ts`
4. Worker automatically registers it

## Related Documentation

- [[02-ARCHITECTURE-OVERVIEW]] - How worker fits in system
- [[COMPONENTS/01-API-Service]] - API (sibling service)
- [[COMPONENTS/04-Shared-Packages]] - Shared libraries
- [[JOB-LIFECYCLE]] - Complete job flow
- [[PATTERNS/03-Dead-Letter-Queue]] - DLQ pattern
- [[PATTERNS/02-Exponential-Backoff]] - Retry strategy
- [[PATTERNS/04-State-Machine]] - Job states
- [[DEPLOYMENT/02-Docker-Compose]] - Running in Docker
