# Shared Packages (`packages/*`)

## Overview

Shared packages are reusable libraries used by multiple apps (API, worker, dashboard). They contain business logic, types, configurations, and utilities.

## Package Structure

### 1. `@job-queue/queue` - BullMQ Wrapper

**Purpose**: Abstracts BullMQ operations with app-specific logic

**Exports**:
```typescript
// Class
class JobQueue {
  add(jobData, options?): Promise<Job>;
  process(concurrency, handler): void;
  retry(jobId, delay): Promise<void>;
  moveToDLQ(jobId, reason): Promise<void>;
  pause(): void;
  resume(): void;
  close(): Promise<void>;
}

// Functions
export function createQueue(name?: string): JobQueue;
export function calculateBackoff(attempt: number): number;
export async function moveJobsToDLQ(jobs: Job[]): Promise<void>;
```

**Used by**: API (submit jobs), Worker (process jobs)

---

### 2. `@job-queue/database` - Prisma ORM

**Purpose**: Database access layer

**Files**:
- `prisma/schema.prisma` - Database schema definition
- `prisma/migrations/*` - Migration history
- `src/index.ts` - Exported Prisma client

**Exports**:
```typescript
export { PrismaClient } from '@prisma/client';
export type { Job, JobExecution, Worker } from '@prisma/client';

// Usage
import { PrismaClient } from '@job-queue/database';
const db = new PrismaClient();
```

**Used by**: API (queries), Worker (store results), Dashboard (optional, via API)

---

### 3. `@job-queue/auth` - Authentication & Authorization

> **On extraction timing**: this only needs to be its own package once a second app (e.g. worker) genuinely needs to verify tokens or check roles too. Until then, this logic can live directly in `apps/api/src/auth/` — don't scaffold the package boundary before there's a real second consumer. See [[ARCHITECTURE/02-Monorepo-Structure]] for the full rationale.

**Purpose**: JWT and RBAC logic

**Key Functions**:
```typescript
// JWT
export function generateToken(userId, email, role): string;
export function verifyToken(token): TokenPayload;
export function decodeToken(token): TokenPayload;

// RBAC
export function authorize(requiredRole: Role): Middleware;
export function canRetryJob(user: User, job: Job): boolean;
export function canViewJob(user: User, job: Job): boolean;

// Middleware
export function authMiddleware(): Middleware;
export function rbacMiddleware(permission: string): Middleware;
```

**Used by**: API (all routes), Dashboard (login), Worker (optional)

---

### 4. `@job-queue/handlers` - Job Handler Registry

**Purpose**: Registry of all job types the system can execute

**Structure**:
```typescript
interface JobHandler<T = any, R = any> {
  type: string;
  schema: ZodSchema;
  timeout?: number;
  maxRetries?: number;
  execute(payload: T): Promise<R>;
}

class HandlerRegistry {
  register(handler: JobHandler): void;
  get(type: string): JobHandler;
  getAll(): JobHandler[];
  validate(type: string, payload: unknown): boolean;
}
```

**Built-in Handlers**:
```typescript
export { sendEmailHandler } from './handlers/sendEmail';
export { processVideoHandler } from './handlers/processVideo';
export { generateReportHandler } from './handlers/generateReport';
```

**Creating Custom Handler**:
```typescript
import { z } from 'zod';

const myJobPayloadSchema = z.object({
  userId: z.string(),
  data: z.unknown()
});

export const myJobHandler: JobHandler = {
  type: 'my-job-type',
  schema: myJobPayloadSchema,
  timeout: 30000,
  maxRetries: 3,
  
  async execute(payload) {
    // Implementation
    return { success: true };
  }
};
```

**Used by**: Worker (execute), API (validate)

---

### 5. `@job-queue/logger` - Structured Logging

**Purpose**: Consistent logging with Pino

**Usage**:
```typescript
import { createLogger } from '@job-queue/logger';

const logger = createLogger('component-name');

logger.info('User login', { userId: 123, email: 'user@example.com' });
logger.warn('Retry scheduled', { jobId, attempt: 2, delayMs: 1000 });
logger.error('Job failed', { jobId, error: err.message, stack: err.stack });
logger.debug('Internal state', { state: 'active' });
```

**Levels**: DEBUG, INFO, WARN, ERROR

**Features**:
- Structured JSON logs
- Child loggers with context
- Log levels configurable
- Pretty printing in development

**Used by**: API, Worker, Dashboard (frontend uses console)

---

### 6. `@job-queue/metrics` - Observability

**Purpose**: Track system metrics using `prom-client`, with a fixed, deliberately small set of named metrics rather than ad-hoc counters — see [[02-ARCHITECTURE-OVERVIEW]]#observability for how this fits alongside logs (Pino) and optional tracing (OpenTelemetry).

**Metrics**:
```typescript
import { metrics } from '@job-queue/metrics';

// Counters
metrics.jobsTotal.inc({ type: 'send-email' });
metrics.jobsCompletedTotal.inc({ type: 'send-email' });
metrics.jobsFailedTotal.inc({ type: 'send-email' });

// Gauges
metrics.queueDepth.set({ queue: 'email' }, queueLength);
metrics.workerActiveJobs.set(activeJobCount);

// Histograms
metrics.jobProcessingDuration.observe({ type: 'send-email' }, durationSeconds);
metrics.httpRequestDuration.observe({ route, method, status }, durationSeconds);

// Exported as Prometheus format
GET /metrics → Prometheus-compatible output
```

