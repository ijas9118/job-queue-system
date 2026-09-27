# API Service (`apps/api`)

## Overview

The **API Service** is the HTTP interface between users and the job queue system. It handles job submission, authentication, querying, and real-time updates via WebSocket.

**Location**: `apps/api`  
**Language**: TypeScript (Node.js)  
**Framework**: Fastify  
**Real-time**: Socket.IO

## Responsibilities

### ✅ API Handles

- **Job Submission**: Accept job requests, validate payloads
- **Authentication**: JWT token validation
- **Authorization**: Role-based access control (RBAC)
- **Job Querying**: List jobs, get details, search
- **Job Control**: Retry, cancel, pause jobs
- **WebSocket**: Real-time job status updates
- **Metrics**: Queue stats, worker health
- **API Documentation**: OpenAPI spec + Swagger UI at `/docs`, generated from route schemas
- **Admin Functions**: Load testing, DLQ management
- **Error Handling**: Consistent error responses
- **Logging**: Request logging, error tracking

### ❌ API Does NOT

- **Process Jobs**: That's the worker's job
- **Keep State**: All state in DB/Redis
- **Run Long Operations**: Workers handle that
- **Direct DB Operations**: Only via ORM (Prisma)

## Request Flow

```
HTTP Request
    ↓
Fastify Router
    ↓
onRequest Hook (verify JWT)
    ↓
preHandler Hook (check RBAC)
    ↓
Route Schema Validation (Zod compiled to JSON Schema)
    ↓
Business Logic (Service layer)
    ↓
Database Query (Prisma)
    ↓
Redis Operation (if needed)
    ↓
HTTP Response (JSON, serialized via Fastify schema)
    ↓
WebSocket Event Broadcast (if applicable)
```

## Directory Structure

```
apps/api/
├── src/
│   ├── index.ts                 # Entry point
│   ├── app.ts                   # Fastify instance setup
│   ├── plugins/
│   │   ├── auth.ts              # JWT verification (onRequest hook + decorator)
│   │   ├── errorHandler.ts      # setErrorHandler (global error handling)
│   │   ├── logging.ts           # Fastify's built-in Pino logger config
│   │   └── validation.ts        # Zod → JSON Schema compiler setup
│   ├── routes/
│   │   ├── jobs.ts              # Job CRUD endpoints (with route schemas)
│   │   ├── admin.ts             # Admin endpoints
│   │   └── health.ts            # Health check
│   ├── handlers/
│   │   └── wsHandler.ts         # WebSocket handler
│   ├── services/
│   │   ├── jobService.ts        # Job business logic
│   │   ├── workerService.ts     # Worker stats
│   │   ├── metricsService.ts    # Metrics aggregation
│   │   └── dlqService.ts        # DLQ management
│   ├── types.ts                 # API types
│   └── config.ts                # Config loading
├── __tests__/
│   ├── routes.test.ts
│   ├── plugins.test.ts
│   └── services.test.ts
├── .env.example
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Key Endpoints

### Job Submission

**POST** `/api/v1/jobs`

Submit a new job to the queue.

```typescript
Request {
  type: string;              // 'send-email', 'process-video', etc.
  name?: string;             // Human-readable name
  queueName?: string;        // Which queue (default: 'default')
  payload: object;           // Job-specific data
  priority?: number;         // Higher = more urgent
  maxRetries?: number;       // Default: 3
  idempotencyKey?: string;   // Prevent duplicates
  delayUntil?: ISO8601;      // Schedule for later
  tags?: string[];           // For filtering
}

Response {
  id: UUID;
  type: string;
  name: string;
  status: 'queued';
  createdAt: ISO8601;
  url: string;               // Link to job details
}
```

### Query Jobs

**GET** `/api/v1/jobs`

List user's jobs with filtering.

```typescript
Query Parameters:
  status=active,completed
  type=send-email
  tags=marketing,urgent
  limit=50
  offset=0
  sortBy=createdAt
  sortOrder=DESC

