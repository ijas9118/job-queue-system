## System Design Philosophy

- **Separate Processes**: API and Workers run independently (same repo, different executables)
- **Shared Infrastructure**: PostgreSQL for history, Redis for active queues
- **Monorepo Benefits**: Shared code, easy refactoring, clear dependencies
- **Production-Inspired**: Mirrors real-world distributed systems
- **Educational**: Each decision teaches a pattern

## High-Level Diagram

```
┌─────────────────────────────────────────────────────┐
│           Angular Dashboard                         │
│      (Tailwind + Socket.IO)                         │
└─────────────────┬───────────────────────────────────┘
                  │
      REST API + WebSocket (Socket.IO)
                  │
┌─────────────────▼───────────────────────────────────┐
│            API Service (Fastify)                    │
│  • Authentication & Authorization                   │
│  • Job Submission & Querying                       │
│  • WebSocket Server                                │
│  • Metrics Aggregation                             │
│  • OpenAPI docs (/docs)                            │
│  Runs: npm run dev:api                             │
└────┬───────────────────────────────────┬───────────┘
     │                                   │
     │                                   │
┌────▼──────────────┐         ┌─────────▼─────────┐
│   PostgreSQL      │         │      Redis        │
│  • Users & Auth   │         │  • Active Jobs    │
│  • Job History    │         │  • Delayed Jobs   │
│  • Exec Logs      │         │  • Priorities     │
│  • Audit Trail    │         │  • Failed Jobs    │
└───────────────────┘         └────────┬──────────┘
                                       │
                     ┌─────────────────┼─────────────────┐
                     │                 │                 │
                ┌────▼───┐        ┌────▼───┐       ┌───▼────┐
                │ Worker │        │ Worker │ ...   │ Worker │
                │   #1   │        │   #2   │       │   #N   │
                │Process │        │Process │       │Process │
                │ Jobs   │        │ Jobs   │       │ Jobs   │
                └────────┘        └────────┘       └────────┘
                 Runs: npm run dev:worker
```

## Three Separate Processes

### 1. API Service (`apps/api`)

**Purpose**: HTTP interface for users

**Responsibilities**:

- Accept job submissions
- Authenticate users (JWT)
- Query job status
- Manage WebSocket connections
- Admin controls (queue stats, worker health)

**Does NOT**:

- Process jobs (workers do that)
- Store state (everything in DB/Redis)

**Scales**: 1-2 instances (not CPU-intensive, I/O bound)

### 2. Worker Service (`apps/worker`)

**Purpose**: Execute jobs from the queue

**Responsibilities**:

- Listen to Redis queues
- Execute job handlers
- Implement retry logic
- Move failed jobs to DLQ
- Record execution history
- Emit events

**Does NOT**:

- Accept user input
- Make architecture decisions

**Scales**: Multiple instances (CPU-intensive)

### 3. Dashboard (`apps/dashboard`)

**Purpose**: Visual job monitoring interface

**Responsibilities**:

- Display job status
- Show worker health
- Real-time updates (WebSocket)
- Queue metrics
- Admin controls

**Does NOT**:

- Store state
- Directly access Redis

**The API stays thin by design.** It validates, creates the job row, enqueues it, and returns — it does not process anything itself:

```
POST /jobs
    ↓
validate request (Zod)
    ↓
create job row
    ↓
enqueue job (BullMQ)
    ↓
return job ID
```

All the actual work happens downstream in the worker:

```
BullMQ
   ↓
Worker
   ↓
process job
   ↓
update database
   ↓
publish event
   ↓
Socket.IO
   ↓
Angular dashboard
```

## Shared Infrastructure

### PostgreSQL (Persistent State)

**Owns**: Long-term history and audit trail

```
jobs           → Job metadata
job_executions → Execution history (immutable)
job_logs       → Structured logs
workers        → Worker registry
dead_letter    → Failed job archive
audit_log      → System events
users          → User accounts
```

**Why**: Durability, queryability, compliance

### Redis (Transient State)

**Owns**: Active job queue and coordination

```
Via BullMQ:
- job:uuid:queued     → Jobs waiting
- job:uuid:delayed    → Scheduled jobs
- job:uuid:active     → Being processed
- job:uuid:failed     → Transient failures
```

**Why**: Speed, built-in pub/sub, queue semantics

## Monorepo Structure

```
job-queue-system/
├── apps/
│   ├── api/          # Fastify API service
│   ├── worker/       # Job processor
│   └── dashboard/    # Angular frontend
│
├── packages/          # Day 1: only what both api and worker need
│   ├── queue/        # BullMQ wrapper
│   ├── database/     # Prisma ORM
│   ├── config/       # Config management
│   └── shared/       # Common types
│                      # auth, handlers, logger, metrics extracted later,
│                      # only once a second real consumer needs them —
│                      # see [[ARCHITECTURE/02-Monorepo-Structure]]
├── docker-compose.yml
├── pnpm-workspace.yaml
└── package.json
```

See [[ARCHITECTURE/02-Monorepo-Structure]] for full structure and the package growth rationale.

## Data Flow

### Submitting a Job

```
1. User → Dashboard
2. Dashboard → POST /api/v1/jobs
3. API validates, checks auth
4. API stores in PostgreSQL
5. API pushes to Redis queue
6. WebSocket: "job:created" event
7. Dashboard updates in real-time
```

### Processing a Job

