# Workers Table

## Purpose

Registry and health tracking for worker instances. Tracks which workers are online, what they're processing, and how healthy they are.

**Ephemeral**: Worker rows are created on startup, updated with heartbeats, cleaned up on shutdown or timeout.

## Schema

```sql
CREATE TABLE workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workerId VARCHAR(255) NOT NULL UNIQUE,
  hostname VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'idle',
  currentJobId UUID,
  concurrency INT NOT NULL DEFAULT 5,
  processedCount INT NOT NULL DEFAULT 0,
  failureCount INT NOT NULL DEFAULT 0,
  startedAt TIMESTAMP NOT NULL DEFAULT NOW(),
  lastHeartbeatAt TIMESTAMP NOT NULL DEFAULT NOW(),
  updatedAt TIMESTAMP NOT NULL DEFAULT NOW(),
  
  FOREIGN KEY (currentJobId) REFERENCES jobs(id) ON DELETE SET NULL
);
```

## Columns

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Database row ID |
| `workerId` | VARCHAR(255) | Unique worker identifier (e.g., 'worker-prod-1') |
| `hostname` | VARCHAR(255) | Machine hostname running the worker |
| `status` | VARCHAR(50) | 'idle' (waiting for jobs) or 'busy' (processing) |
| `currentJobId` | UUID | Job currently being processed (null if idle) |
| `concurrency` | INT | Max concurrent jobs for this worker |
| `processedCount` | INT | Total jobs successfully processed |
| `failureCount` | INT | Total job failures (for monitoring) |
| `startedAt` | TIMESTAMP | When worker process started |
| `lastHeartbeatAt` | TIMESTAMP | Last heartbeat time (detects crashes) |
| `updatedAt` | TIMESTAMP | Last row update |

## Constraints

```sql
-- workerId is unique
ALTER TABLE workers ADD CONSTRAINT uq_workers_workerId UNIQUE (workerId);

-- Valid statuses
ALTER TABLE workers ADD CONSTRAINT ck_workers_status 
  CHECK (status IN ('idle', 'busy'));

-- Concurrency must be positive
ALTER TABLE workers ADD CONSTRAINT ck_workers_concurrency 
  CHECK (concurrency > 0);

-- Counts can't be negative
ALTER TABLE workers ADD CONSTRAINT ck_workers_counts 
  CHECK (processedCount >= 0 AND failureCount >= 0);

-- lastHeartbeat must be after start
ALTER TABLE workers ADD CONSTRAINT ck_workers_heartbeat 
  CHECK (lastHeartbeatAt >= startedAt);
```

## Indexes

```sql
-- Find online workers
CREATE INDEX idx_workers_status_heartbeat 
  ON workers(status, lastHeartbeatAt DESC) 
  WHERE status = 'idle';

-- Find stale workers (dead detection)
CREATE INDEX idx_workers_lastHeartbeatAt 
  ON workers(lastHeartbeatAt ASC);

-- Worker stats
CREATE INDEX idx_workers_startedAt 
  ON workers(startedAt DESC);

-- Quick lookup by ID
CREATE UNIQUE INDEX idx_workers_workerId 
  ON workers(workerId);
```

**Why**:
- `status, lastHeartbeatAt`: Find idle workers (scheduler)
- `lastHeartbeatAt`: Detect dead workers (cleanup job)
- `startedAt`: Worker uptime analytics

## Relationships

### workers ← jobs (N:1)

```sql
ALTER TABLE workers ADD CONSTRAINT fk_workers_currentJobId
  FOREIGN KEY (currentJobId) REFERENCES jobs(id) ON DELETE SET NULL;
```

**Set NULL**: If job deleted, worker's `currentJobId` becomes null. Worker continues running (job just removed from tracking).

## Usage Examples

### Worker Registers on Startup

```typescript
// In worker/src/index.ts
const workerId = `worker-${hostname()}-${process.pid}`;

const worker = await db.workers.create({
  data: {
    workerId,
    hostname: hostname(),
    status: 'idle',
    concurrency: WORKER_CONCURRENCY,
    startedAt: new Date()
  }
});

logger.info('Worker registered', { workerId, workerId: worker.id });
```

### Send Heartbeat (every 5 seconds)

```typescript
setInterval(async () => {
  await db.workers.update({
    where: { workerId: WORKER_ID },
    data: { 
      lastHeartbeatAt: new Date(),
      status: isBusy ? 'busy' : 'idle',
      currentJobId: currentJob?.id || null
    }
  });
}, 5000);
```

### Find Stale Workers (cleanup job)

```typescript
// Run every 10 seconds
const staleWorkers = await db.workers.findMany({
  where: {
    lastHeartbeatAt: {
      lt: new Date(Date.now() - 30*1000)  // No heartbeat for 30s
    }
  }
});

for (const stale of staleWorkers) {
  logger.warn('Removing stale worker', { workerId: stale.workerId });
  
  // Move any in-flight jobs back to queue
  if (stale.currentJobId) {
    await db.jobs.update({
      where: { id: stale.currentJobId },
      data: {
        status: 'queued',  // Back to queue for another worker
        startedAt: null,   // Reset start time
        updatedAt: new Date()
      }
    });
  }
  
  // Delete worker
  await db.workers.delete({
    where: { id: stale.id }
  });
}
```