Response {
  data: Job[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  }
}
```

**GET** `/api/v1/jobs/:jobId`

Get single job with full history.

```typescript
Response {
  job: Job;
  executions: JobExecution[];
  logs: JobLog[];
}
```

### Job Control

**POST** `/api/v1/jobs/:jobId/retry`  
Manually retry a failed job.

**POST** `/api/v1/jobs/:jobId/cancel`  
Cancel a job.

**POST** `/api/v1/jobs/:jobId/pause` (Admin)  
Pause an active job.

**POST** `/api/v1/jobs/:jobId/resume` (Admin)  
Resume a paused job.

## Authentication & Authorization

### JWT Access Token

Short-lived (15 min) access token + rotating refresh token — not a single long-lived JWT. Full flow, reuse detection, and blacklisting are in [[API/01-Authentication]]; summary:

```typescript
// Access token payload
interface AccessTokenPayload {
  sub: UUID;         // user id
  email: string;
  role: 'admin' | 'user';
  status: 'active' | 'suspended' | 'archived';
  jti: string;        // unique per token, used for blacklisting on logout
  iat: number;
  exp: number;        // iat + 900 (15 min)
}

// Usage
Authorization: Bearer <accessToken>
```

The refresh token is a separate opaque, high-entropy random value, stored server-side only as a SHA-256 hash, and delivered to the browser as an **HttpOnly, Secure, SameSite=Lax cookie** — not `localStorage` — so it's never reachable from injected JS.

### RBAC Permissions

See [[COMPONENTS/04-Shared-Packages]] for `@job-queue/auth` details.

```typescript
// Example: Retry job
canRetryJob(user: User, job: Job): boolean {
  if (user.role === 'admin') return true;           // Admins can retry any
  return job.userId === user.id;                    // Users retry own only
}
```

## WebSocket Events

The API maintains WebSocket connections and broadcasts job events. Socket.IO is registered as a Fastify plugin (`fastify-socket.io`) so it shares the same HTTP server and lifecycle.

```typescript
// Client connects
socket.on('connect', () => {
  socket.emit('subscribe', { 
    channel: 'jobs',
    filters: { queueName: 'email' }
  });
});

// API broadcasts events
socket.emit('job:created', { jobId, type, status });
socket.emit('job:started', { jobId, workerId });
socket.emit('job:completed', { jobId, result, duration });
socket.emit('job:failed', { jobId, error, nextRetry });
```

See [[WEBSOCKET]] folder for complete event list.

## Error Handling

All errors return consistent JSON response via Fastify's `setErrorHandler`:

```typescript
{
  error: {
    code: 'JOB_NOT_FOUND';
    message: 'Job with id abc123 not found';
    statusCode: 404;
    timestamp: '2026-07-02T10:00:00Z';
    requestId: 'req-xyz';  // Fastify's built-in request ID
  }
}
```

Common status codes:
- `400` - Bad request (validation failed)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not found
- `409` - Conflict (idempotency key collision)
- `429` - Rate limited
- `500` - Server error

## Performance Characteristics

Not measured yet — numbers here would be guesses. Once load-tested (see the admin load-test endpoint and [[TECH-STACK/00-Overview]]#performance), record actual p50/p95/p99 latency per operation here instead of estimates.

## Configuration

Environment variables:

```bash
# Server
API_PORT=3000
API_HOST=0.0.0.0

# Database
DATABASE_URL=postgresql://user:pass@host/job_queue

# Redis
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET=your-secret-key
JWT_ACCESS_EXPIRY=900              # 15 minutes
JWT_REFRESH_EXPIRY=604800          # 7 days

# Logging
LOG_LEVEL=info

# WebSocket
WS_CORS_ORIGIN=http://localhost:3001