```
1. Worker listens to Redis queue
2. Job available → worker picks it up
3. Worker stores in PostgreSQL: status = 'active'
4. WebSocket: "job:started" event
5. Worker executes handler
6. On success:
   - Store result in PostgreSQL
   - status = 'completed'
   - WebSocket: "job:completed"
7. On failure:
   - Check retryCount < maxRetries
   - If yes: schedule retry, status = 'delayed'
   - If no: move to DLQ, status = 'dead_letter'
   - WebSocket: "job:failed"
```

### Retrying a Failed Job

```
1. Exponential backoff timer fires
2. Job returns to active queue
3. Worker picks it up again
4. Repeat processing cycle
5. If still fails: move to DLQ
```

## Communication Patterns

### API ↔ Database (Synchronous)

- Direct queries via Prisma ORM
- ACID transactions for consistency
- Example: Create job, update status

### API ↔ Redis (Asynchronous)

- Push jobs to queue
- Read queue stats
- Example: Submit job, get queued

### API ↔ Dashboard (Bidirectional)

- REST for queries (GET /jobs)
- WebSocket for real-time updates
- Example: User submits job → immediate response + real-time updates

### Worker ↔ Redis (Asynchronous)

- Consume from queue
- Push results/errors
- Example: Worker processes job, updates Redis

### Worker ↔ Database (Synchronous)

- Store execution history
- Query job details
- Example: Record that execution succeeded

## Key Architectural Decisions

### Decision 1: Separate Processes vs Single Process

**Chosen**: Separate processes (API and Worker)

**Why**:

- Teaches distributed patterns
- Workers can't block API
- Easy to scale workers independently
- Production-realistic

See [[PATTERNS/05-Concurrency-Backpressure]] for backpressure details.

### Decision 2: PostgreSQL + Redis vs Single Database

**Chosen**: Hybrid approach

**Why**:

- Redis is fast for active queue state
- PostgreSQL is durable for history
- If Redis crashes, can rebuild from DB
- Different tools for different jobs

See [[PATTERNS/07-Redis-vs-PostgreSQL]] for details.

### Decision 3: Monorepo vs Multiple Repos

**Chosen**: Monorepo with shared packages

**Why**:

- Single codebase to understand
- Easy to refactor across boundaries
- Shared types (Zod schemas)
- Can split later if needed

See [[ARCHITECTURE/02-Monorepo-Structure]] for details.

## Scaling Characteristics

There's no fixed formula mapping job volume to instance counts — that depends on what's actually CPU vs I/O bound in the handlers, DB connection limits, and box sizes. Determine it empirically via load testing (RPS, p95/p99 latency, CPU/memory, DB pool saturation, queue depth — see [[TECH-STACK/00-Overview]]#scaling) rather than guessing a table upfront.

Directionally:

- **API** is I/O-bound (mostly waiting on DB/Redis) → scales horizontally behind a load balancer
- **Worker** is the CPU/IO-bound component → scales by adding instances and/or raising `WORKER_CONCURRENCY`
- **Redis** and **PostgreSQL** are usually the last things that need scaling (replication/Sentinel/sharding), and only once actually measured as the bottleneck

### Vertical Scaling Levers

- Increase `WORKER_CONCURRENCY` (jobs per worker)
- Add more Fastify instances behind a load balancer (Node is single-threaded per process)
- Add database connection pooling
- Increase Redis memory if needed

## Observability

Logs, metrics, and traces as one coherent story rather than an afterthought bolted on at the end:

```
                    Application
                         │
             ┌───────────┼───────────┐
             │           │           │
             ▼           ▼           ▼
           Logs       Metrics       Traces
             │           │           │
           Pino      Prometheus    OpenTelemetry
                      (prom-client)   (optional)
```

- **Logs**: Pino, structured JSON, request ID propagated through every log line for a given request (see [[API/00-Overview]]).
- **Metrics**: Prometheus-compatible counters/histograms — `jobs_total`, `jobs_completed_total`, `jobs_failed_total`, `job_processing_duration_seconds`, `queue_depth`, `worker_active_jobs`, `http_request_duration_seconds`. Exposed at `/metrics`.
- **Traces** (optional, nice portfolio differentiator): OpenTelemetry spans linking a single job's path across API → Redis/BullMQ → worker → DB, so you can follow one job as one trace instead of piecing together correlated log lines.

See [[TECH-STACK/00-Overview]]#observability for the full breakdown and [[COMPONENTS/04-Shared-Packages]] for where the metrics package lives.

## Deployment Models

### Local Development

```bash
docker-compose up
# Starts: PostgreSQL, Redis, API, Worker, Dashboard
```

### Production (Conceptual)

```
Docker containers:
- API service (load balanced)
- Worker service (scaled N instances)
- PostgreSQL (replicated)
- Redis (replicated with Sentinel)
```

See [[DEPLOYMENT/02-Docker-Compose]] for local setup details.

## Related Documentation

- [[ARCHITECTURE/01-HLD]] - Detailed HLD with patterns
- [[ARCHITECTURE/02-Monorepo-Structure]] - Full folder structure
- [[ARCHITECTURE/03-Separation-of-Concerns]] - Redis vs PostgreSQL
- [[COMPONENTS]] - Component details
- [[JOB-LIFECYCLE]] - How jobs flow through system
- [[PATTERNS]] - Design patterns implemented