### Update Job Processing Stats

```typescript
// On success
await db.workers.update({
  where: { workerId: WORKER_ID },
  data: {
    processedCount: { increment: 1 },
    currentJobId: null,
    status: 'idle'
  }
});

// On failure
await db.workers.update({
  where: { workerId: WORKER_ID },
  data: {
    failureCount: { increment: 1 },
    currentJobId: null,
    status: 'idle'
  }
});
```

### Dashboard: Worker Status

```typescript
const workers = await db.workers.findMany({
  orderBy: { lastHeartbeatAt: 'desc' }
});

// Result:
// [
//   {
//     workerId: 'worker-prod-1',
//     status: 'busy',
//     currentJob: { type: 'send-email', id: 'job-123' },
//     processedCount: 1234,
//     failureCount: 5,
//     uptime: '2 days'
//   }
// ]
```

### Find Idle Workers (for scheduling)

```typescript
const idleWorkers = await db.workers.findMany({
  where: {
    status: 'idle',
    concurrency: { gt: 0 }  // Has capacity
  },
  orderBy: { lastHeartbeatAt: 'desc' }
});

// Assign new jobs to idle workers
for (const worker of idleWorkers) {
  const job = await findNextJobForWorker(worker);
  if (job) {
    await assignJobToWorker(worker, job);
  }
}
```

### Get Worker Performance

```typescript
const stats = await db.workers.findUnique({
  where: { workerId: 'worker-prod-1' }
});

const successRate = stats.processedCount / 
  (stats.processedCount + stats.failureCount);

logger.info('Worker stats', {
  workerId: 'worker-prod-1',
  totalProcessed: stats.processedCount,
  failureCount: stats.failureCount,
  successRate: (successRate * 100).toFixed(2) + '%',
  uptime: formatDistance(stats.startedAt, new Date())
});
```

### Cleanup Dead Workers on Startup

```typescript
// In worker initialization
await db.workers.deleteMany({
  where: {
    lastHeartbeatAt: {
      lt: new Date(Date.now() - 60*1000)  // Dead for 1+ minute
    }
  }
});
```

## Worker Lifecycle

```
[1] STARTUP
  → db.workers.create({ workerId, status: 'idle', lastHeartbeatAt: NOW() })

[2] HEARTBEAT LOOP (every 5s)
  → db.workers.update({ lastHeartbeatAt: NOW(), status: current })

[3] PICK UP JOB
  → db.workers.update({ status: 'busy', currentJobId: job.id })
  → Process job...

[4] COMPLETE JOB
  → db.workers.update({ 
      status: 'idle', 
      currentJobId: null,
      processedCount: increment,
      updatedAt: NOW()
    })

[5] SHUTDOWN
  → db.workers.delete({ workerId })
  → Move any currentJobId back to queue

[6] CRASH (no heartbeat for 30s)
  → Dead detection job: db.workers.delete({ id })
  → Move any currentJobId back to queue
```

## Design Rationale

### Ephemeral Registry

```typescript
// ✅ Workers are ephemeral
// Create on startup, delete on shutdown
// Don't store permanent worker history in this table

// ❌ Don't use for long-term stats
// Use job_executions table for that
```

**Why ephemeral**:
- Workers are cattle, not pets
- Don't need permanent records
- Keeping old rows wastes space

### Heartbeat-Based Dead Detection

```typescript
// ✅ Heartbeat approach (efficient)
if (lastHeartbeatAt < NOW() - 30s) {
  // Worker crashed, reassign jobs
}

// ❌ Request-response (slow)
// Actively ping each worker (overhead, complexity)
```

**Why heartbeat**:
- Worker process runs always
- Low-overhead ping
- Can detect soft crashes (hung process)

### Optional currentJobId

```sql
-- ✅ Can be NULL
currentJobId UUID OPTIONAL

-- ❌ Requires job
currentJobId UUID NOT NULL
```

**Why optional**:
- Idle workers have no current job
- Can delete job without orphaning worker
- Simpler concurrency logic

### Counters for Monitoring

```typescript
// ✅ Track performance
{
  processedCount: 1234,
  failureCount: 5
}

// ❌ Detailed history per job
// Use job_executions for that
```

**Why counters not history**:
- This is runtime monitoring, not audit trail
- Calculate success rate quickly
- Cheap incremental updates

## Related Documentation

- [[COMPONENTS/02-Worker-Service]] - Worker implementation
- [[DATABASE/00-Schema-Overview]] - Schema overview
- [[JOB-LIFECYCLE/00-Overview]] - Job processing flow
- [[PATTERNS/05-Concurrency-Backpressure]] - Worker concurrency
