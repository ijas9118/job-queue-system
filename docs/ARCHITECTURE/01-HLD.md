# High-Level Design (HLD)

## Visual Representation

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                    Angular Dashboard                         │
│              (Tailwind CSS + Socket.IO Client)               │
│                                                              │
│  • Job submission form                                       │
│  • Real-time job status updates                              │
│  • Worker health monitoring                                  │
│  • Queue metrics and analytics                               │
│  • Dead-letter queue management                              │
│  • Load testing controls (admin)                             │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
        ▼                             ▼
   REST API         WebSocket (Socket.IO)
   HTTP/1.1                Bidirectional
        │                             │
┌───────▼─────────────────────────────▼────────────────────────┐
│              API Service (Fastify)                           │
│                                                              │
│  Routes:                                                     │
│  • POST   /api/v1/jobs              → Submit job            │
│  • GET    /api/v1/jobs              → List user jobs        │
│  • GET    /api/v1/jobs/:id          → Get job details       │
│  • POST   /api/v1/jobs/:id/retry    → Retry failed         │
│  • POST   /api/v1/jobs/:id/cancel   → Cancel job           │
│  • GET    /api/v1/admin/queues      → Queue stats (admin)   │
│  • GET    /api/v1/admin/workers     → Worker stats (admin)  │
│  • POST   /api/v1/admin/load-test   → Load testing (admin)  │
│  • GET    /docs                     → Swagger UI (OpenAPI)  │
│                                                              │
│  Plugins & Hooks:                                            │
│  • Authentication (JWT validation, onRequest hook)           │
│  • Authorization (RBAC checking, preHandler hook)            │
│  • Error handling (setErrorHandler)                          │
│  • Request logging (built-in Pino)                           │
│                                                              │
│  WebSocket Events:                                          │
│  • job:created, job:started, job:completed                  │
│  • job:failed, job:progress, job:cancelled                  │
│  • worker:online, worker:offline, worker:status             │
│  • queue:stats (every 5 seconds)                            │
│  • job:log (real-time logs)                                 │
│                                                              │
└────┬──────────────────────────────────────────────┬─────────┘
     │                                              │
     │              Shared Infrastructure           │
     │                                              │
     ▼                                              ▼
┌─────────────────────────┐          ┌──────────────────────────┐
│   PostgreSQL Database   │          │   Redis Cache/Queue      │
│                         │          │                          │
│  Tables:                │          │  Data Structures:        │
│  • users                │          │  • Lists (job queues)    │
│  • jobs                 │          │  • Sets (priorities)     │
│  • job_executions       │          │  • Hashes (job metadata) │
│  • job_logs             │          │  • Streams (events)      │
│  • workers              │          │                          │
│  • dead_letter_queue    │          │  Via BullMQ:             │
│  • audit_log            │          │  • Queue management      │
│                         │          │  • Job scheduling        │
│  Purpose:               │          │  • Pub/Sub               │
│  • Durable history      │          │                          │
│  • Audit trail          │          │  Purpose:                │
│  • Analytics queries    │          │  • Fast queue state      │
│  • User data            │          │  • Job coordination      │
│                         │          │  • Real-time pub/sub     │
└─────────────────────────┘          └────────────┬─────────────┘
                                                   │
                          ┌────────────────────────┼────────────────────────┐
                          │                        │                        │
                          ▼                        ▼                        ▼
                    ┌──────────┐            ┌──────────┐            ┌──────────┐
                    │ Worker 1 │            │ Worker 2 │            │ Worker N │
                    │          │            │          │            │          │
                    │ BullMQ   │            │ BullMQ   │            │ BullMQ   │
                    │ Consumer │            │ Consumer │            │ Consumer │
                    │          │            │          │            │          │
                    │ Job      │            │ Job      │            │ Job      │
                    │ Handler  │            │ Handler  │            │ Handler  │
                    │          │            │          │            │          │
                    └──────────┘            └──────────┘            └──────────┘
                          │                        │                        │
                    (Process Job)            (Process Job)            (Process Job)
                          │                        │                        │
                          └────────────────────────┼────────────────────────┘
                                                   │
                          ┌────────────────────────┘
                          │
                          ▼
        ┌───────────────────────────────────┐
        │  PostgreSQL (Store Results)       │
        │                                   │
        │  • job_executions (history)       │
        │  • job_logs (detailed logs)       │
        │  • workers (registry)             │
        │  • dead_letter_queue (failures)   │
        │  • audit_log (events)             │
        └───────────────────────────────────┘
```

## Component Interactions

### 1. User Submits a Job

```
User → Dashboard
  ↓
Submit button with job details
  ↓
POST /api/v1/jobs (with JWT token)
  ↓
API validates:
  • Auth check (valid token?)
  • User exists?
  • Job type valid?
  • Payload valid against schema?
  ↓
API creates job:
  1. Insert into PostgreSQL (jobs table)
  2. Push to Redis queue via BullMQ
  3. Return job ID to client
  ↓
WebSocket broadcast:
  • Send "job:created" to all dashboards
  ↓
Dashboard shows:
  • Job appears in job list
  • Status badge shows "queued"
  • Real-time without page reload
```

### 2. Worker Processes a Job

```
Worker starts:
  1. Connect to Redis queue (BullMQ)
  2. Listen for jobs
  ↓
Job available:
  1. Worker consumes from queue
  2. Fetch full job from PostgreSQL
  3. Check if already processed (idempotency)
  ↓
Execute handler:
  1. Load handler for job type
  2. Call handler.execute(job.payload)
  3. Track duration
  ↓
On success:
  1. Store result in PostgreSQL
  2. Update status = 'completed'
  3. Emit "job:completed" event
  4. WebSocket to Dashboard
  ↓