| Metric | Type | Labels |
|--------|------|--------|
| `jobs_total` | Counter | `type` |
| `jobs_completed_total` | Counter | `type` |
| `jobs_failed_total` | Counter | `type` |
| `job_processing_duration_seconds` | Histogram | `type` |
| `queue_depth` | Gauge | `queue` |
| `worker_active_jobs` | Gauge | — |
| `http_request_duration_seconds` | Histogram | `route`, `method`, `status` |

**Used by**: API (`/metrics` endpoint, HTTP duration), Worker (job counters/durations)

---

### 7. `@job-queue/config` - Configuration

**Purpose**: Environment configuration with validation

**Usage**:
```typescript
import { getConfig } from '@job-queue/config';

const config = getConfig();

// config.database.url
// config.redis.url
// config.auth.jwtSecret
// config.worker.concurrency
// config.logging.level
```

**Validation**: Uses Zod schema

**Sources** (in order):
1. Environment variables (`.env` file)
2. Environment variables (process.env)
3. Defaults from `config/defaults.ts`

**Used by**: All apps and packages

---

### 8. `@job-queue/shared` - Common Types & Utilities

**Purpose**: Shared types and utility functions

**Types**:
```typescript
export interface Job {
  id: string;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  // ... other fields
}

export interface JobExecution {
  id: string;
  jobId: string;
  attempt: number;
  status: 'started' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
  duration?: number;
}

export enum JobStatus {
  QUEUED = 'queued',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  FAILED = 'failed',
  DELAYED = 'delayed',
  DEAD_LETTER = 'dead_letter',
  CANCELLED = 'cancelled',
  PAUSED = 'paused'
}
```

**Utilities**:
```typescript
export function generateJobId(): string;
export function isRetryableError(error: Error): boolean;
export function formatDuration(ms: number): string;
export function sleep(ms: number): Promise<void>;
export const DEFAULT_MAX_RETRIES = 3;
export const MAX_BACKOFF_DELAY = 3600000; // 1 hour
```

**Used by**: All apps and packages

---

## Dependency Graph

```
API
├── depends on: auth
├── depends on: database
├── depends on: queue
├── depends on: logger
├── depends on: metrics
├── depends on: config
└── depends on: shared

Worker
├── depends on: queue
├── depends on: database
├── depends on: handlers
├── depends on: logger
├── depends on: metrics
├── depends on: config
└── depends on: shared

Dashboard
├── depends on: config (frontend config)
└── depends on: shared (types)

queue
├── depends on: config
├── depends on: logger
└── depends on: shared

handlers
├── depends on: shared
└── depends on: config

auth
├── depends on: shared
└── depends on: config

logger, metrics, config, shared
└── No internal dependencies
```

## Creating a New Package

1. **Create folder**: `packages/my-package/`
2. **Create `package.json`**:
   ```json
   {
     "name": "@job-queue/my-package",
     "version": "1.0.0",
     "main": "src/index.ts",
     "dependencies": {
       "@job-queue/shared": "workspace:*"
     }
   }
   ```
3. **Create `src/index.ts`**: Export public API
4. **Create `tsconfig.json`**: Reference base config
5. **Add to path aliases** in root `tsconfig.json`:
   ```json
   {
     "paths": {
       "@job-queue/my-package": ["packages/my-package/src"]
     }
   }
   ```

## Importing from Packages

```typescript
// ✅ Good (uses path aliases)
import { JobQueue } from '@job-queue/queue';
import { PrismaClient } from '@job-queue/database';
import { authorize } from '@job-queue/auth';
import { logger } from '@job-queue/logger';

// ❌ Avoid
import { JobQueue } from '../../../packages/queue/src';
```

## Monorepo Commands

```bash
# Install in specific package
pnpm --filter @job-queue/queue add axios

# Run tests in package
pnpm --filter database run test

# Rebuild packages (after changes)
pnpm -r run build

# Update versions
pnpm version
```

## Testing Packages

```typescript
// packages/queue/__tests__/queue.test.ts
import { describe, it, expect } from 'vitest';
import { JobQueue } from '../src/queue';

describe('JobQueue', () => {
  it('adds job to queue', async () => {
    const queue = new JobQueue('test');
    const job = await queue.add({ type: 'test', payload: {} });
    expect(job.id).toBeDefined();
  });
});
```

## Publishing Packages

Currently for internal use only. To make public:

1. Set version in `package.json`
2. Add LICENSE
3. Create README.md
4. Publish to npm:
   ```bash
   pnpm publish --filter @job-queue/queue
   ```

## Related Documentation

- [[ARCHITECTURE/02-Monorepo-Structure]] - Full folder structure
- [[COMPONENTS/01-API-Service]] - Uses packages
- [[COMPONENTS/02-Worker-Service]] - Uses packages
- [[DEPLOYMENT]] - Package building