# Rate Limiting
RATE_LIMIT_WINDOW=15m
RATE_LIMIT_MAX_REQUESTS=1000
```

See [[DEPLOYMENT/03-Environment-Variables]] for full config.

## Plugin & Hook Stack

Fastify uses **plugins** (registered via `fastify.register`) for encapsulated functionality, and **lifecycle hooks** for cross-cutting concerns — the rough equivalent of Express middleware.

### Order of Execution

```
1. onRequest       (logging - built into Fastify's Pino logger)
2. onRequest       (CORS - @fastify/cors)
3. preParsing      (body parsing - built-in)
4. onRequest       (Authentication - JWT verification)
5. preHandler      (Authorization - RBAC checking)
6. onRequest       (Rate Limiting - @fastify/rate-limit)
7. preValidation   (Schema validation - Zod compiled to JSON Schema)
8. Route Handler
9. onError         (Error Handler - catch and format errors)
```

### Custom Plugins & Hooks

- **authPlugin**: `onRequest` hook that verifies JWT and decorates `request.user`
- **rbacPreHandler**: `preHandler` hook that checks permissions for the route
- **validation**: per-route JSON Schema (compiled from Zod) validates body/query/params automatically
- **logger**: Fastify's built-in Pino instance logs all requests with no extra middleware
- **errorHandler**: registered via `fastify.setErrorHandler` to catch and format errors

## Testing Strategy

See [[TESTING/02-Integration-Tests]] for detailed testing approach.

### Unit Tests

- Service functions in isolation
- Permission checks (RBAC)
- Validation logic

### Integration Tests

- Full API routes with real database, using `fastify.inject()` or Supertest against `app.server`
- Authentication flow
- Error scenarios
- WebSocket connections (if applicable)

Example:

```typescript
describe('POST /api/v1/jobs', () => {
  it('submits a job and returns job ID', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        type: 'send-email',
        payload: { to: 'user@example.com' }
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().id).toBeDefined();
  });

  it('rejects invalid job type', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        type: 'invalid-type',
        payload: {}
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_JOB_TYPE');
  });
});
```

## Dependencies

Internal (from packages/):
- `@job-queue/auth` - JWT & RBAC
- `@job-queue/database` - Prisma client
- `@job-queue/queue` - BullMQ wrapper
- `@job-queue/logger` - Pino logger
- `@job-queue/metrics` - Metrics collection
- `@job-queue/config` - Config management
- `@job-queue/shared` - Common types

External:
- `fastify` - Web framework
- `@fastify/cors` - CORS plugin
- `@fastify/rate-limit` - Rate limiting plugin
- `@fastify/swagger` + `@fastify/swagger-ui` - OpenAPI spec + interactive docs, generated from the same Zod schemas used for validation
- `fastify-type-provider-zod` - Zod schema integration for routes (single source of truth: Zod → TS type + JSON Schema)
- `fastify-socket.io` - WebSocket (Socket.IO on the Fastify server)
- `zod` - Validation
- `jsonwebtoken` - Access token signing/verification
- `argon2` - Password hashing (Argon2id)

See `apps/api/package.json` for exact versions.

## Development

### Start API Server

```bash
cd apps/api
pnpm dev
```

Server runs on `http://localhost:3000`

### Run Tests

```bash
pnpm test
pnpm test:watch
```

### Build for Production

```bash
pnpm build
# Output in dist/
```

## Related Documentation

- [[02-ARCHITECTURE-OVERVIEW]] - How API fits in system
- [[API]] - Complete API documentation
- [[COMPONENTS/02-Worker-Service]] - Worker (sibling service)
- [[COMPONENTS/03-Dashboard]] - Frontend (client)
- [[COMPONENTS/04-Shared-Packages]] - Shared libraries used
- [[JOB-LIFECYCLE]] - How jobs flow through API
- [[WEBSOCKET]] - Real-time communication
- [[DEPLOYMENT/02-Docker-Compose]] - Running in Docker