On failure:
  1. Check: retryCount < maxRetries?
  2. If yes:
     • Increment retryCount
     • Calculate backoff delay
     • Reschedule in Redis
     • status = 'delayed'
     • Emit "job:failed"
  3. If no:
     • Insert into dead_letter_queue
     • status = 'dead_letter'
     • Emit "job:dead-letter"
     • Emit to Dashboard
```

### 3. Job Retries

```
Exponential Backoff Timeline:
  ↓
Job fails (attempt 1)
  ↓
Backoff: 1s + jitter
  ↓
Wait...
  ↓
Redis timer fires (after ~1s)
  ↓
Job returns to queue
  ↓
Worker picks up and retries
  ↓
If fails again (attempt 2):
  Backoff: 4s + jitter
  ↓
Wait...
  ↓
Retry again
  ↓
If still fails (attempt 3):
  Backoff: 16s + jitter
  ↓
If fails after max retries:
  Move to dead_letter_queue
  Admin must manually inspect and replay
```

## Key Design Principles

### 1. Separation of Concerns

- **API**: HTTP interface only
- **Worker**: Job processing only
- **Database**: Persistent history
- **Cache**: Transient queue state

Each component has one responsibility.

### 2. Eventual Consistency

- API returns immediately (before job completes)
- Worker updates database asynchronously
- Dashboard receives updates via WebSocket
- System is eventually consistent (not strongly consistent)

### 3. Immutable History

- `job_executions` is append-only
- Every attempt is recorded forever
- Can replay history for debugging
- Supports compliance and auditing

### 4. Graceful Degradation

- Failed jobs move to DLQ (not lost)
- Worker crashes → job returns to queue
- Redis crash → rebuild state from PostgreSQL
- API crash → user retries

### 5. Observable

- All events emitted to WebSocket
- Structured logging (Pino)
- Metrics tracked (job count, duration)
- Audit trail (who did what, when)

## Scalability Characteristics

### Horizontal Scaling

There's no universal formula mapping job volume to instance counts — see [[02-ARCHITECTURE-OVERVIEW]]#scaling-characteristics and [[TECH-STACK/00-Overview]]#scaling for why this is determined by load testing (RPS, p95/p99 latency, CPU/memory, DB pool saturation, queue depth) rather than a fixed table. Directionally, the levers available as load grows are: more API instances behind a load balancer (I/O-bound), more worker instances and/or higher `WORKER_CONCURRENCY` (CPU-bound), and — only once actually measured as the bottleneck — Redis clustering/Sentinel or PostgreSQL read replicas.

### Bottleneck Analysis

1. **Redis**: Becomes bottleneck first (queue throughput limited)
   - Solution: Redis cluster (Sentinel for HA)

2. **PostgreSQL**: Connection pool exhaustion
   - Solution: PgBouncer, read replicas

3. **Workers**: CPU-bound if handlers are expensive
   - Solution: Add more worker instances

4. **API**: Usually not bottleneck (I/O bound)
   - Solution: Horizontal scaling with load balancer

## Failure Scenarios

### Scenario 1: Worker Crashes Mid-Job

```
Worker processing job X
  ↓
Worker dies (OOM, SIGKILL, etc.)
  ↓
Redis timeout (job lock expires in ~30 minutes)
  ↓
Job returns to queue (BullMQ handles this)
  ↓
Another worker picks it up and retries
  ↓
Idempotency check prevents duplicate side effects
```

### Scenario 2: Redis Crashes

```
Redis disappears
  ↓
Active jobs lost from queue
  ↓
Solution:
  • Restart Redis
  • Restart workers
  • Workers check PostgreSQL for abandoned jobs
  • Replay from history
```

### Scenario 3: PostgreSQL Crashes

```
Database offline
  ↓
Workers can't store results
  ↓
Jobs stay in Redis queue
  ↓
Solution:
  • Fix database
  • Workers retry storing results
  • API queries fail gracefully
```

## Trade-offs Made

| Decision                  | Upside                          | Downside                     | Mitigation                      |
| ------------------------- | ------------------------------- | ---------------------------- | ------------------------------- |
| **Separate Processes**    | Easy to scale, teaches patterns | More complex setup           | Docker Compose simplifies       |
| **PostgreSQL + Redis**    | Durable + fast                  | Dual database complexity     | Prisma ORM helps                |
| **Eventually Consistent** | High performance                | Harder to reason about       | Audit trail for verification    |
| **Monorepo**              | Code reuse, easy refactor       | Single failure = all offline | Modular structure prevents this |
| **Immutable History**     | Compliance, debugging           | Storage overhead             | Partition old data              |

## Performance Characteristics

Not measured yet — figures here would be guesses, and real numbers depend heavily on hardware, handler cost, dataset size, and network conditions. Once load-tested (see [[TECH-STACK/00-Overview]]#performance), record actual measured values here for:

- **Job submission latency** (API validation + DB insert + Redis push)
- **API throughput** (jobs/sec per instance)
- **Job processing duration** (handler-dependent — seconds to minutes)
- **Worker throughput** at a given `WORKER_CONCURRENCY`
- **WebSocket update latency** (submission → dashboard reflecting it)
- **Queue stats broadcast interval** (currently every 5 seconds by design, not a performance measurement)

## Related Documentation

- [[02-ARCHITECTURE-OVERVIEW]] - System overview
- [[ARCHITECTURE/02-Monorepo-Structure]] - Full folder structure
- [[ARCHITECTURE/03-Separation-of-Concerns]] - Redis vs PostgreSQL
- [[COMPONENTS]] - Individual component details
- [[JOB-LIFECYCLE/01-State-Machine]] - Job state machine
